import { VisionCameraProxy, type Frame } from 'react-native-vision-camera';
import type { FrameOrientation } from '../types';

const plugin = VisionCameraProxy.initFrameProcessorPlugin('frameToJpeg', {});

export interface NativeFrameToJpegResult {
  path: string;
  width: number;
  height: number;
  orientation: FrameOrientation;
}

/**
 * Invokes the bundled native `frameToJpeg` Frame Processor Plugin to write the
 * current frame to a JPEG file in the platform temp dir and returns the path.
 *
 * Must be called from inside a worklet runtime (frame access). Returns only
 * primitive values, so it is safe to call inside `runAsync` — unlike the
 * resize plugin which returns an ArrayBuffer with JSI runtime affinity.
 */
export function nativeFrameToJpeg(
  frame: Frame,
  quality: number = 80,
  cropRect?: { x: number; y: number; width: number; height: number } | null,
): NativeFrameToJpegResult {
  'worklet';
  if (plugin == null) {
    throw new Error(
      "frameToJpeg native plugin not installed. Did you rebuild the app after upgrading react-native-imei-serial-reader?",
    );
  }
  // `cropRect` is buffer-normalized with a top-left origin. Omitting it makes
  // the plugin encode the full frame, so this stays backward compatible with
  // an app whose native side has not been rebuilt.
  const result = (
    cropRect != null
      ? plugin.call(frame, {
          quality,
          cropRect: {
            x: cropRect.x,
            y: cropRect.y,
            width: cropRect.width,
            height: cropRect.height,
          },
        })
      : plugin.call(frame, { quality })
  ) as unknown as Record<string, unknown>;
  return {
    path: result.path as string,
    width: result.width as number,
    height: result.height as number,
    orientation: result.orientation as FrameOrientation,
  };
}
