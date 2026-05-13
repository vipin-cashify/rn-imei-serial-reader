import { useMemo } from 'react';
import type { Frame } from 'react-native-vision-camera';
import { useResizePlugin } from 'vision-camera-resize-plugin';
import type { FrameOrientation } from '../types';

export interface RgbExtractor {
  (frame: Frame): {
    // Plain number[] (not Uint8Array): worklets-core's runOnJS does not
    // transfer TypedArray payloads across runtimes; primitive arrays do.
    rgb: number[];
    width: number;
    height: number;
    orientation: FrameOrientation;
  };
}

/**
 * Builds a worklet-callable function that extracts raw RGB pixel bytes from
 * the *active* frame. We deliberately do not scale or crop here — we want the
 * same fidelity the OCR engine saw. JPEG encoding happens on the JS thread
 * after the runOnJS hop (see encodeAndWriteJpeg).
 */
export function useRgbExtractor(): RgbExtractor {
  const { resize } = useResizePlugin();

  return useMemo<RgbExtractor>(
    () => (frame: Frame) => {
      'worklet';

      // Map device-relative frame orientation to the CW rotation that lands
      // the output upright. Inlined (not a helper fn) because file-local
      // helpers don't reliably ride into worklet scope.
      const orient = frame.orientation;
      let rotation: '0deg' | '90deg' | '180deg' | '270deg' = '0deg';
      if (orient === 'landscape-right') rotation = '90deg';
      else if (orient === 'landscape-left') rotation = '270deg';
      else if (orient === 'portrait-upside-down') rotation = '180deg';

      const out = resize(frame, {
        pixelFormat: 'rgb',
        dataType: 'uint8',
        rotation,
      });

      // After a 90°/270° rotation the output's logical dims are swapped vs
      // the raw frame dims.
      const isQuarterTurn = rotation === '90deg' || rotation === '270deg';
      const outWidth = isQuarterTurn ? frame.height : frame.width;
      const outHeight = isQuarterTurn ? frame.width : frame.height;

      // The resize plugin owns the returned buffer and may free it as soon
      // as the worklet returns. Convert to plain number[] so the payload
      // survives the runOnJS boundary (Uint8Array does not transfer).
      const src = out as unknown as Uint8Array;
      const len = src.length;
      const copy = new Array<number>(len);
      for (let i = 0; i < len; i++) copy[i] = src[i] as number;
      let sum = 0;
      for (let i = 0; i < 12 && i < len; i++) sum += copy[i] as number;
      console.log(
        `[frameToRgb][worklet] rgb len=${len} first12sum=${sum} rot=${rotation} (frame ${frame.width}x${frame.height} ${orient} -> out ${outWidth}x${outHeight})`,
      );

      return {
        rgb: copy,
        width: outWidth,
        height: outHeight,
        orientation: orient as FrameOrientation,
      };
    },
    [resize],
  );
}
