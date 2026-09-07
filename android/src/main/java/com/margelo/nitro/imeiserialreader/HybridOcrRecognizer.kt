package com.margelo.nitro.imeiserialreader

import com.margelo.nitro.camera.HybridCameraOutputSpec

class HybridOcrRecognizer(config: OcrRecognizerConfig) : HybridOcrRecognizerSpec() {
  private val cameraOutput = OcrCameraOutput(config)

  override val output: HybridCameraOutputSpec
    get() = cameraOutput

  override fun setCropRect(rect: NormalizedRect?) {
    cameraOutput.cropRect = rect
  }

  override fun setPaused(paused: Boolean) {
    cameraOutput.isPaused = paused
  }

  override fun dispose() {
    super.dispose()
    cameraOutput.dispose()
  }
}
