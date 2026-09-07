package com.margelo.nitro.imeiserialreader

import android.graphics.Rect
import android.media.Image

/** YUV_420_888 crop + NV21 conversion helpers. Pure functions; no camera state. */
object YuvCrop {
  /**
   * Converts an upright-normalised rect (as the user sees it on screen) into a
   * pixel rect in BUFFER space. CameraX hands us sensor-native pixels and only
   * reports `rotationDegrees` (the rotation needed to make them upright), so
   * the rect is rotated by the inverse first. Bounds are snapped to even values
   * because NV21 chroma is 2x2 subsampled.
   *
   * Returns the full frame when `rect` is null or unusable.
   */
  fun bufferRect(rect: NormalizedRect?, width: Int, height: Int, rotationDegrees: Int): Rect {
    val full = Rect(0, 0, width, height)
    if (rect == null) return full
    val ux = rect.x
    val uy = rect.y
    val uw = rect.width
    val uh = rect.height
    if (uw <= 0.0 || uh <= 0.0) return full

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

    val left = (nx * width).toInt().coerceIn(0, width - 2) and 1.inv()
    val top = (ny * height).toInt().coerceIn(0, height - 2) and 1.inv()
    val right = ((nx + nw) * width).toInt().coerceIn(left + 2, width) and 1.inv()
    val bottom = ((ny + nh) * height).toInt().coerceIn(top + 2, height) and 1.inv()
    if (right <= left || bottom <= top) return full
    return Rect(left, top, right, bottom)
  }

  /**
   * YUV_420_888 → NV21 (Y plane, then interleaved VU) for `crop` only. Handles
   * arbitrary `rowStride` / `pixelStride`. `crop` bounds must be even.
   */
  fun toNv21(image: Image, crop: Rect): ByteArray {
    val cw = crop.width()
    val ch = crop.height()
    val ySize = cw * ch
    val nv21 = ByteArray(ySize + ySize / 2)

    val yPlane = image.planes[0]
    val uPlane = image.planes[1]
    val vPlane = image.planes[2]
    val yBuffer = yPlane.buffer
    val uBuffer = uPlane.buffer
    val vBuffer = vPlane.buffer

    var pos = 0
    val yRowStride = yPlane.rowStride
    val yPixelStride = yPlane.pixelStride
    if (yPixelStride == 1) {
      for (row in 0 until ch) {
        yBuffer.position((crop.top + row) * yRowStride + crop.left)
        yBuffer.get(nv21, pos, cw)
        pos += cw
      }
    } else {
      for (row in 0 until ch) {
        val base = (crop.top + row) * yRowStride
        for (col in 0 until cw) {
          nv21[pos++] = yBuffer.get(base + (crop.left + col) * yPixelStride)
        }
      }
    }

    val uRowStride = uPlane.rowStride
    val uPixelStride = uPlane.pixelStride
    val vRowStride = vPlane.rowStride
    val vPixelStride = vPlane.pixelStride
    val chromaLeft = crop.left / 2
    val chromaTop = crop.top / 2
    val chromaWidth = cw / 2
    val chromaHeight = ch / 2
    for (row in 0 until chromaHeight) {
      val uRow = (chromaTop + row) * uRowStride
      val vRow = (chromaTop + row) * vRowStride
      for (col in 0 until chromaWidth) {
        val c = chromaLeft + col
        nv21[pos++] = vBuffer.get(vRow + c * vPixelStride)
        nv21[pos++] = uBuffer.get(uRow + c * uPixelStride)
      }
    }
    return nv21
  }
}
