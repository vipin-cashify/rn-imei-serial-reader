import { makeExact } from '../exactMatchBarcodeReader';

const block = (text: string) => ({ blocks: [{ text }] });

describe('makeExact', () => {
  const parser = makeExact('ABC123');

  it('exact match', () => {
    expect(parser(block('ABC123'))).toEqual(['ABC123']);
  });

  it('case-insensitive', () => {
    expect(parser(block('abc123'))).toEqual(['ABC123']);
  });

  it('substring match', () => {
    expect(parser(block('prefixABC123suffix'))).toEqual(['ABC123']);
  });

  it('word-split match', () => {
    expect(parser(block('foo,ABC123;bar'))).toEqual(['ABC123']);
  });

  it('no match', () => {
    expect(parser(block('XYZ999'))).toBeNull();
  });

  it('normalizes target (trim + whitespace strip + uppercase)', () => {
    const p = makeExact(' a b c 1 2 3 ');
    expect(p(block('ABC123'))).toEqual(['ABC123']);
  });
});
