import CoreGraphics
import MLKitTextRecognition
import MLKitTextRecognitionCommon
import MLKitVision

extension CGRect {
  func toOcrBox() -> OcrBox {
    return OcrBox(x: Double(origin.x), y: Double(origin.y), width: Double(size.width), height: Double(size.height))
  }
}

extension TextBlock {
  func toOcrBlock() -> OcrBlock {
    return OcrBlock(
      text: text,
      box: frame.toOcrBox(),
      lines: lines.map { line in
        OcrLine(
          text: line.text,
          box: line.frame.toOcrBox(),
          elements: line.elements.map { element in
            OcrElement(text: element.text, box: element.frame.toOcrBox())
          }
        )
      }
    )
  }
}
