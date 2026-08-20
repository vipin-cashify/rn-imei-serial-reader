export { ImeiSerialReader } from './components/ImeiSerialReader';
export { ScanRegionOverlay } from './components/ScanRegionOverlay';
export {
  DEFAULT_ASPECT_RATIO,
  DEFAULT_SCAN_REGION,
  ID1_ASPECT_RATIO,
  computeCropRect,
  computePreviewBox,
  computeViewRect,
  resolveScanRegion,
} from './scanRegion';
export type {
  NormalizedRect,
  ResolvedScanRegion,
  ScanRegionOptions,
} from './scanRegion';
export { useImeiSerialReader } from './hooks/useImeiSerialReader';
export { createParser } from './parsers';
export { validateParserConfig } from './validateParserConfig';
export { ReaderType } from './types';
export type {
  ParserConfig,
  Frame,
  FrameOrientation,
} from './types';
export type { ImeiSerialReaderProps } from './components/ImeiSerialReader';
export type {
  UseImeiSerialReaderOptions,
  UseImeiSerialReaderReturn,
} from './hooks/useImeiSerialReader';
export type {
  BoundingBox,
  DocumentFields,
  ParserFn,
  ParserResult,
  RecognizedText,
  TextBlock,
  TextElement,
  TextLine,
} from './parsers/types';
