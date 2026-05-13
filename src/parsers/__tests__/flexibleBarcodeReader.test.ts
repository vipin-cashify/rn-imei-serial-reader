import { makeFlexible } from '../flexibleBarcodeReader';

const block = (text: string) => ({ blocks: [{ text }] });

describe('makeFlexible default validation', () => {
  const parser = makeFlexible({});

  it('extracts alphanumeric tokens with both letters and digits', () => {
    expect(parser(block('ABC123'))).toEqual(['ABC123']);
  });

  it('rejects all-letters', () => {
    expect(parser(block('ABCDEF'))).toBeNull();
  });

  it('rejects all-digits', () => {
    expect(parser(block('123456'))).toBeNull();
  });

  it('uppercases output', () => {
    expect(parser(block('abc123'))).toEqual(['ABC123']);
  });

  it('strips intra-block whitespace before matching (matches Flutter behavior)', () => {
    const result = parser(block('FOO1 BAR2 FOO1'));
    expect(result).toEqual(['FOO1BAR2FOO1']);
  });

  it('extracts and dedups across blocks', () => {
    const rt = { blocks: [{ text: 'FOO1' }, { text: 'BAR2' }, { text: 'FOO1' }] };
    expect(parser(rt)).toEqual(['FOO1', 'BAR2']);
  });
});

describe('makeFlexible with length bounds', () => {
  const parser = makeFlexible({ minLength: 5, maxLength: 8 });

  it('accepts in-range', () => {
    expect(parser(block('ABC12'))).toEqual(['ABC12']);
    expect(parser(block('ABCDE123'))).toEqual(['ABCDE123']);
  });

  it('rejects too-short', () => {
    expect(parser(block('AB12'))).toBeNull();
  });

  it('rejects too-long', () => {
    expect(parser(block('ABCDEFGH123'))).toBeNull();
  });
});

describe('makeFlexible with custom regex', () => {
  const parser = makeFlexible({ customRegexSource: '[A-Z]{3}[0-9]{4}' });

  it('matches the custom pattern', () => {
    expect(parser(block('ABC1234'))).toEqual(['ABC1234']);
  });

  it('rejects non-matching tokens', () => {
    expect(parser(block('AB1234'))).toBeNull();
  });
});
