import type { HybridObject } from 'react-native-nitro-modules';
import type { OcrFrame, OcrRecognizer } from './OcrRecognizer.nitro';

export interface OcrRecognizerConfig {
  /** Upper bound on analysed frames per second (frames arriving faster are dropped). */
  targetFps: number;
  /** Request a 1920x1080 analysis stream instead of 1280x720 (used when a scan region crops the frame). */
  highResolution: boolean;
  /** Write every analysed frame to a JPEG so the matching frame can be handed to the consumer. */
  captureJpeg: boolean;
  /** JPEG quality 1..100 (only used when `captureJpeg` is true). */
  jpegQuality: number;
  onTextRecognized: (frame: OcrFrame) => void;
  onError: (error: Error) => void;
}

export interface OcrRecognizerFactory extends HybridObject<{ ios: 'swift'; android: 'kotlin' }> {
  createOcrRecognizer(config: OcrRecognizerConfig): OcrRecognizer;
}
