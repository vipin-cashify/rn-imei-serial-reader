import NitroModules
import VisionCamera

final class HybridOcrRecognizer: HybridOcrRecognizerSpec {
  private let cameraOutput: OcrCameraOutput

  init(config: OcrRecognizerConfig) {
    self.cameraOutput = OcrCameraOutput(config: config)
    super.init()
  }

  deinit {
    cameraOutput.stop()
  }

  var output: any HybridCameraOutputSpec {
    return cameraOutput
  }

  func setCropRect(rect: NormalizedRect?) throws {
    cameraOutput.cropRect = rect
  }

  func setPaused(paused: Bool) throws {
    cameraOutput.isPaused = paused
  }
}
