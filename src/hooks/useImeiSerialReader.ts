import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Camera,
  type CameraDevice,
  runAtTargetFps,
  useCameraDevice,
  useCameraPermission,
  useFrameProcessor,
} from 'react-native-vision-camera';
import { Worklets, useSharedValue } from 'react-native-worklets-core';
import { useTextRecognition } from 'react-native-vision-camera-text-recognition';
import { createParser } from '../parsers';
import { toRecognizedText } from '../adapters/mlkitAdapter';
import { useRgbExtractor } from '../adapters/frameToRgb';
import { encodeAndWriteJpeg } from '../adapters/encodeAndWriteJpeg';
import type { Frame, FrameOrientation, ParserConfig } from '../types';

const GRACE_MS = 1000;
const TARGET_FPS = 10;
const TEXT_RECOGNITION_OPTIONS = { language: 'latin' } as const;
const LOG = '[IMEI-Reader]';

let frameProcessorBuildCount = 0;

export interface UseImeiSerialReaderOptions {
  parserConfig: ParserConfig;
  onDone: (values: string[], frame?: Frame) => void;
  onError?: (error: Error) => void;
  captureFrame?: boolean;
}

export interface UseImeiSerialReaderReturn {
  cameraRef: React.RefObject<Camera | null>;
  isActive: boolean;
  reload: () => void;
  error: Error | null;
  device: CameraDevice | undefined;
  hasPermission: boolean;
  requestPermission: () => Promise<boolean>;
  frameProcessor: ReturnType<typeof useFrameProcessor>;
}

export function useImeiSerialReader(opts: UseImeiSerialReaderOptions): UseImeiSerialReaderReturn {
  const cameraRef = useRef<Camera>(null);
  const [isActive, setIsActive] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const { hasPermission, requestPermission } = useCameraPermission();
  const device = useCameraDevice('back');

  const renderCountRef = useRef(0);
  renderCountRef.current += 1;
  console.log(
    `${LOG} render #${renderCountRef.current} hasPermission=${hasPermission} device=${device?.id ?? 'null'} isActive=${isActive} error=${error?.message ?? 'null'}`,
  );

  const isBusy = useSharedValue<boolean>(false);
  const graceUntil = useSharedValue<number>(0);
  const frameTick = useSharedValue<number>(0);

  const onDoneRef = useRef(opts.onDone);
  onDoneRef.current = opts.onDone;
  const onErrorRef = useRef(opts.onError);
  onErrorRef.current = opts.onError;

  const captureFrameFlag = useSharedValue<boolean>(!!opts.captureFrame);
  useEffect(() => {
    captureFrameFlag.value = !!opts.captureFrame;
  }, [opts.captureFrame, captureFrameFlag]);

  const parserResult = useMemo<{ parser: ReturnType<typeof createParser> | null; error: Error | null }>(() => {
    try {
      return { parser: createParser(opts.parserConfig), error: null };
    } catch (e) {
      return { parser: null, error: e as Error };
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    opts.parserConfig.readerType,
    opts.parserConfig.customRegex,
    opts.parserConfig.targetBarcode,
    opts.parserConfig.minLength,
    opts.parserConfig.maxLength,
  ]);
  const parser = parserResult.parser;

  useEffect(() => {
    setError(parserResult.error);
    if (parserResult.error != null) {
      onErrorRef.current?.(parserResult.error);
    }
  }, [parserResult]);

  useEffect(() => {
    console.log(`${LOG} isActive effect -> ${isActive}`);
    if (isActive) {
      isBusy.value = false;
      graceUntil.value = Date.now() + GRACE_MS;
    }
  }, [isActive, isBusy, graceUntil]);

  const handleMatch = useCallback(
    async (
      values: string[],
      rgb: number[] | null,
      width: number,
      height: number,
      orientation: FrameOrientation | null,
    ) => {
      try {
        let frame: Frame | undefined;
        if (rgb != null && rgb.length > 0 && width > 0 && height > 0 && orientation != null) {
          let sum = 0;
          for (let i = 0; i < 12 && i < rgb.length; i++) sum += rgb[i] as number;
          console.log(
            `${LOG} handleMatch on JS thread rgb len=${rgb.length} first12sum=${sum} ${width}x${height} ${orientation}`,
          );
          const bytes = Uint8Array.from(rgb);
          const path = await encodeAndWriteJpeg({ rgb: bytes, width, height });
          frame = { uri: `file://${path}`, width, height, orientation };
        }
        onDoneRef.current(values, frame);
      } catch (e) {
        const err = e as Error;
        setError(err);
        onErrorRef.current?.(err);
      } finally {
        isBusy.value = false;
      }
    },
    [isBusy],
  );

  const reportError = useCallback((e: Error) => {
    setError(e);
    onErrorRef.current?.(e);
  }, []);

  const handleMatchJs = useMemo(() => Worklets.createRunOnJS(handleMatch), [handleMatch]);
  const reportErrorJs = useMemo(() => Worklets.createRunOnJS(reportError), [reportError]);

  const { scanText } = useTextRecognition(TEXT_RECOGNITION_OPTIONS);
  const extractRgb = useRgbExtractor();

  frameProcessorBuildCount += 1;
  console.log(`${LOG} building frameProcessor (#${frameProcessorBuildCount}) parser=${parser != null}`);

  const frameProcessor = useFrameProcessor(
    (frame) => {
      'worklet';
      frameTick.value = frameTick.value + 1;
      const tick = frameTick.value;
      if (tick % 30 === 1) {
        console.log(
          `${LOG}[worklet] frame tick ${tick} ${frame.width}x${frame.height} orient=${frame.orientation} pixelFormat=${frame.pixelFormat}`,
        );
      }
      if (parser == null) {
        if (tick % 30 === 1) console.log(`${LOG}[worklet] no parser, skip`);
        return;
      }
      runAtTargetFps(TARGET_FPS, () => {
        'worklet';
        if (isBusy.value) {
          console.log(`${LOG}[worklet] busy, skip`);
          return;
        }
        if (Date.now() < graceUntil.value) {
          console.log(`${LOG}[worklet] in grace period, skip`);
          return;
        }
        isBusy.value = true;
        try {
          console.log(`${LOG}[worklet] calling scanText...`);
          const raw = scanText(frame);
          console.log(`${LOG}[worklet] scanText returned, type=${typeof raw}`);
          const rt = toRecognizedText(raw);
          console.log(`${LOG}[worklet] toRecognizedText: blocks=${rt?.blocks?.length ?? -1}`);
          const values = parser(rt);
          console.log(`${LOG}[worklet] parser values=${values == null ? 'null' : values.length}`);
          if (values != null && values.length > 0) {
            if (captureFrameFlag.value) {
              const ext = extractRgb(frame);
              handleMatchJs(values, ext.rgb, ext.width, ext.height, ext.orientation);
            } else {
              handleMatchJs(values, null, 0, 0, null);
            }
          } else {
            isBusy.value = false;
          }
        } catch (e) {
          isBusy.value = false;
          console.log(`${LOG}[worklet] ERROR: ${(e as Error)?.message ?? String(e)}`);
          reportErrorJs(e as Error);
        }
      });
    },
    [parser, scanText, extractRgb, handleMatchJs, reportErrorJs, isBusy, graceUntil, captureFrameFlag, frameTick],
  );

  const reload = useCallback(() => {
    setError(null);
    setIsActive(false);
    setTimeout(() => setIsActive(true), 50);
  }, []);

  useEffect(() => {
    if (!hasPermission) {
      void requestPermission();
    }
  }, [hasPermission, requestPermission]);

  return {
    cameraRef,
    isActive,
    reload,
    error,
    device,
    hasPermission,
    requestPermission,
    frameProcessor,
  };
}
