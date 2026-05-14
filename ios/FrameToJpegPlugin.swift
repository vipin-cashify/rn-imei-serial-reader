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

    let path = (NSTemporaryDirectory() as NSString).appendingPathComponent("imei-\(UUID().uuidString).jpg")
    let url = URL(fileURLWithPath: path)

    let colorSpace = ci.colorSpace ?? CGColorSpace(name: CGColorSpace.sRGB)!
    let options: [CIImageRepresentationOption: Any] = [
      kCGImageDestinationLossyCompressionQuality as CIImageRepresentationOption: normalizedQuality
    ]

    do {
      try FrameToJpegPlugin.ciContext.writeJPEGRepresentation(
        of: oriented,
        to: url,
        colorSpace: colorSpace,
        options: options
      )
    } catch {
      print("[frameToJpeg] writeJPEGRepresentation failed: \(error.localizedDescription)")
      return [:]
    }

    // oriented.extent already reflects the post-rotation dimensions, so no
    // manual quarter-turn swap is needed any more.
    let outWidth = Int(oriented.extent.width)
    let outHeight = Int(oriented.extent.height)

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
