import { ReaderType, type ParserConfig } from '../types';
import { validateParserConfig } from '../validateParserConfig';
import { processImei } from './imeiReader';
import { processSerial } from './serialNoReader';
import { makeFlexible } from './flexibleBarcodeReader';
import { makeExact } from './exactMatchBarcodeReader';
import { makePanCard } from './panCardReader';
import type { ParserFn } from './types';

export function createParser(config: ParserConfig): ParserFn {
  validateParserConfig(config);
  switch (config.readerType) {
    case ReaderType.Imei:
      return processImei;
    case ReaderType.SerialNumber:
      return processSerial;
    case ReaderType.FlexibleBarcode:
      return makeFlexible({
        minLength: config.minLength,
        maxLength: config.maxLength,
        customRegexSource: config.customRegex,
      });
    case ReaderType.ExactMatch:
      return makeExact(config.targetBarcode as string);
    case ReaderType.PanCard:
      return makePanCard({ requireAllFields: config.requireAllFields });
    default: {
      const _exhaustive: never = config.readerType;
      throw new Error(`Unknown readerType: ${_exhaustive as string}`);
    }
  }
}

export type {
  BoundingBox,
  DocumentFields,
  ParserFn,
  ParserResult,
  RecognizedText,
  TextBlock,
  TextElement,
  TextLine,
} from './types';
