package com.cashify.imeireader

import android.graphics.ImageFormat
import android.graphics.Rect
import android.graphics.YuvImage
import android.media.Image
import androidx.exifinterface.media.ExifInterface
import com.mrousavy.camera.frameprocessors.Frame
import com.mrousavy.camera.frameprocessors.FrameProcessorPlugin
import com.mrousavy.camera.frameprocessors.VisionCameraProxy
import java.io.ByteArrayOutputStream
import java.io.File
import java.io.FileOutputStream
import java.util.HashMap

class FrameToJpegPlugin(proxy: VisionCameraProxy, options: Map<String, Any>?) :
    FrameProcessorPlugin() {

    /**
     * Path of the JPEG written by the previous invocation.
     *
     * A JPEG is written for EVERY processed frame (~10/s) because the file is
     * the OCR input, not just the capture artefact. Nothing else deletes them,
     * so without this the temp dir grows unbounded for the whole scan session
     * — and document scanning runs far longer before matching than IMEI does.
     *
     * We delete lazily (previous file on the next call) rather than eagerly,
     * because the consumer still needs the file to exist after a match: the
     * path is handed to JS for OCR and possibly surfaced in `onDone`.
     * `releaseLastFile` lets the caller hand off ownership of a kept frame.
     */
    private var lastFilePath: String? = null

    override fun callback(frame: Frame, arguments: Map<String, Any>?): HashMap<String, Any?>? {
        val quality = (arguments?.get("quality") as? Number)?.toInt() ?: 80
        val image: Image = frame.image
        val width = image.width
        val height = image.height
        val rotationDegrees = frame.imageProxy.imageInfo.rotationDegrees

        val nv21 = yuv420ToNv21(image)
        val yuv = YuvImage(nv21, ImageFormat.NV21, width, height, null)
        val baos = ByteArrayOutputStream()

        // YuvImage crops during encode, so a cropped region is cheaper than a
        // full frame — not just more accurate.
        val cropRect = parseCropRect(arguments, width, height, rotationDegrees)
        yuv.compressToJpeg(cropRect, quality, baos)
        val jpegBytes = baos.toByteArray()

        val outWidth = cropRect.width()
        val outHeight = cropRect.height()

        // Delete the previous frame's JPEG before writing this one.
        deleteLastFile()

        val outFile = File.createTempFile("imei-", ".jpg")
        lastFilePath = outFile.absolutePath
        FileOutputStream(outFile).use { it.write(jpegBytes) }

        // Embed EXIF orientation so consumers (e.g. RN <Image>) display upright
        // without us doing a decode/rotate/encode round-trip.
        val exif = ExifInterface(outFile.absolutePath)
        exif.setAttribute(ExifInterface.TAG_ORIENTATION, exifOrientation(rotationDegrees).toString())
        exif.saveAttributes()

        // Report the CROPPED dimensions — the consumer's Frame describes the
        // file we actually wrote, not the sensor buffer.
        return resultMap(outFile.absolutePath, outWidth, outHeight, rotationDegrees)
    }

    /**
     * Reads the optional normalized `cropRect` argument and converts it to
     * pixels in BUFFER space.
     *
     * The incoming rect is expressed against the UPRIGHT image — the way the
     * user sees it on screen. This buffer is not upright: CameraX hands us
     * sensor-native pixels and only reports `rotationDegrees`, the rotation
     * needed to make them upright (we record it as EXIF rather than rotating).
     * So the rect must be rotated by the inverse before it means anything
     * here. At 90° that swaps the axes: a wide, short card on screen is a
     * narrow, tall region of the buffer.
     *
     * Returns the full frame when the argument is absent or unusable, so the
     * plugin keeps working for callers that never pass a crop.
     */
    private fun parseCropRect(
        arguments: Map<String, Any>?,
        width: Int,
        height: Int,
        rotationDegrees: Int
    ): Rect {
        val full = Rect(0, 0, width, height)
        val raw = arguments?.get("cropRect") as? Map<*, *> ?: return full

        val ux = (raw["x"] as? Number)?.toDouble() ?: return full
        val uy = (raw["y"] as? Number)?.toDouble() ?: return full
        val uw = (raw["width"] as? Number)?.toDouble() ?: return full
        val uh = (raw["height"] as? Number)?.toDouble() ?: return full
        if (uw <= 0.0 || uh <= 0.0) return full

        // Upright-normalized -> buffer-normalized (inverse of rotationDegrees).
        val r = ((rotationDegrees % 360) + 360) % 360
        val nx: Double
        val ny: Double
        val nw: Double
        val nh: Double
        when (r) {
            90 -> { nx = uy; ny = 1.0 - ux - uw; nw = uh; nh = uw }
            180 -> { nx = 1.0 - ux - uw; ny = 1.0 - uy - uh; nw = uw; nh = uh }
            270 -> { nx = 1.0 - uy - uh; ny = ux; nw = uh; nh = uw }
            else -> { nx = ux; ny = uy; nw = uw; nh = uh }
        }
        if (nw <= 0.0 || nh <= 0.0) return full

        // NV21 chroma is 2x2 subsampled, so odd offsets or odd extents shift
        // the chroma plane relative to luma and tint the output. Snap to even.
        val left = (nx * width).toInt().coerceIn(0, width - 2) and 1.inv()
        val top = (ny * height).toInt().coerceIn(0, height - 2) and 1.inv()
        val right = ((nx + nw) * width).toInt().coerceIn(left + 2, width) and 1.inv()
        val bottom = ((ny + nh) * height).toInt().coerceIn(top + 2, height) and 1.inv()

        if (right <= left || bottom <= top) return full
        return Rect(left, top, right, bottom)
    }

    /**
     * Deletes the JPEG written by the previous call, if it still exists.
     * Failures are ignored on purpose — a leftover temp file is recoverable
     * by the OS, but throwing here would kill the frame processor.
     */
    private fun deleteLastFile() {
        val path = lastFilePath ?: return
        lastFilePath = null
        try {
            val f = File(path)
            if (f.exists()) f.delete()
        } catch (_: Exception) {
            // Ignore — see kdoc.
        }
    }

    private fun resultMap(path: String, width: Int, height: Int, rotationDegrees: Int): HashMap<String, Any?> {
        return hashMapOf(
            "path" to path,
            "width" to width,
            "height" to height,
            "orientation" to orientationString(rotationDegrees)
        )
    }

    /**
     * YUV_420_888 → NV21 (Y plane then interleaved VU). Handles arbitrary
     * `rowStride` / `pixelStride` per Android plane spec.
     */
    private fun yuv420ToNv21(image: Image): ByteArray {
        val width = image.width
        val height = image.height
        val ySize = width * height
        val uvSize = width * height / 4
        val nv21 = ByteArray(ySize + uvSize * 2)

        val yPlane = image.planes[0]
        val uPlane = image.planes[1]
        val vPlane = image.planes[2]

        val yBuffer = yPlane.buffer
        val uBuffer = uPlane.buffer
        val vBuffer = vPlane.buffer

        // Copy Y plane (handles rowStride padding).
        val yRowStride = yPlane.rowStride
        var pos = 0
        if (yRowStride == width) {
            yBuffer.get(nv21, 0, ySize)
            pos = ySize
        } else {
            val row = ByteArray(yRowStride)
            for (r in 0 until height) {
                yBuffer.position(r * yRowStride)
                yBuffer.get(row, 0, yRowStride)
                System.arraycopy(row, 0, nv21, pos, width)
                pos += width
            }
        }

        // Interleave V and U into NV21 (V first, then U, per NV21 spec).
        val uRowStride = uPlane.rowStride
        val uPixelStride = uPlane.pixelStride
        val vRowStride = vPlane.rowStride
        val vPixelStride = vPlane.pixelStride
        val chromaHeight = height / 2
        val chromaWidth = width / 2

        for (r in 0 until chromaHeight) {
            for (c in 0 until chromaWidth) {
                val uIndex = r * uRowStride + c * uPixelStride
                val vIndex = r * vRowStride + c * vPixelStride
                nv21[pos++] = vBuffer.get(vIndex)
                nv21[pos++] = uBuffer.get(uIndex)
            }
        }

        return nv21
    }

    private fun exifOrientation(rotationDegrees: Int): Int {
        return when (rotationDegrees) {
            90 -> ExifInterface.ORIENTATION_ROTATE_90
            180 -> ExifInterface.ORIENTATION_ROTATE_180
            270 -> ExifInterface.ORIENTATION_ROTATE_270
            else -> ExifInterface.ORIENTATION_NORMAL
        }
    }

    private fun orientationString(rotationDegrees: Int): String {
        return when (rotationDegrees) {
            90 -> "landscape-right"
            180 -> "portrait-upside-down"
            270 -> "landscape-left"
            else -> "portrait"
        }
    }
}
