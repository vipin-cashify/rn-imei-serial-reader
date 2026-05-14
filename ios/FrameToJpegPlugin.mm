#import <Foundation/Foundation.h>
#import <VisionCamera/FrameProcessorPlugin.h>
#import <VisionCamera/FrameProcessorPluginRegistry.h>
#import <VisionCamera/Frame.h>

#if __has_include("react_native_imei_serial_reader/react_native_imei_serial_reader-Swift.h")
#import "react_native_imei_serial_reader/react_native_imei_serial_reader-Swift.h"
#else
#import "react_native_imei_serial_reader-Swift.h"
#endif

@interface FrameToJpegPlugin (FrameProcessorPluginLoader)
@end

@implementation FrameToJpegPlugin (FrameProcessorPluginLoader)
+ (void) load {
  [FrameProcessorPluginRegistry addFrameProcessorPlugin:@"frameToJpeg"
    withInitializer:^FrameProcessorPlugin*(VisionCameraProxyHolder* proxy, NSDictionary* options) {
      return [[FrameToJpegPlugin alloc] initWithProxy:proxy withOptions:options];
    }];
}
@end
