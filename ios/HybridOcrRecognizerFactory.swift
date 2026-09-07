import NitroModules
import VisionCamera

class HybridOcrRecognizerFactory: HybridOcrRecognizerFactorySpec {
  func createOcrRecognizer(config: OcrRecognizerConfig) throws -> any HybridOcrRecognizerSpec {
    return HybridOcrRecognizer(config: config)
  }
}
