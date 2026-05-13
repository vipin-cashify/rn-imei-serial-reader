import { ReaderType } from '../../types';
import { validateParserConfig } from '../../validateParserConfig';

describe('validateParserConfig', () => {
  it('accepts a minimal IMEI config', () => {
    expect(() => validateParserConfig({ readerType: ReaderType.Imei })).not.toThrow();
  });

  it('rejects customRegex with non-flexible reader', () => {
    expect(() =>
      validateParserConfig({ readerType: ReaderType.Imei, customRegex: '[A-Z]+' }),
    ).toThrow(/customRegex can only be provided for flexibleBarcodeReader/);
  });

  it('rejects invalid customRegex syntax', () => {
    expect(() =>
      validateParserConfig({
        readerType: ReaderType.FlexibleBarcode,
        customRegex: '[unclosed',
      }),
    ).toThrow(/customRegex must be a valid regex pattern/);
  });

  it('rejects targetBarcode with non-exact reader', () => {
    expect(() =>
      validateParserConfig({ readerType: ReaderType.Imei, targetBarcode: 'X' }),
    ).toThrow(/targetBarcode can only be provided for exactMatchReader/);
  });

  it('requires targetBarcode for exact-match reader', () => {
    expect(() => validateParserConfig({ readerType: ReaderType.ExactMatch })).toThrow(
      /targetBarcode must be provided for exactMatchReader/,
    );
    expect(() =>
      validateParserConfig({ readerType: ReaderType.ExactMatch, targetBarcode: '' }),
    ).toThrow(/targetBarcode must be provided for exactMatchReader/);
  });

  it('requires both length bounds together', () => {
    expect(() =>
      validateParserConfig({ readerType: ReaderType.FlexibleBarcode, minLength: 5 }),
    ).toThrow(/both minLength and maxLength must be provided together/);
    expect(() =>
      validateParserConfig({ readerType: ReaderType.FlexibleBarcode, maxLength: 8 }),
    ).toThrow(/both minLength and maxLength must be provided together/);
  });

  it('rejects min < 1 or max < min', () => {
    expect(() =>
      validateParserConfig({
        readerType: ReaderType.FlexibleBarcode,
        minLength: 0,
        maxLength: 5,
      }),
    ).toThrow(/minLength must be >= 1 and maxLength must be >= minLength/);
    expect(() =>
      validateParserConfig({
        readerType: ReaderType.FlexibleBarcode,
        minLength: 8,
        maxLength: 5,
      }),
    ).toThrow(/minLength must be >= 1 and maxLength must be >= minLength/);
  });
});
