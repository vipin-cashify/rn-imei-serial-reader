import AVFoundation
import ImageIO
import NitroModules
import VisionCamera

/// Orientation helpers for the OCR output.
///
/// VisionCamera 5 never rotates a custom `CameraOutput`'s `AVCaptureConnection`
/// for us — `HybridCameraSession.configureOutputs` only hands each output its
/// `mirrorMode` — so a portrait UI would otherwise receive the sensor-native
/// LANDSCAPE buffer and MLKit's Latin recogniser would read nothing (and the
/// crop would hit the wrong region). `OcrCameraOutput` therefore does what
/// VisionCamera's own frame output does: it PHYSICALLY rotates the connection
/// to `outputOrientation` (`configure` + the `outputOrientation` observer), so
/// buffers arrive upright and the per-frame `.oriented(...)` is a no-op.
///
/// This deliberately differs from the barcode plugin, which just tags the
/// MLImage with the orientation — MLKit's barcode detector is rotation
/// invariant, the text recogniser is not.
///
/// The members below mirror VisionCamera's own helpers 1:1 in name and
/// signature (`ios/Extensions/CameraOrientation+degrees.swift`,
/// `ios/Extensions/Converters/AV+CameraOrientation.swift`,
/// `ios/Extensions/AVFoundation/AVCaptureConnection+orientation.swift`), but
/// VisionCamera declares them `internal`, so a plugin living in a different
/// Swift module cannot reach them — the barcode plugin re-declares
/// `toUIImageOrientation()` for exactly the same reason.
extension CameraOrientation {
  var degrees: Int {
    switch self {
    case .up: return 0
    case .left: return 270
    case .right: return 90
    case .down: return 180
    }
  }

  init(degrees: Int) {
    var normalized = degrees % 360
    if normalized < 0 { normalized += 360 }
    switch normalized {
    case 45..<135: self = .right
    case 135..<225: self = .down
    case 225..<315: self = .left
    default: self = .up
    }
  }

  /// This orientation expressed relative to `orientation`.
  func relativeTo(_ orientation: CameraOrientation) -> CameraOrientation {
    return CameraOrientation(degrees: degrees - orientation.degrees)
  }

  /// The rotation that undoes `self`.
  var inverse: CameraOrientation {
    return CameraOrientation(degrees: -degrees)
  }

  init(avOrientation: AVCaptureVideoOrientation) {
    switch avOrientation {
    case .portrait: self = .up
    case .portraitUpsideDown: self = .down
    case .landscapeRight: self = .left
    case .landscapeLeft: self = .right
    @unknown default: self = .up
    }
  }

  func toAVCaptureVideoOrientation() -> AVCaptureVideoOrientation {
    switch self {
    case .up: return .portrait
    case .down: return .portraitUpsideDown
    case .left: return .landscapeRight
    case .right: return .landscapeLeft
    }
  }

  /// Only used on the fallback path, when the connection refuses to rotate
  /// physically and the buffer has to be corrected in software instead.
  func toCGImagePropertyOrientation() -> CGImagePropertyOrientation {
    switch self {
    case .up: return .up
    case .down: return .down
    case .left: return .left
    case .right: return .right
    }
  }

  /// Informational only — reported back to JS as `OcrFrame.orientation`.
  /// Boxes, `width` and `height` are already upright.
  func toOcrOrientation() -> OcrFrameOrientation {
    switch self {
    case .up: return .portrait
    case .down: return .portraitUpsideDown
    case .left: return .landscapeLeft
    case .right: return .landscapeRight
    }
  }
}

extension AVCaptureConnection {
  var orientation: CameraOrientation {
    return CameraOrientation(avOrientation: videoOrientation)
  }

  func setOrientation(_ orientation: CameraOrientation) throws {
    guard isVideoOrientationSupported else {
      throw RuntimeError.error(
        withMessage: "Cannot set orientation=\"\(orientation.stringValue)\" - this connection does not support orientation changing"
      )
    }
    videoOrientation = orientation.toAVCaptureVideoOrientation()
  }
}
