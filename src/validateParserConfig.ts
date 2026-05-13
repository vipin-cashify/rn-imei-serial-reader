import { ReaderType, type ParserConfig } from './types';

export function validateParserConfig(config: ParserConfig): void {
  if (config.customRegex != null && config.readerType !== ReaderType.FlexibleBarcode) {
    throw new Error('ParserConfig ---- customRegex can only be provided for flexibleBarcodeReader');
  }

  if (config.customRegex != null && config.customRegex.length > 0) {
    try {
      new RegExp(config.customRegex);
    } catch (e) {
      throw new Error(`ParserConfig ---- customRegex must be a valid regex pattern: ${(e as Error).message}`);
    }
  }

  if (config.targetBarcode != null && config.readerType !== ReaderType.ExactMatch) {
    throw new Error('ParserConfig ---- targetBarcode can only be provided for exactMatchReader');
  }

  if (config.readerType === ReaderType.ExactMatch) {
    if (config.targetBarcode == null || config.targetBarcode.length === 0) {
      throw new Error('ParserConfig ---- targetBarcode must be provided for exactMatchReader');
    }
  }

  if (config.readerType === ReaderType.FlexibleBarcode) {
    const { minLength, maxLength } = config;
    if (minLength != null && maxLength != null) {
      if (minLength < 1 || maxLength < minLength) {
        throw new Error('ParserConfig ---- minLength must be >= 1 and maxLength must be >= minLength');
      }
    }
    if ((minLength != null && maxLength == null) || (minLength == null && maxLength != null)) {
      throw new Error('ParserConfig ---- both minLength and maxLength must be provided together, or both must be null');
    }
  }
}
