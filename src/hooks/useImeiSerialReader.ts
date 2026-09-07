import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  useCameraDevice,
  useCameraPermission,
  type CameraDevice,
  type CameraOutput,
  type CameraRef,
} from 'react-native-vision-camera';
import { toRecognizedText } from '../adapters/ocrAdapter';
import { createOcrRecognizer } from '../native/createOcrRecognizer';
import { createParser } from '../parsers';
import type { DocumentFields } from '../parsers/types';
import { computeCropRect, resolveScanRegion, type ScanRegionOptions } from '../scanRegion';
import type { OcrFrame } from '../specs/OcrRecognizer.nitro';
import type { Frame, ParserConfig } from '../types';

/** Ignore frames for this long after (re)activation so a stale scene does not match. */
const GRACE_MS = 1000;
/**
 * Upper bound on analysed frames per second. MLKit takes ~200ms with no text
 * and ~950ms with text on mid-range devices; 5 fps exceeds what OCR can consume
 * while keeping the analysis thread mostly idle. Enforced natively.
 */
const TARGET_FPS = 5;
const JPEG_QUALITY = 80;
/** Fallback analysis size AS DISPLAYED (portrait) until the session reports its resolution. */
const DEFAULT_BUFFER: BufferSize = { width: 720, height: 1280 };

export interface BufferSize {
  width: number;
  height: number;
}

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
  /** Deliver the matching frame as a JPEG `Frame` in `onDone`. Costs a JPEG encode per analysed frame. */
  captureFrame?: boolean;
  /**
   * Restricts OCR to a card-shaped region of the frame. The frame is cropped
   * natively before OCR, so background text cannot produce false matches and
   * there are fewer pixels to scan.
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
  cameraRef: React.RefObject<CameraRef | null>;
  isActive: boolean;
  reload: () => void;
  error: Error | null;
  device: CameraDevice | undefined;
  /** Pass to `<Camera outputs>`. Stable until the parser/capture options change. */
  outputs: CameraOutput[];
  /** Analysis buffer size AS DISPLAYED (portrait: short side first). */
  bufferSize: BufferSize;
  hasPermission: boolean;
  requestPermission: () => Promise<boolean>;
  /** Feed the preview's measured size in so the crop rect can be computed. */
  onCameraLayout: (width: number, height: number) => void;
  /** Pass to `<Camera onStarted>`. */
  onCameraStarted: () => void;
  /** Pass to `<Camera onError>`. */
  onCameraError: (error: Error) => void;
  /** Effective preview fit mode — pass to `<Camera resizeMode>`. */
  resizeMode: 'cover' | 'contain';
}

export function useImeiSerialReader(opts: UseImeiSerialReaderOptions): UseImeiSerialReaderReturn {
  const cameraRef = useRef<CameraRef | null>(null);
  const [isActive, setIsActive] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [bufferSize, setBufferSize] = useState<BufferSize>(DEFAULT_BUFFER);
  const { hasPermission, requestPermission } = useCameraPermission();
  const device = useCameraDevice('back');

  const onDoneRef = useRef(opts.onDone);
  onDoneRef.current = opts.onDone;
  const onErrorRef = useRef(opts.onError);
  onErrorRef.current = opts.onError;
  const captureFrame = !!opts.captureFrame;

  // Set once a parser has matched; cleared on reload / re-activation.
  const matchedRef = useRef(false);
  const graceUntilRef = useRef(0);

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
  const parserRef = useRef(parser);
  parserRef.current = parser;

  useEffect(() => {
    setError(parserResult.error);
    if (parserResult.error != null) {
      onErrorRef.current?.(parserResult.error);
    }
  }, [parserResult]);

  const reportError = useCallback((e: Error) => {
    setError(e);
    onErrorRef.current?.(e);
  }, []);

  const resolvedRegion = useMemo(() => resolveScanRegion(opts.scanRegion), [opts.scanRegion]);
  const hasScanRegion = resolvedRegion.enabled;
  // 'cover' hides ~18% of the buffer behind a centre-crop, which would have to
  // be corrected for in the view->buffer transform. Defaulting a scan region to
  // 'contain' makes that correction the identity.
  const resizeMode: 'cover' | 'contain' = opts.resizeMode ?? (hasScanRegion ? 'contain' : 'cover');

  // A scan region crops to ~25% of the frame, so 1280x720 leaves too little
  // text height for MLKit (~16px needed). Request 1920x1080 when cropping.
  const highResolution = hasScanRegion;

  // Native OCR output. Callbacks are routed through refs so the native object
  // is only rebuilt when the stream configuration changes.
  const handleFrameRef = useRef<(frame: OcrFrame) => void>(() => {});
  const recognizer = useMemo(
    () =>
      createOcrRecognizer({
        targetFps: TARGET_FPS,
        highResolution,
        captureJpeg: captureFrame,
        jpegQuality: JPEG_QUALITY,
        onTextRecognized: (frame) => handleFrameRef.current(frame),
        onError: (e) => reportError(e),
      }),
    [highResolution, captureFrame, reportError],
  );
  useEffect(() => () => recognizer.dispose(), [recognizer]);
  const outputs = useMemo(() => [recognizer.output], [recognizer]);

  handleFrameRef.current = (frame: OcrFrame) => {
    try {
      const currentParser = parserRef.current;
      if (currentParser == null) return;
      if (matchedRef.current) return;
      if (Date.now() < graceUntilRef.current) return;

      const result = currentParser(toRecognizedText(frame));
      // Gate on `result.values`, never on `result.length`: a ParserResult is
      // an object, so a `.length > 0` check would read `undefined > 0`.
      if (result == null || result.values.length === 0) return;

      matchedRef.current = true;
      recognizer.setPaused(true);
      const frameForConsumer: Frame | undefined =
        captureFrame && frame.jpegPath != null
          ? {
              uri: `file://${frame.jpegPath}`,
              width: frame.width,
              height: frame.height,
              orientation: frame.orientation,
            }
          : undefined;
      onDoneRef.current(result.values, frameForConsumer, result.fields);
    } catch (e) {
      reportError(e as Error);
    }
  };

  /**
   * Clears the match and resumes analysis. Only the `isActive` effect and
   * `reload()` may call this — see `onCameraStarted`.
   */
  const rearm = useCallback(() => {
    matchedRef.current = false;
    graceUntilRef.current = Date.now() + GRACE_MS;
    recognizer.setPaused(false);
  }, [recognizer]);

  useEffect(() => {
    if (isActive) rearm();
  }, [isActive, rearm]);

  // Last measured preview size, re-applied when the buffer size changes.
  const lastLayoutRef = useRef<{ width: number; height: number } | null>(null);

  const applyCrop = useCallback(
    (viewWidth: number, viewHeight: number, buffer: BufferSize) => {
      if (!hasScanRegion) {
        recognizer.setCropRect(undefined);
        return;
      }
      const rect = computeCropRect({
        region: resolvedRegion,
        viewWidth,
        viewHeight,
        bufferWidth: buffer.width,
        bufferHeight: buffer.height,
        resizeMode,
        // Rotation is handled natively: Android maps the upright rect into the
        // raw buffer using its rotationDegrees, iOS crops after orienting.
        rotationDegrees: 0,
      });
      recognizer.setCropRect(rect == null ? undefined : rect);
    },
    [hasScanRegion, resolvedRegion, resizeMode, recognizer],
  );

  const onCameraLayout = useCallback(
    (viewWidth: number, viewHeight: number) => {
      lastLayoutRef.current = { width: viewWidth, height: viewHeight };
      applyCrop(viewWidth, viewHeight, bufferSize);
    },
    [applyCrop, bufferSize],
  );

  useEffect(() => {
    const layout = lastLayoutRef.current;
    if (layout != null) applyCrop(layout.width, layout.height, bufferSize);
  }, [applyCrop, bufferSize]);

  const onCameraStarted = useCallback(() => {
    // `currentResolution` is sensor-native (landscape); the overlay wants the
    // size as displayed in portrait, so short side first.
    const res = recognizer.output.currentResolution;
    if (res != null && res.width > 0 && res.height > 0) {
      const next = { width: Math.min(res.width, res.height), height: Math.max(res.width, res.height) };
      setBufferSize((prev) => (prev.width === next.width && prev.height === next.height ? prev : next));
    }
    // Deliberately NOT `rearm()`. VC5 fires `onStarted` on EVERY session start,
    // including the restart that follows a match (app foregrounded, device
    // reconfigured, …); re-arming here would clear `matchedRef` and let the
    // same label fire a second `onDone`. Only refresh the grace window so a
    // stale scene from before the restart cannot match — arming belongs to the
    // `isActive` effect and `reload()`.
    graceUntilRef.current = Date.now() + GRACE_MS;
  }, [recognizer]);

  const onCameraError = useCallback((e: Error) => reportError(e), [reportError]);

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
    outputs,
    bufferSize,
    hasPermission,
    requestPermission,
    onCameraLayout,
    onCameraStarted,
    onCameraError,
    resizeMode,
  };
}
