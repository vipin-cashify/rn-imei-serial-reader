import CoreImage

enum OcrCrop {
  /// Applies an upright-normalised, top-left-origin rect to an ALREADY UPRIGHT
  /// CIImage. CIImage is bottom-left origin, so Y is flipped as `1 - y - height`
  /// (the rect's bottom edge), not `1 - y`. Returns the image unchanged when no
  /// usable rect is supplied.
  static func apply(_ rect: NormalizedRect?, to image: CIImage) -> CIImage {
    guard let rect, rect.width > 0, rect.height > 0 else { return image }
    let extent = image.extent
    guard extent.width > 0, extent.height > 0 else { return image }

    let cropRect = CGRect(
      x: extent.origin.x + CGFloat(rect.x) * extent.width,
      y: extent.origin.y + CGFloat(1.0 - rect.y - rect.height) * extent.height,
      width: CGFloat(rect.width) * extent.width,
      height: CGFloat(rect.height) * extent.height
    )
    let clamped = cropRect.intersection(extent)
    guard !clamped.isNull, clamped.width >= 1, clamped.height >= 1 else { return image }
    return image.cropped(to: clamped)
  }
}
