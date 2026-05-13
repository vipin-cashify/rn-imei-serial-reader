import { processImei } from '../imeiReader';

const block = (text: string) => ({ blocks: [{ text }] });

describe('processImei', () => {
  it('returns a valid Luhn IMEI', () => {
    expect(processImei(block('490154203237518'))).toEqual(['490154203237518']);
  });

  it('extracts an IMEI surrounded by non-digit noise', () => {
    expect(processImei(block('IMEI: 490154203237518 device'))).toEqual(['490154203237518']);
  });

  it('rejects a 14-digit number', () => {
    expect(processImei(block('49015420323751'))).toBeNull();
  });

  it('rejects a 16-digit number (Luhn check requires exactly 15)', () => {
    expect(processImei(block('4901542032375180'))).toBeNull();
  });

  it('rejects a 15-digit number that fails Luhn', () => {
    expect(processImei(block('490154203237519'))).toBeNull();
  });

  it('does not false-positive on non-digit garbage', () => {
    expect(processImei(block('aaaaaaaaaaaaaaaa'))).toBeNull();
  });

  it('handles multi-block input', () => {
    const rt = { blocks: [{ text: 'noise' }, { text: '490154203237518' }] };
    expect(processImei(rt)).toEqual(['490154203237518']);
  });

  it('returns deduped results', () => {
    const rt = {
      blocks: [{ text: '490154203237518' }, { text: '490154203237518' }],
    };
    expect(processImei(rt)).toEqual(['490154203237518']);
  });

  it('strips spaces before matching', () => {
    expect(processImei(block('4901 5420 3237 518'))).toEqual(['490154203237518']);
  });

  it('returns null for empty input', () => {
    expect(processImei({ blocks: [] })).toBeNull();
  });
});
