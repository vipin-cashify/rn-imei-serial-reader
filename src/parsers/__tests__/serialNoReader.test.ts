import { processSerial } from '../serialNoReader';

const block = (text: string) => ({ blocks: [{ text }] });

describe('processSerial', () => {
  it('extracts a serial after "Serial Number:" prefix', () => {
    expect(processSerial(block('Serial Number: ABC123XYZ'))).toEqual(['ABC123XYZ']);
  });

  it('uppercases the result', () => {
    expect(processSerial(block('serialnumber:abc123'))).toEqual(['ABC123']);
  });

  it('requires both letters and digits', () => {
    expect(processSerial(block('Serial Number: ABCDEF'))).toBeNull();
    expect(processSerial(block('Serial Number: 123456'))).toBeNull();
  });

  it('rejects serials shorter than 6 chars', () => {
    expect(processSerial(block('Serial Number: AB12'))).toBeNull();
  });

  it('handles newline replacement', () => {
    expect(processSerial(block('Serial Number\nABC123XYZ'))).toEqual(['ABC123XYZ']);
  });

  it('returns null for empty input', () => {
    expect(processSerial({ blocks: [] })).toBeNull();
  });

  it('returns null when no serial number marker present', () => {
    expect(processSerial(block('random text ABC123'))).toBeNull();
  });
});
