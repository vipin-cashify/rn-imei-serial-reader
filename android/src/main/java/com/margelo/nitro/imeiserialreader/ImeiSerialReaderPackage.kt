package com.margelo.nitro.imeiserialreader

import com.facebook.react.BaseReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.module.model.ReactModuleInfoProvider

/**
 * Found by React Native autolinking. It registers no modules; its only job is
 * to load the Nitro natives so `OcrRecognizerFactory` can be created from JS.
 */
class ImeiSerialReaderPackage : BaseReactPackage() {
  override fun getModule(name: String, reactContext: ReactApplicationContext): NativeModule? = null

  override fun getReactModuleInfoProvider(): ReactModuleInfoProvider = ReactModuleInfoProvider { HashMap() }

  companion object {
    init {
      ImeiSerialReaderOnLoad.initializeNative()
    }
  }
}
