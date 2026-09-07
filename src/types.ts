export const ReaderType = {
  Imei: 'imei_reader',
  SerialNumber: 'sn_reader',
  FlexibleBarcode: 'flexible_barcode_reader',
  ExactMatch: 'exact_match_reader',
  PanCard: 'pan_card_reader',
  AadhaarCard: 'aadhaar_card_reader',
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
   * PanCard / AadhaarCard only. When true (default) the parser reports a match
   * only once every field resolves — for PAN that is the number, name, date of
   * birth and (for individual cards) father's name; for Aadhaar the number,
   * name and a date of birth. Set false to accept a valid document number
   * alone and take the other fields best-effort.
   */
  requireAllFields?: boolean;
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
