package com.margelo.nitro.imeiserialreader

import android.graphics.Rect
import com.google.mlkit.vision.text.Text

internal fun Rect?.toOcrBox(): OcrBox {
  if (this == null) return OcrBox(0.0, 0.0, 0.0, 0.0)
  return OcrBox(left.toDouble(), top.toDouble(), width().toDouble(), height().toDouble())
}

/** MLKit boxes are already in the upright (rotated) image's coordinate space. */
internal fun Text.toOcrBlocks(): Array<OcrBlock> =
  textBlocks
    .map { block ->
      OcrBlock(
        block.text,
        block.boundingBox.toOcrBox(),
        block.lines
          .map { line ->
            OcrLine(
              line.text,
              line.boundingBox.toOcrBox(),
              line.elements.map { element -> OcrElement(element.text, element.boundingBox.toOcrBox()) }.toTypedArray(),
            )
          }
          .toTypedArray(),
      )
    }
    .toTypedArray()

/** Same mapping the 4.x `frameToJpeg` plugin used for its `orientation` string. */
internal fun Int.toOcrOrientation(): OcrFrameOrientation =
  when (((this % 360) + 360) % 360) {
    90 -> OcrFrameOrientation.LANDSCAPE_RIGHT
    180 -> OcrFrameOrientation.PORTRAIT_UPSIDE_DOWN
    270 -> OcrFrameOrientation.LANDSCAPE_LEFT
    else -> OcrFrameOrientation.PORTRAIT
  }
