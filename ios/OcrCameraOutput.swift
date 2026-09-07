import AVFoundation
import CoreImage
import ImageIO
import MLKitTextRecognition
import MLKitTextRecognitionCommon
import MLKitVision
import NitroModules
import UIKit
import VisionCamera

/// VisionCamera 5 `CameraOutput` running MLKit Text Recognition on the video
/// stream. Modelled on react-native-vision-camera-barcode-scanner's
/// `HybridBarcodeScannerOutput`.
final class OcrCameraOutput: HybridCameraOutputSpec, NativeCameraOutput {
  let output: AVCaptureVideoDataOutput
  let requiresAudioInput: Bool = false
  let requiresDepthFormat: Bool = false
  let mediaType: MediaType = .video
  /// VisionCamera 5 does not rotate a custom output's connection for us, so we
  /// rotate it PHYSICALLY whenever this changes — see `applyOutputOrientation`.
  var outputOrientation: CameraOrientation = .up {
    didSet { applyOutputOrientation() }
  }
  var currentResolution: Size? {
    guard let connection = output.connection(with: .video) else { return nil }
    return connection.inputStreamResolution
  }
  let streamType: StreamType = .video
  var targetResolution: ResolutionRule {
    return config.highResolution
      ? .closestTo(Size(width: 1080.0, height: 1920.0))
      : .closestTo(Size(width: 720.0, height: 1280.0))
  }

  private let config: OcrRecognizerConfig
  private let recognizer = TextRecognizer.textRecognizer(options: MLKitTextRecognition.TextRecognizerOptions())
  private let ciContext = CIContext()
  private let queue = DispatchQueue(label: "in.cashify.imeiserialreader.ocr")
  private var delegate: OcrSampleBufferDelegate?
  private let lock = NSLock()
  private var _cropRect: NormalizedRect?
  private var _isPaused = false
  private var _isBusy = false
  private var _isConnectionRotated = false
  private var lastAcceptedAt: CFTimeInterval = 0
  /// Written JPEGs and when they were written, newest last. Only touched on `queue`.
  private var jpegFiles: [(path: String, writtenAt: CFTimeInterval)] = []

  /// How long a written JPEG is guaranteed to survive. A frame's path travels
  /// native -> JS -> parser -> `onDone` -> the consumer's match handler before
  /// anyone reads the file, and the next frame is analysed meanwhile, so
  /// deleting the previous file on every write raced the delivery.
  private static let jpegRetention: CFTimeInterval = 3.0

  var cropRect: NormalizedRect? {
    get { lock.lock(); defer { lock.unlock() }; return _cropRect }
    set { lock.lock(); _cropRect = newValue; lock.unlock() }
  }
  var isPaused: Bool {
    get { lock.lock(); defer { lock.unlock() }; return _isPaused }
    set { lock.lock(); _isPaused = newValue; lock.unlock() }
  }
  private var isBusy: Bool {
    get { lock.lock(); defer { lock.unlock() }; return _isBusy }
    set { lock.lock(); _isBusy = newValue; lock.unlock() }
  }
  /// True once the capture connection accepted a physical rotation, so buffers
  /// arrive upright and no software rotation is needed. Set on the session
  /// thread, read on `queue`.
  private var isConnectionRotated: Bool {
    get { lock.lock(); defer { lock.unlock() }; return _isConnectionRotated }
    set { lock.lock(); _isConnectionRotated = newValue; lock.unlock() }
  }

  init(config: OcrRecognizerConfig) {
    self.config = config
    self.output = AVCaptureVideoDataOutput()
    super.init()
    self.delegate = OcrSampleBufferDelegate { [weak self] buffer in
      self?.process(buffer)
    }
    output.setSampleBufferDelegate(delegate, queue: queue)
    output.alwaysDiscardsLateVideoFrames = true
  }

  func configure(config: OutputConfiguration) {
    guard let connection = output.connection(with: .video) else { return }
    connection.preferredVideoStabilizationMode = .off
    applyOutputOrientation()
  }

  /// Rotates the capture connection to `outputOrientation`, the same way
  /// VisionCamera's own `HybridCameraVideoFrameOutput` does. MLKit's Latin
  /// text recogniser is NOT rotation invariant, so a sideways buffer reads
  /// nothing; the connection rotates the pixels for us instead.
  ///
  /// If the connection refuses (`isVideoOrientationSupported == false`), the
  /// per-frame path corrects each buffer in software — see `process`.
  private func applyOutputOrientation() {
    guard let connection = output.connection(with: .video) else {
      isConnectionRotated = false
      return
    }
    do {
      try connection.setOrientation(outputOrientation)
      isConnectionRotated = true
    } catch {
      isConnectionRotated = false
      print("[ImeiSerialReader] Connection does not support rotation, correcting frames in software: \(error)")
    }
  }

  /// Detach from the capture pipeline.
  ///
  /// Deletes NO JPEGs: after a parser match the recognizer is paused, so the
  /// newest entry in `jpegFiles` is the frame whose `file://` path was just
  /// delivered to the JS consumer. Deleting it here would destroy the
  /// consumer's file out from under it. See `writeJpeg`/`pruneJpegs` below for
  /// where cleanup actually happens.
  func stop() {
    output.setSampleBufferDelegate(nil, queue: nil)
  }

  private func process(_ buffer: CMSampleBuffer) {
    let now = CACurrentMediaTime()
    let minInterval = config.targetFps > 0 ? 1.0 / config.targetFps : 0
    if isPaused || isBusy || now - lastAcceptedAt < minInterval { return }
    isBusy = true
    lastAcceptedAt = now

    guard let pixelBuffer = CMSampleBufferGetImageBuffer(buffer) else {
      isBusy = false
      config.onError(RuntimeError.error(withMessage: "Sample buffer has no image buffer"))
      return
    }

    let orientation = outputOrientation
    // The connection was physically rotated to `outputOrientation`, so the
    // buffer is already upright and this is a no-op. Only if the connection
    // refused rotation do we correct here, by the INVERSE of the buffer's
    // orientation relative to `outputOrientation` (the value VisionCamera's
    // own frame output would report for that buffer). Crop AFTER orienting —
    // the rect from JS is expressed against the upright image.
    let oriented = CIImage(cvPixelBuffer: pixelBuffer).oriented(bufferCorrection(for: orientation))
    let cropped = OcrCrop.apply(cropRect, to: oriented)
    guard let cgImage = ciContext.createCGImage(cropped, from: cropped.extent) else {
      isBusy = false
      config.onError(RuntimeError.error(withMessage: "Failed to render frame for OCR"))
      return
    }

    let jpegPath = config.captureJpeg ? writeJpeg(cropped) : nil
    let width = Double(cropped.extent.width)
    let height = Double(cropped.extent.height)
    let ocrOrientation = orientation.toOcrOrientation()

    let visionImage = VisionImage(image: UIImage(cgImage: cgImage))
    visionImage.orientation = .up

    recognizer.process(visionImage) { [weak self] result, error in
      guard let self else { return }
      defer { self.isBusy = false }
      if let error {
        self.config.onError(error)
        return
      }
      let blocks = result?.blocks.map { $0.toOcrBlock() } ?? []
      self.config.onTextRecognized(
        OcrFrame(blocks: blocks, width: width, height: height, orientation: ocrOrientation, jpegPath: jpegPath)
      )
    }
  }

  /// `.up` when the connection is physically rotated (the normal case), else
  /// the software correction that makes this buffer upright.
  private func bufferCorrection(for outputOrientation: CameraOrientation) -> CGImagePropertyOrientation {
    if isConnectionRotated { return .up }
    guard let connection = output.connection(with: .video) else { return .up }
    return connection.orientation.relativeTo(outputOrientation).inverse.toCGImagePropertyOrientation()
  }

  /// Writes `image` as a JPEG to a fresh temp path and adds it to the
  /// retention window (see `pruneJpegs`). Never throws at the caller and never
  /// reports through `config.onError`: a failed capture must not tear the
  /// camera down — OCR simply continues with no `jpegPath` for that frame.
  private func writeJpeg(_ image: CIImage) -> String? {
    let path = (NSTemporaryDirectory() as NSString).appendingPathComponent("imei-\(UUID().uuidString).jpg")
    let url = URL(fileURLWithPath: path)
    let colorSpace = image.colorSpace ?? CGColorSpace(name: CGColorSpace.sRGB)!
    let quality = min(max(config.jpegQuality / 100.0, 0.01), 1.0)
    let options: [CIImageRepresentationOption: Any] = [
      kCGImageDestinationLossyCompressionQuality as CIImageRepresentationOption: quality
    ]
    do {
      try ciContext.writeJPEGRepresentation(of: image, to: url, colorSpace: colorSpace, options: options)
      let now = CACurrentMediaTime()
      jpegFiles.append((path: path, writtenAt: now))
      pruneJpegs(now: now)
      return path
    } catch {
      print("[ImeiSerialReader] Failed to write the analysed frame as a JPEG: \(error)")
      return nil
    }
  }

  /// Deletes JPEGs that have been on disk for longer than `jpegRetention`.
  ///
  /// A retention WINDOW rather than "delete the previous file on each write":
  /// native releases the single-flight lock as soon as MLKit returns, so the
  /// very next frame used to delete the file whose path JS was still carrying
  /// through the parser into the consumer's `onDone` handler.
  ///
  /// Nothing is pruned while `isPaused` — after a match the recognizer is
  /// paused, so the delivered file survives for as long as the consumer keeps
  /// it paused. `stop()` deletes nothing at all (see its doc comment).
  private func pruneJpegs(now: CFTimeInterval) {
    if isPaused { return }
    var kept: [(path: String, writtenAt: CFTimeInterval)] = []
    for entry in jpegFiles {
      if now - entry.writtenAt >= Self.jpegRetention {
        try? FileManager.default.removeItem(atPath: entry.path)
      } else {
        kept.append(entry)
      }
    }
    jpegFiles = kept
  }
}
