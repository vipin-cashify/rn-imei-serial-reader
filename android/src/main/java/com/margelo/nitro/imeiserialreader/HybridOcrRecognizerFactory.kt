package com.margelo.nitro.imeiserialreader

import androidx.annotation.Keep
import com.facebook.proguard.annotations.DoNotStrip

@DoNotStrip
@Keep
class HybridOcrRecognizerFactory : HybridOcrRecognizerFactorySpec() {
  @DoNotStrip
  @Keep
  override fun createOcrRecognizer(config: OcrRecognizerConfig): HybridOcrRecognizerSpec = HybridOcrRecognizer(config)
}
