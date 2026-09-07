import type { HybridObject } from 'react-native-nitro-modules';
import type { CameraOutput } from 'react-native-vision-camera';

/** Normalised rect (0..1), top-left origin, expressed against the UPRIGHT image. */
export interface NormalizedRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Axis-aligned box in analysed-image pixels (top-left origin). All zeros when MLKit gave none. */
export interface OcrBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface OcrElement {
  text: string;
  box: OcrBox;
}

export interface OcrLine {
  text: string;
  box: OcrBox;
  elements: OcrElement[];
}

export interface OcrBlock {
  text: string;
  box: OcrBox;
  lines: OcrLine[];
}

export type OcrFrameOrientation =
  | 'portrait'
  | 'portrait-upside-down'
  | 'landscape-left'
  | 'landscape-right';

/** One analysed frame. `width`/`height` describe the upright, cropped image the boxes refer to. */
export interface OcrFrame {
  blocks: OcrBlock[];
  width: number;
  height: number;
  orientation: OcrFrameOrientation;
  /** Absolute filesystem path (no `file://`) of the JPEG of this frame when `captureJpeg` was requested. */
  jpegPath?: string;
}

/**
 * Wraps a native MLKit OCR camera output.
 * Attach `output` to `<Camera outputs={[...]}>`.
 */
export interface OcrRecognizer extends HybridObject<{ ios: 'swift'; android: 'kotlin' }> {
  readonly output: CameraOutput;
  /** Restrict OCR to this upright-normalised rect; `undefined` scans the full frame. */
  setCropRect(rect?: NormalizedRect): void;
  /** While paused no frames are analysed (used after a match until the consumer re-arms). */
  setPaused(paused: boolean): void;
}
