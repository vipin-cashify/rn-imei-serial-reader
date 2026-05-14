package com.cashify.imeireader

import com.facebook.react.ReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.uimanager.ViewManager
import com.mrousavy.camera.frameprocessors.FrameProcessorPluginRegistry

class ImeiSerialReaderPackage : ReactPackage {
    companion object {
        init {
            FrameProcessorPluginRegistry.addFrameProcessorPlugin("frameToJpeg") { proxy, options ->
                FrameToJpegPlugin(proxy, options)
            }
        }
    }

    override fun createNativeModules(reactContext: ReactApplicationContext): List<NativeModule> = emptyList()

    override fun createViewManagers(reactContext: ReactApplicationContext): List<ViewManager<*, *>> = emptyList()
}
