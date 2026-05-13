export const ReaderType = {
  Imei: 'imei_reader',
  SerialNumber: 'sn_reader',
  FlexibleBarcode: 'flexible_barcode_reader',
  ExactMatch: 'exact_match_reader',
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
}

export type FrameOrientation =
  | 'portrait'
  | 'portrait-upside-down'
  | 'landscape-left'
  | 'landscape-right';

export interface Frame {
  uri: string;
  width: number;
  height: number;
  orientation: FrameOrientation;
}
