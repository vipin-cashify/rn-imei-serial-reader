import {
  __tables,
  isValidAadhaarNumber,
  isValidVerhoeff,
  verhoeffCheckDigit,
} from '../verhoeff';

/**
 * The D/P/INV tables in verhoeff.ts are 200-odd hand-transcribed numbers, and a
 * single wrong cell would produce an algorithm that still *looks* like it works
 * — it would accept and reject numbers, just not the right ones. So rather than
 * spot-checking a few known values, these tests:
 *
 *   1. assert the tables' structural properties (D5 group axioms, permutation
 *      order 8, inverse correctness), which pins every cell, and
 *   2. generate valid numbers with verhoeffCheckDigit and verify the round trip.
 *
 * All numbers here are synthetic. No real Aadhaar numbers appear in this file.
 */

/** Builds a valid 12-digit Aadhaar-shaped number from an 11-digit payload. */
const withCheckDigit = (payload11: string): string => payload11 + String(verhoeffCheckDigit(payload11));

describe('verhoeffCheckDigit / isValidVerhoeff round trip', () => {
  const payloads = [
    '23456789012',
    '98765432109',
    '20000000000',
    '99999999999',
    '24681357902',
    '31415926535',
    '27182818284',
    '86420864208',
  ];

  it('produces a check digit that validates', () => {
    for (const p of payloads) {
      const full = withCheckDigit(p);
      expect(full.length).toBe(12);
      expect(isValidVerhoeff(full)).toBe(true);
    }
  });

  it('rejects every single-digit corruption', () => {
    // Verhoeff's defining property: ALL single-digit errors are detected.
    for (const p of payloads) {
      const full = withCheckDigit(p);
      for (let i = 0; i < full.length; i++) {
        for (let d = 0; d <= 9; d++) {
          const ch = String(d);
          if (full[i] === ch) continue;
          const corrupted = full.slice(0, i) + ch + full.slice(i + 1);
          expect(isValidVerhoeff(corrupted)).toBe(false);
        }
      }
    }
  });

  it('rejects every transposition of adjacent digits', () => {
    // The other defining property: all adjacent transpositions are detected.
    for (const p of payloads) {
      const full = withCheckDigit(p);
      for (let i = 0; i < full.length - 1; i++) {
        const a = full[i]!;
        const b = full[i + 1]!;
        if (a === b) continue; // swapping equal digits is a no-op
        const swapped = full.slice(0, i) + b + a + full.slice(i + 2);
        expect(isValidVerhoeff(swapped)).toBe(false);
      }
    }
  });

  it('returns -1 for non-digit payloads', () => {
    expect(verhoeffCheckDigit('1234X6789')).toBe(-1);
    expect(verhoeffCheckDigit('abc')).toBe(-1);
  });
});

describe('isValidVerhoeff input handling', () => {
  it('rejects empty input', () => {
    expect(isValidVerhoeff('')).toBe(false);
  });

  it('rejects non-digit characters', () => {
    expect(isValidVerhoeff('23456789012X')).toBe(false);
    expect(isValidVerhoeff('2345 6789 0123')).toBe(false); // caller must strip spaces
    expect(isValidVerhoeff('abcdefghijkl')).toBe(false);
  });

  it('validates the single digit 0', () => {
    // Degenerate but well-defined: 0 is its own valid check digit.
    expect(isValidVerhoeff('0')).toBe(true);
  });
});

describe('table integrity (pins every cell)', () => {
  const { D, P, INV } = __tables;
  const IDENTITY = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];

  it('D is a 10x10 Latin square (necessary for a group Cayley table)', () => {
    expect(D.length).toBe(10);
    for (const row of D) {
      expect(row.length).toBe(10);
      expect(new Set(row).size).toBe(10); // every row is a permutation
    }
    for (let col = 0; col < 10; col++) {
      const column = D.map((row) => row[col]!);
      expect(new Set(column).size).toBe(10); // every column too
    }
  });

  it('D has 0 as its identity element', () => {
    for (let j = 0; j <= 9; j++) {
      expect(D[0]![j]).toBe(j);
      expect(D[j]![0]).toBe(j);
    }
  });

  it('D is associative — the defining group axiom', () => {
    // 1000 triples. This is what actually proves the table is D5 and not a
    // near-miss with a transcription error.
    for (let a = 0; a <= 9; a++) {
      for (let b = 0; b <= 9; b++) {
        for (let c = 0; c <= 9; c++) {
          expect(D[D[a]![b]!]![c]).toBe(D[a]![D[b]![c]!]);
        }
      }
    }
  });

  it('INV is the true inverse under D', () => {
    expect(INV.length).toBe(10);
    for (let j = 0; j <= 9; j++) {
      expect(D[j]![INV[j]!]).toBe(0);
    }
  });

  it('P has 8 rows, each a permutation, with row 0 the identity', () => {
    expect(P.length).toBe(8);
    for (const row of P) {
      expect(row.length).toBe(10);
      expect(new Set(row).size).toBe(10);
    }
    expect([...P[0]!]).toEqual(IDENTITY);
  });

  it('each P row is the base permutation applied that many times', () => {
    // P[i] must equal P[1] composed i times — this pins all 80 cells against
    // the 10 in P[1].
    const p1 = P[1]!;
    let cur = [...IDENTITY];
    for (let i = 0; i < 8; i++) {
      expect([...P[i]!]).toEqual(cur);
      cur = cur.map((v) => p1[v]!);
    }
    // …and after 8 applications it returns to the identity: order 8.
    expect(cur).toEqual(IDENTITY);
  });
});

describe('isValidAadhaarNumber', () => {
  it('accepts a well-formed 12-digit number', () => {
    expect(isValidAadhaarNumber(withCheckDigit('23456789012'))).toBe(true);
  });

  it('rejects wrong lengths', () => {
    const valid = withCheckDigit('23456789012');
    expect(isValidAadhaarNumber(valid.slice(0, 11))).toBe(false);
    expect(isValidAadhaarNumber(valid + '5')).toBe(false);
    expect(isValidAadhaarNumber('')).toBe(false);
  });

  // UIDAI never issues a number starting with 0 or 1, so this is a real
  // structural check and not merely defensive.
  it('rejects a first digit of 0 or 1 even when the checksum passes', () => {
    for (const lead of ['0', '1']) {
      const full = withCheckDigit(lead + '2345678901');
      expect(isValidVerhoeff(full)).toBe(true); // checksum is fine…
      expect(isValidAadhaarNumber(full)).toBe(false); // …but the number is not
    }
  });

  it('accepts every valid leading digit 2-9', () => {
    for (let lead = 2; lead <= 9; lead++) {
      const full = withCheckDigit(String(lead) + '2345678901');
      expect(isValidAadhaarNumber(full)).toBe(true);
    }
  });

  it('rejects a number with grouping spaces (caller must strip)', () => {
    expect(isValidAadhaarNumber('2345 6789 0123')).toBe(false);
  });
});
