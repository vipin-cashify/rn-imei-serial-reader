import Foundation
import VisionCamera
import CoreImage
import CoreMedia
import ImageIO
import UIKit

@objc(FrameToJpegPlugin)
public class FrameToJpegPlugin: FrameProcessorPlugin {

  // Shared CIContext — creating one per frame causes severe memory pressure
  // (each context allocates GPU/Metal caches). One shared static instance
  // is the canonical pattern.
  private static let ciContext = CIContext()
  private static var hasWarmedUp = false

  /**
   Path of the JPEG written by the previous invocation.

   A JPEG is written for EVERY processed frame (~10/s) because the file is the
   OCR input, not just the capture artefact. Nothing else deletes them, so
   without this the temp dir grows unbounded for the whole scan session — and
   document scanning runs far longer before matching than IMEI does.

   Deletion is lazy (previous file on the next call) rather than eager, because
   the consumer still needs the file after a match: the path is handed to JS
   for OCR and possibly surfaced in `onDone`.
   */
  private var lastFilePath: String?

  public override init(proxy: VisionCameraProxyHolder, options: [AnyHashable: Any]! = [:]) {
    super.init(proxy: proxy, options: options)
    FrameToJpegPlugin.warmUpInBackground()
  }

  /**
   First-time CIContext + Metal initialization + YUV→RGB shader compilation
   on iOS takes 1–3 seconds. If we wait for the first match to trigger this,
   the user sees a long freeze right after enabling capture.

   We pre-warm with a synthetic YUV CVPixelBuffer (matching the camera's
   actual pixel format) so the same code path that runs at scan time is
   exercised once at startup — shaders compiled, GPU memory allocated,
   pipeline ready. A flat-color CIImage isn't enough; it skips the YUV→RGB
   shader which is what dominates first-call latency.
   */
  private static func warmUpInBackground() {
    guard !hasWarmedUp else { return }
    hasWarmedUp = true

    DispatchQueue.global(qos: .userInitiated).async {
      let t0 = Date()

      // Synthetic YUV buffer matching common back-camera output format.
      var pixelBufferOut: CVPixelBuffer?
      let attrs: [CFString: Any] = [
        kCVPixelBufferIOSurfacePropertiesKey: [:] as CFDictionary
      ]
      let result = CVPixelBufferCreate(
        kCFAllocatorDefault,
        640, 480,
        kCVPixelFormatType_420YpCbCr8BiPlanarVideoRange,
        attrs as CFDictionary,
        &pixelBufferOut
      )
      guard result == kCVReturnSuccess, let buffer = pixelBufferOut else {
        print("[frameToJpeg] warmup: failed to allocate CVPixelBuffer")
        return
      }

      let ci = CIImage(cvPixelBuffer: buffer)
      let url = URL(fileURLWithPath: NSTemporaryDirectory() + "frame-to-jpeg-warmup.jpg")
      let colorSpace = ci.colorSpace ?? CGColorSpace(name: CGColorSpace.sRGB)!
      let options: [CIImageRepresentationOption: Any] = [
        kCGImageDestinationLossyCompressionQuality as CIImageRepresentationOption: 0.8,
        CIImageRepresentationOption(rawValue: kCGImagePropertyOrientation as String): NSNumber(value: 1)
      ]

      do {
        try ciContext.writeJPEGRepresentation(
          of: ci,
          to: url,
          colorSpace: colorSpace,
          options: options
        )
        try? FileManager.default.removeItem(at: url)
        let elapsed = Date().timeIntervalSince(t0) * 1000
        print(String(format: "[frameToJpeg] warmup complete in %.0fms", elapsed))
      } catch {
        print("[frameToJpeg] warmup failed: \(error.localizedDescription)")
      }
    }
  }

  public override func callback(_ frame: Frame, withArguments arguments: [AnyHashable: Any]?) -> Any {
    let t0 = Date()
    let quality = (arguments?["quality"] as? NSNumber)?.doubleValue ?? 80.0
    let normalizedQuality = quality > 1.0 ? quality / 100.0 : quality

    guard let pixelBuffer = CMSampleBufferGetImageBuffer(frame.buffer) else {
      return [:]
    }

    let ci = CIImage(cvPixelBuffer: pixelBuffer)

    // Bake the rotation into the pixels via .oriented(forExifOrientation:).
    // Don't rely on EXIF metadata — observation: RN's <Image> on iOS is not
    // honoring the kCGImagePropertyOrientation we tried to embed, so the
    // rendered thumbnail kept showing the raw landscape buffer. Baking
    // produces a JPEG whose raw pixels are already upright; no EXIF needed.
    let correctedOrientation = cgImagePropertyOrientation(from: frame.orientation)
    let oriented = ci.oriented(forExifOrientation: Int32(correctedOrientation.rawValue))

    // Crop AFTER .oriented(...) on purpose. `oriented.extent` is already the
    // upright image the user sees, so a screen-derived rect maps directly —
    // and, critically, the empirical +180° correction above is already applied.
    // Cropping before would mean replicating that fudge here, and a 180° error
    // is not shape-changing, so nothing would catch it: the crop would just
    // silently grab the wrong end of the card.
    let cropped = applyCropRect(to: oriented, arguments: arguments)

    // Delete the previous frame's JPEG before writing this one.
    deleteLastFile()

    let path = (NSTemporaryDirectory() as NSString).appendingPathComponent("imei-\(UUID().uuidString).jpg")
    let url = URL(fileURLWithPath: path)
    lastFilePath = path

    let colorSpace = ci.colorSpace ?? CGColorSpace(name: CGColorSpace.sRGB)!
    let options: [CIImageRepresentationOption: Any] = [
      kCGImageDestinationLossyCompressionQuality as CIImageRepresentationOption: normalizedQuality
    ]

    do {
      try FrameToJpegPlugin.ciContext.writeJPEGRepresentation(
        of: cropped,
        to: url,
        colorSpace: colorSpace,
        options: options
      )
    } catch {
      print("[frameToJpeg] writeJPEGRepresentation failed: \(error.localizedDescription)")
      return [:]
    }

    // Report the CROPPED extent — the consumer's Frame describes the file we
    // actually wrote. `.extent` already reflects the post-rotation dimensions,
    // so no manual quarter-turn swap is needed.
    let outWidth = Int(cropped.extent.width)
    let outHeight = Int(cropped.extent.height)

    let elapsed = Date().timeIntervalSince(t0) * 1000
    print(String(format: "[frameToJpeg] callback took %.0fms  %dx%d", elapsed, outWidth, outHeight))

    return [
      "path": path,
      "width": outWidth,
      "height": outHeight,
      "orientation": orientationString(frame.orientation)
    ]
  }

  /**
   Applies the optional normalized `cropRect` argument to an already-upright
   CIImage. Returns the image unchanged when no usable rect is supplied, so the
   plugin keeps working for callers that never pass a crop.

   The rect is top-left origin (matching the screen) while CIImage is
   BOTTOM-left origin, so Y needs flipping. Note it is `1 - y - height`, not
   `1 - y`: we are locating the rect's bottom edge, so the height has to come
   off too. Getting this wrong mirrors the crop vertically.
   */
  private func applyCropRect(to image: CIImage, arguments: [AnyHashable: Any]?) -> CIImage {
    guard let raw = arguments?["cropRect"] as? [AnyHashable: Any],
          let nx = (raw["x"] as? NSNumber)?.doubleValue,
          let ny = (raw["y"] as? NSNumber)?.doubleValue,
          let nw = (raw["width"] as? NSNumber)?.doubleValue,
          let nh = (raw["height"] as? NSNumber)?.doubleValue,
          nw > 0, nh > 0
    else { return image }

    let extent = image.extent
    guard extent.width > 0, extent.height > 0 else { return image }

    let rect = CGRect(
      x: extent.origin.x + CGFloat(nx) * extent.width,
      y: extent.origin.y + CGFloat(1.0 - ny - nh) * extent.height,
      width: CGFloat(nw) * extent.width,
      height: CGFloat(nh) * extent.height
    )

    let clamped = rect.intersection(extent)
    guard !clamped.isNull, clamped.width >= 1, clamped.height >= 1 else { return image }

    return image.cropped(to: clamped)
  }

  /**
   Deletes the JPEG written by the previous call, if it still exists.
   Failures are ignored on purpose — a leftover temp file is recoverable by the
   OS, but throwing here would kill the frame processor.
   */
  private func deleteLastFile() {
    guard let path = lastFilePath else { return }
    lastFilePath = nil
    try? FileManager.default.removeItem(atPath: path)
  }

  /**
   Maps `frame.orientation` to the EXIF orientation to embed in the JPEG.
   Adds a +CW 180° correction on top of the standard mapping — VC's
   `frame.orientation` on this hardware consistently under-reports the
   buffer's rotation by 180° (standard mapping → upside-down; +CW 90°
   shift → landscape-left; +CW 180° shift → upright).

   The rotation cycle (CW): .up → .left → .down → .right → .up
   We shift each frame.orientation by +CW 180° (two positions in the cycle).
   */
  private func cgImagePropertyOrientation(from orientation: UIImage.Orientation) -> CGImagePropertyOrientation {
    switch orientation {
    case .up:            return .down            // +CW 180° from .up
    case .right:         return .left            // +CW 180° from .right
    case .down:          return .up              // +CW 180° from .down
    case .left:          return .right           // +CW 180° from .left
    case .upMirrored:    return .downMirrored
    case .rightMirrored: return .leftMirrored
    case .downMirrored:  return .upMirrored
    case .leftMirrored:  return .rightMirrored
    @unknown default:    return .down
    }
  }

  private func orientationString(_ orientation: UIImage.Orientation) -> String {
    switch orientation {
    case .up, .upMirrored:       return "portrait"
    case .down, .downMirrored:   return "portrait-upside-down"
    case .left, .leftMirrored:   return "landscape-left"
    case .right, .rightMirrored: return "landscape-right"
    @unknown default:            return "portrait"
    }
  }
}
