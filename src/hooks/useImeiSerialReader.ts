import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Camera,
  type CameraDevice,
  type CameraDeviceFormat,
  runAtTargetFps,
  useCameraDevice,
  useCameraFormat,
  useCameraPermission,
  useFrameProcessor,
} from 'react-native-vision-camera';
import { Worklets, useSharedValue } from 'react-native-worklets-core';
import { PhotoRecognizer } from 'react-native-vision-camera-text-recognition';
import { createParser } from '../parsers';
import type { DocumentFields } from '../parsers/types';
import { toRecognizedText } from '../adapters/mlkitAdapter';
import { nativeFrameToJpeg } from '../adapters/nativeFrameToJpeg';
import { computeCropRect, resolveScanRegion, type ScanRegionOptions } from '../scanRegion';
import {
  toPhotoRecognizerOrientation,
  type Frame,
  type FrameOrientation,
  type ParserConfig,
} from '../types';

const GRACE_MS = 1000;
/**
 * Frames per second offered to the pipeline.
 *
 * This is a ceiling, not a rate: `isProcessing` serialises OCR, so a frame is
 * only taken when the previous one has finished. Measured on-device, ML Kit
 * takes ~200ms when it finds no text and ~950ms when it does — so asking for 10
 * fps meant discarding roughly nine requests out of ten while still paying to
 * deliver each frame to the worklet.
 *
 * 5 fps comfortably exceeds what OCR can consume, so nothing is lost in
 * responsiveness, and the frame thread does markedly less throwaway work.
 */
const TARGET_FPS = 5;
const JPEG_QUALITY = 80;

export interface UseImeiSerialReaderOptions {
  parserConfig: ParserConfig;
  /**
   * Fired once a parser matches.
   *
   * `values` holds the matched strings — for document readers (PAN, …) that is
   * the primary identifier. `fields` carries the named breakdown and is only
   * present for document readers, so existing consumers can ignore it.
   */
  onDone: (values: string[], frame?: Frame, fields?: DocumentFields) => void;
  onError?: (error: Error) => void;
  captureFrame?: boolean;
  /**
   * Restricts OCR to a card-shaped region of the frame. The frame is cropped
   * natively before OCR, so background text cannot produce false matches and
   * there are fewer pixels to encode and scan.
   *
   * ON BY DEFAULT — pass `{ enabled: false }` to scan the full frame.
   */
  scanRegion?: ScanRegionOptions;
  /**
   * Preview fit mode. Defaults to `'contain'` while a scan region is active,
   * because `'cover'` centre-crops the buffer and introduces a scale+offset
   * between screen and buffer coordinates that must then be corrected for.
   * `'contain'` makes that correction the identity.
   */
  resizeMode?: 'cover' | 'contain';
}

export interface UseImeiSerialReaderReturn {
  cameraRef: React.RefObject<Camera | null>;
  isActive: boolean;
  reload: () => void;
  error: Error | null;
  device: CameraDevice | undefined;
  format: CameraDeviceFormat | undefined;
  hasPermission: boolean;
  requestPermission: () => Promise<boolean>;
  frameProcessor: ReturnType<typeof useFrameProcessor>;
  /** Feed the camera view's measured size in so the crop rect can be computed. */
  onCameraLayout: (width: number, height: number) => void;
  /** Effective preview fit mode — pass to `<Camera resizeMode>`. */
  resizeMode: 'cover' | 'contain';
}

export function useImeiSerialReader(opts: UseImeiSerialReaderOptions): UseImeiSerialReaderReturn {
  const cameraRef = useRef<Camera>(null);
  const [isActive, setIsActive] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const { hasPermission, requestPermission } = useCameraPermission();
  const device = useCameraDevice('back');
  // A scan region crops to ~25% of the frame area, so a 1280x720 buffer yields
  // a ~400x630 image. ML Kit needs roughly 16px of text height to read
  // reliably, and a PAN card's five label/value pairs at that size sit right at
  // the limit — measured on-device it found 0-1 blocks and took ~1.1s per
  // frame. Requesting 1920x1080 when cropping keeps the crop around 600x950,
  // which restores usable text height. A scan region is the default, so
  // `enabled: false` is the opt-out rather than an absent option.
  const wantsHighRes = opts.scanRegion?.enabled !== false;
  const format = useCameraFormat(
    device,
    wantsHighRes
      ? [
          { photoResolution: { width: 1920, height: 1080 } },
          { videoResolution: { width: 1920, height: 1080 } },
        ]
      : [
          { photoResolution: { width: 1920, height: 1080 } },
          { videoResolution: { width: 1280, height: 720 } },
        ],
  );

  const isBusy = useSharedValue<boolean>(false);
  const graceUntil = useSharedValue<number>(0);
  // True while a JS-thread PhotoRecognizer call is in flight. Prevents the
  // frame processor from queueing up multiple OCR requests — one attempt
  // completes before the next frame is even considered.
  const isProcessing = useSharedValue<boolean>(false);

  // The frame processor is a worklet, so the crop rect must reach it as a
  // shared value — refs do not cross into worklet scope. Serialized to four
  // numbers because plain objects are simplest to capture reliably.
  // A width of 0 means "not measured yet, do not crop".
  const cropX = useSharedValue<number>(0);
  const cropY = useSharedValue<number>(0);
  const cropW = useSharedValue<number>(0);
  const cropH = useSharedValue<number>(0);

  const onDoneRef = useRef(opts.onDone);
  onDoneRef.current = opts.onDone;
  const onErrorRef = useRef(opts.onError);
  onErrorRef.current = opts.onError;
  // OCR runs on the JS thread now, so this ref is read from `recognizeAndMatch`.
  const captureFrameRef = useRef(!!opts.captureFrame);
  captureFrameRef.current = !!opts.captureFrame;

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
    // NOTE: exhaustive-deps is disabled above, so EVERY ParserConfig field
    // must be listed here by hand. Omitting one compiles, lints, and passes
    // tests — the parser just silently never rebuilds when that field changes.
    opts.parserConfig.requireAllFields,
  ]);
  const parser = parserResult.parser;

  useEffect(() => {
    setError(parserResult.error);
    if (parserResult.error != null) {
      onErrorRef.current?.(parserResult.error);
    }
  }, [parserResult]);

  useEffect(() => {
    if (isActive) {
      isBusy.value = false;
      graceUntil.value = Date.now() + GRACE_MS;
    }
  }, [isActive, isBusy, graceUntil]);

  const resolvedRegion = useMemo(() => resolveScanRegion(opts.scanRegion), [opts.scanRegion]);
  const hasScanRegion = resolvedRegion.enabled;
  // 'cover' hides ~18% of the buffer behind a centre-crop, which would have to
  // be corrected for in the view->buffer transform. Defaulting a scan region to
  // 'contain' makes that correction the identity and removes the largest
  // source of silent crop error.
  const resizeMode: 'cover' | 'contain' = opts.resizeMode ?? (hasScanRegion ? 'contain' : 'cover');

  const onCameraLayout = useCallback(
    (viewWidth: number, viewHeight: number) => {
      if (!hasScanRegion) {
        cropW.value = 0;
        return;
      }
      // The buffer dims AS DISPLAYED. The format is landscape (e.g. 1280x720)
      // while the preview is portrait, so swap before computing the fit.
      const fw = format?.videoWidth ?? 1280;
      const fh = format?.videoHeight ?? 720;
      const displayedW = Math.min(fw, fh);
      const displayedH = Math.max(fw, fh);

      const rect = computeCropRect({
        region: resolvedRegion,
        viewWidth,
        viewHeight,
        bufferWidth: displayedW,
        bufferHeight: displayedH,
        resizeMode,
        // The native side receives an already-upright image on iOS, and on
        // Android applies the rect to the raw buffer whose rotation it knows.
        // Rotation is therefore handled natively; pass the rect upright.
        rotationDegrees: 0,
      });
      if (rect == null) {
        cropW.value = 0;
        return;
      }
      cropX.value = rect.x;
      cropY.value = rect.y;
      cropW.value = rect.width;
      cropH.value = rect.height;
    },
    [hasScanRegion, resolvedRegion, resizeMode, format, cropX, cropY, cropW, cropH],
  );

  const reportError = useCallback((e: Error) => {
    setError(e);
    onErrorRef.current?.(e);
  }, []);
  const reportErrorJs = useMemo(() => Worklets.createRunOnJS(reportError), [reportError]);

  // JS-thread OCR + match handler. Called via `runOnJS` from the frame
  // processor with a JPEG file path (already written on the frame thread).
  // PhotoRecognizer is a plain NativeModule call — no worklets involved —
  // so it avoids the SIGSEGV in worklets-core's `invokeOnWorkletThread`
  // that killed the old `runAsync(frame, ...)` path under bridgeless mode.
  const recognizeAndMatch = useCallback(
    async (path: string, width: number, height: number, orientation: FrameOrientation) => {
      try {
        if (parser == null) return;
        const raw = await PhotoRecognizer({
          uri: `file://${path}`,
          // The plugin expects camelCase ('landscapeLeft'); our public
          // FrameOrientation is kebab-case ('landscape-left'). Passing ours
          // through directly meant only 'portrait' ever matched and every
          // other orientation was silently dropped by the plugin.
          orientation: toPhotoRecognizerOrientation(orientation),
        });
        const rt = toRecognizedText(raw);

        const result = parser(rt);
        // Gate on `result.values`, never on `result.length`: a ParserResult is
        // an object, so a `.length > 0` check would read `undefined > 0` →
        // false and silently never fire onDone.
        if (result != null && result.values.length > 0) {
          isBusy.value = true;
          const frameForConsumer: Frame | undefined = captureFrameRef.current
            ? { uri: `file://${path}`, width, height, orientation }
            : undefined;
          onDoneRef.current(result.values, frameForConsumer, result.fields);
        }
      } catch (e) {
        const err = e as Error;
        setError(err);
        onErrorRef.current?.(err);
      } finally {
        isProcessing.value = false;
      }
    },
    [parser, isBusy, isProcessing],
  );
  const recognizeAndMatchJs = useMemo(
    () => Worklets.createRunOnJS(recognizeAndMatch),
    [recognizeAndMatch],
  );

  const frameProcessor = useFrameProcessor(
    (frame) => {
      'worklet';
      if (parser == null) return;
      runAtTargetFps(TARGET_FPS, () => {
        'worklet';
        if (isBusy.value) return;
        if (isProcessing.value) return;
        if (Date.now() < graceUntil.value) return;

        // Do only the fast, synchronous YUV→JPEG conversion on the camera
        // frame thread (~20-50ms), then hand the path to the JS thread for
        // OCR via PhotoRecognizer. This keeps the camera pipeline
        // unblocked — preview stays smooth even though ML Kit runs off
        // the frame thread. Also sidesteps the bridgeless SIGSEGV
        // triggered by vision-camera's `runAsync` + worklets-core
        // secondary runtime path.
        try {
          isProcessing.value = true;
          // Width 0 means the view has not been measured yet (or no scan
          // region is configured) — encode the full frame rather than crop
          // against a stale or zero size.
          const crop =
            cropW.value > 0
              ? { x: cropX.value, y: cropY.value, width: cropW.value, height: cropH.value }
              : null;
          const ext = nativeFrameToJpeg(frame, JPEG_QUALITY, crop);
          recognizeAndMatchJs(ext.path, ext.width, ext.height, ext.orientation);
        } catch (e) {
          isProcessing.value = false;
          reportErrorJs(e as Error);
        }
      });
    },
    [
      parser,
      recognizeAndMatchJs,
      reportErrorJs,
      isBusy,
      isProcessing,
      graceUntil,
      cropX,
      cropY,
      cropW,
      cropH,
    ],
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
    format,
    hasPermission,
    requestPermission,
    frameProcessor,
    onCameraLayout,
    resizeMode,
  };
}
