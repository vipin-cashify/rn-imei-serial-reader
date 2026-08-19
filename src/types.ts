export const ReaderType = {
  Imei: 'imei_reader',
  SerialNumber: 'sn_reader',
  FlexibleBarcode: 'flexible_barcode_reader',
  ExactMatch: 'exact_match_reader',
  PanCard: 'pan_card_reader',
} as const;

export type ReaderType = (typeof ReaderType)[keyof typeof ReaderType];

export interface ParserConfig {
  readerType: ReaderType;
  /** Required for ExactMatch; rejected for any other reader type. */
  targetBarcode?: string;
  /** Allowed only with FlexibleBarcode. */
  customRegex?: string;
  /** Both-or-neither with maxLength. FlexibleBarcode only. */
  minLength?: number;
  maxLength?: number;
  /**
   * PanCard only. When true (default) the parser reports a match only once
   * every field resolves — PAN, name, date of birth, and (for individual
   * cards) father's name. Set false to accept a valid PAN alone and take the
   * other fields best-effort.
   */
  requireAllFields?: boolean;
}

export type FrameOrientation =
  | 'portrait'
  | 'portrait-upside-down'
  | 'landscape-left'
  | 'landscape-right';

/**
 * Orientation strings accepted by `PhotoRecognizer` from
 * `react-native-vision-camera-text-recognition` (`PhotoOptions.orientation`).
 *
 * The plugin uses camelCase while our public `FrameOrientation` is kebab-case.
 * Passing our value through directly means only `'portrait'` ever matches and
 * every other orientation is silently ignored by the plugin — see
 * `toPhotoRecognizerOrientation`.
 */
export type PhotoRecognizerOrientation =
  | 'portrait'
  | 'portraitUpsideDown'
  | 'landscapeLeft'
  | 'landscapeRight';

const PHOTO_RECOGNIZER_ORIENTATION: Record<FrameOrientation, PhotoRecognizerOrientation> = {
  portrait: 'portrait',
  'portrait-upside-down': 'portraitUpsideDown',
  'landscape-left': 'landscapeLeft',
  'landscape-right': 'landscapeRight',
};

/** Maps our kebab-case `FrameOrientation` to the plugin's camelCase form. */
export function toPhotoRecognizerOrientation(
  orientation: FrameOrientation,
): PhotoRecognizerOrientation {
  return PHOTO_RECOGNIZER_ORIENTATION[orientation] ?? 'portrait';
}

export interface Frame {
  uri: string;
  width: number;
  height: number;
  orientation: FrameOrientation;
}
