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

    override fun callback(frame: Frame, arguments: Map<String, Any>?): HashMap<String, Any?>? {
        val quality = (arguments?.get("quality") as? Number)?.toInt() ?: 80
        val image: Image = frame.image
        val width = image.width
        val height = image.height
        val rotationDegrees = frame.imageProxy.imageInfo.rotationDegrees

        val nv21 = yuv420ToNv21(image)
        val yuv = YuvImage(nv21, ImageFormat.NV21, width, height, null)
        val baos = ByteArrayOutputStream()
        yuv.compressToJpeg(Rect(0, 0, width, height), quality, baos)
        val jpegBytes = baos.toByteArray()

        val outFile = File.createTempFile("imei-", ".jpg")
        FileOutputStream(outFile).use { it.write(jpegBytes) }

        // Embed EXIF orientation so consumers (e.g. RN <Image>) display upright
        // without us doing a decode/rotate/encode round-trip.
        val exif = ExifInterface(outFile.absolutePath)
        exif.setAttribute(ExifInterface.TAG_ORIENTATION, exifOrientation(rotationDegrees).toString())
        exif.saveAttributes()

        return resultMap(outFile.absolutePath, width, height, rotationDegrees)
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
