package com.margelo.nitro.imeiserialreader

import android.graphics.ImageFormat
import android.graphics.Rect
import android.graphics.YuvImage
import android.media.Image
import android.os.SystemClock
import android.util.Log
import android.util.Size
import androidx.annotation.OptIn
import androidx.camera.core.ExperimentalGetImage
import androidx.camera.core.ImageAnalysis
import androidx.camera.core.ImageProxy
import androidx.camera.core.resolutionselector.ResolutionSelector
import androidx.camera.core.resolutionselector.ResolutionStrategy
import androidx.exifinterface.media.ExifInterface
import com.google.mlkit.vision.common.InputImage
import com.google.mlkit.vision.text.TextRecognition
import com.google.mlkit.vision.text.latin.TextRecognizerOptions
import com.margelo.nitro.camera.CameraOrientation
import com.margelo.nitro.camera.HybridCameraOutputSpec
import com.margelo.nitro.camera.MediaType
import com.margelo.nitro.camera.MirrorMode
import com.margelo.nitro.camera.extensions.converters.toSize
import com.margelo.nitro.camera.extensions.surfaceRotation
import com.margelo.nitro.camera.public.NativeCameraOutput
import java.io.ByteArrayOutputStream
import java.io.File
import java.io.FileOutputStream
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean

/**
 * VisionCamera 5 `CameraOutput` that runs MLKit Text Recognition on the
 * analysis stream. Modelled on react-native-vision-camera-barcode-scanner's
 * `HybridBarcodeScannerOutput`.
 */
class OcrCameraOutput(private val config: OcrRecognizerConfig) :
  HybridCameraOutputSpec(),
  ImageAnalysis.Analyzer,
  NativeCameraOutput {

  override val mediaType: MediaType = MediaType.VIDEO
  override var outputOrientation: CameraOrientation = CameraOrientation.UP
    set(value) {
      field = value
      imageAnalysis?.targetRotation = value.surfaceRotation
    }
  override val currentResolution: com.margelo.nitro.camera.Size?
    get() = imageAnalysis?.resolutionInfo?.resolution?.toSize()
  override val mirrorMode: MirrorMode = MirrorMode.AUTO

  /** Upright-normalised crop; null scans the whole frame. Written from JS, read on the analyzer thread. */
  @Volatile var cropRect: NormalizedRect? = null
  /** While true frames are dropped without analysis. */
  @Volatile var isPaused: Boolean = false

  private var imageAnalysis: ImageAnalysis? = null
  private val executor = Executors.newSingleThreadExecutor()
  private val recognizer = TextRecognition.getClient(TextRecognizerOptions.DEFAULT_OPTIONS)
  private val isBusy = AtomicBoolean(false)
  private val minIntervalMs: Long = if (config.targetFps > 0) (1000.0 / config.targetFps).toLong() else 0L
  @Volatile private var lastAcceptedAtMs = 0L

  /** Written JPEGs and when they were written, oldest first. Only touched on the analyzer thread. */
  private val jpegFiles = ArrayDeque<Pair<String, Long>>()

  private companion object {
    const val TAG = "OcrCameraOutput"

    /**
     * How long a written JPEG is guaranteed to survive. A frame's path travels
     * native -> JS -> parser -> `onDone` -> the consumer's match handler before
     * anyone reads the file, and the next frame is analysed meanwhile, so
     * deleting the previous file on every write raced the delivery.
     */
    const val JPEG_RETENTION_MS = 3000L
  }

  override fun createUseCase(
    mirrorMode: MirrorMode,
    config: NativeCameraOutput.Config,
  ): NativeCameraOutput.PreparedUseCase {
    val target = if (this.config.highResolution) Size(1920, 1080) else Size(1280, 720)
    val resolutionSelector =
      ResolutionSelector.Builder()
        .setResolutionStrategy(ResolutionStrategy(target, ResolutionStrategy.FALLBACK_RULE_CLOSEST_HIGHER_THEN_LOWER))
        .setAllowedResolutionMode(ResolutionSelector.PREFER_HIGHER_RESOLUTION_OVER_CAPTURE_RATE)
        .build()
    val analysis =
      ImageAnalysis.Builder()
        .setOutputImageFormat(ImageAnalysis.OUTPUT_IMAGE_FORMAT_YUV_420_888)
        .setOutputImageRotationEnabled(false)
        // Seed the rotation the same way VisionCamera's own `HybridFrameOutput`
        // does: `outputOrientation` may already have been set before the use
        // case existed, and its setter can only reach `imageAnalysis` afterwards.
        .setTargetRotation(outputOrientation.surfaceRotation)
        .setResolutionSelector(resolutionSelector)
        .setBackpressureStrategy(ImageAnalysis.STRATEGY_KEEP_ONLY_LATEST)
        .build()
    return NativeCameraOutput.PreparedUseCase(analysis) {
      imageAnalysis = analysis
      analysis.setAnalyzer(executor, this)
    }
  }

  override fun dispose() {
    super.dispose()
    imageAnalysis?.clearAnalyzer()
    recognizer.close()
    executor.shutdown()
  }

  @OptIn(ExperimentalGetImage::class)
  override fun analyze(imageProxy: ImageProxy) {
    // Monotonic: a wall-clock jump (NTP sync, user changing the time) must not
    // stall or flood the throttle.
    val now = SystemClock.elapsedRealtime()
    if (isPaused || now - lastAcceptedAtMs < minIntervalMs || !isBusy.compareAndSet(false, true)) {
      imageProxy.close()
      return
    }
    lastAcceptedAtMs = now

    var closed = false
    fun closeProxy() {
      if (!closed) {
        closed = true
        imageProxy.close()
      }
    }

    try {
      val image: Image = imageProxy.image ?: throw IllegalStateException("ImageProxy has no Image")
      val rotation = imageProxy.imageInfo.rotationDegrees
      val crop = YuvCrop.bufferRect(cropRect, image.width, image.height, rotation)
      val nv21 = YuvCrop.toNv21(image, crop)
      val cw = crop.width()
      val ch = crop.height()
      // Pixels are copied — hand the buffer back to the camera before the slow parts.
      closeProxy()

      val jpegPath = if (config.captureJpeg) writeJpeg(nv21, cw, ch, rotation) else null
      val swap = rotation == 90 || rotation == 270
      val uprightWidth = if (swap) ch else cw
      val uprightHeight = if (swap) cw else ch

      val input = InputImage.fromByteArray(nv21, cw, ch, rotation, InputImage.IMAGE_FORMAT_NV21)
      recognizer
        .process(input)
        .addOnSuccessListener { text ->
          config.onTextRecognized(
            OcrFrame(
              text.toOcrBlocks(),
              uprightWidth.toDouble(),
              uprightHeight.toDouble(),
              rotation.toOcrOrientation(),
              jpegPath,
            ),
          )
        }
        .addOnFailureListener { error -> config.onError(error) }
        .addOnCompleteListener { isBusy.set(false) }
    } catch (error: Throwable) {
      closeProxy()
      isBusy.set(false)
      config.onError(error)
    }
  }

  /**
   * Writes the NV21 crop as a JPEG with an EXIF orientation tag (no decode /
   * rotate / re-encode round trip) and adds it to the retention window (see
   * [pruneJpegs]).
   *
   * Returns `null` and logs instead of throwing when the write fails: a failed
   * capture must not tear the camera down — OCR simply continues with no
   * `jpegPath` for that frame.
   */
  private fun writeJpeg(nv21: ByteArray, width: Int, height: Int, rotationDegrees: Int): String? =
    try {
      val yuv = YuvImage(nv21, ImageFormat.NV21, width, height, null)
      val baos = ByteArrayOutputStream()
      yuv.compressToJpeg(Rect(0, 0, width, height), config.jpegQuality.toInt().coerceIn(1, 100), baos)

      val outFile = File.createTempFile("imei-", ".jpg")
      FileOutputStream(outFile).use { it.write(baos.toByteArray()) }

      val exif = ExifInterface(outFile.absolutePath)
      exif.setAttribute(ExifInterface.TAG_ORIENTATION, exifOrientation(rotationDegrees).toString())
      exif.saveAttributes()

      val now = SystemClock.elapsedRealtime()
      jpegFiles.addLast(outFile.absolutePath to now)
      pruneJpegs(now)
      outFile.absolutePath
    } catch (error: Throwable) {
      Log.w(TAG, "Failed to write the analysed frame as a JPEG", error)
      null
    }

  /**
   * Deletes JPEGs that have been on disk for longer than [JPEG_RETENTION_MS].
   *
   * A retention WINDOW rather than "delete the previous file on each write":
   * the single-flight lock is released as soon as MLKit completes, so the very
   * next frame used to delete the file whose path JS was still carrying
   * through the parser into the consumer's `onDone` handler.
   *
   * Nothing is pruned while [isPaused] — after a match the recognizer is
   * paused, so the delivered file survives for as long as the consumer keeps
   * it paused. [dispose] deletes nothing at all; the OS reclaims the app's
   * cache dir independently of us.
   */
  private fun pruneJpegs(nowMs: Long) {
    if (isPaused) return
    while (jpegFiles.isNotEmpty() && nowMs - jpegFiles.first().second >= JPEG_RETENTION_MS) {
      val (path, _) = jpegFiles.removeFirst()
      try {
        val f = File(path)
        if (f.exists()) f.delete()
      } catch (_: Exception) {
        // A leftover temp file is recoverable by the OS; never crash the analyzer for it.
      }
    }
  }

  private fun exifOrientation(rotationDegrees: Int): Int =
    when (((rotationDegrees % 360) + 360) % 360) {
      90 -> ExifInterface.ORIENTATION_ROTATE_90
      180 -> ExifInterface.ORIENTATION_ROTATE_180
      270 -> ExifInterface.ORIENTATION_ROTATE_270
      else -> ExifInterface.ORIENTATION_NORMAL
    }
}
