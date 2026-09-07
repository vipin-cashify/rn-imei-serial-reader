/**
 * Verhoeff check-digit validation — the algorithm UIDAI uses for the 12th
 * digit of every Aadhaar number.
 *
 * Why this matters here: PAN's check digit uses an algorithm the Income Tax
 * Department has never published, so a format-valid PAN cannot be proven
 * correct — the PAN parser has to lean on label context and position-aware
 * confusable repair instead. Aadhaar's checksum IS published, so a candidate
 * number can be mathematically verified. That rejects roughly 90% of random
 * 12-digit strings, catches every single-digit error, and catches all
 * transpositions of adjacent digits.
 *
 * Consequence for the parser: confusable repair can be applied aggressively
 * (O→0, I→1, S→5, B→8, …) because a wrong repair simply fails the checksum.
 * There is no equivalent safety net on the PAN side.
 *
 * The three tables below are the standard published constants from Verhoeff's
 * 1969 paper — the multiplication table of the dihedral group D5, a
 * permutation table, and the inverse table. They are not tunable: any edit
 * breaks the algorithm, and the tests in __tests__/verhoeff.test.ts assert
 * their structural properties (D5 group axioms) rather than just spot values,
 * so a typo in a single cell is caught.
 */

/** Multiplication table for the dihedral group D5. `D[j][k] = j * k`. */
const D: readonly (readonly number[])[] = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
  [1, 2, 3, 4, 0, 6, 7, 8, 9, 5],
  [2, 3, 4, 0, 1, 7, 8, 9, 5, 6],
  [3, 4, 0, 1, 2, 8, 9, 5, 6, 7],
  [4, 0, 1, 2, 3, 9, 5, 6, 7, 8],
  [5, 9, 8, 7, 6, 0, 4, 3, 2, 1],
  [6, 5, 9, 8, 7, 1, 0, 4, 3, 2],
  [7, 6, 5, 9, 8, 2, 1, 0, 4, 3],
  [8, 7, 6, 5, 9, 3, 2, 1, 0, 4],
  [9, 8, 7, 6, 5, 4, 3, 2, 1, 0],
];

/**
 * Permutation table. `P[pos % 8][digit]`.
 *
 * Row 0 is the identity and row 1 is the base permutation (1,5,7,6,2,8,3,0,9,4);
 * each subsequent row applies that permutation again, and it has order 8 —
 * which is why the caller indexes with `position % 8`.
 */
const P: readonly (readonly number[])[] = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
  [1, 5, 7, 6, 2, 8, 3, 0, 9, 4],
  [5, 8, 0, 3, 7, 9, 6, 1, 4, 2],
  [8, 9, 1, 6, 0, 4, 3, 5, 2, 7],
  [9, 4, 5, 3, 1, 2, 6, 8, 7, 0],
  [4, 2, 8, 6, 5, 7, 3, 9, 0, 1],
  [2, 7, 9, 3, 8, 0, 6, 4, 1, 5],
  [7, 0, 4, 6, 9, 1, 3, 2, 5, 8],
];

/** Inverse table: `INV[j]` is the value `k` where `D[j][k] === 0`. */
const INV: readonly number[] = [0, 4, 3, 2, 1, 5, 6, 7, 8, 9];

/**
 * The raw tables, exported for the test suite ONLY.
 *
 * These are 200-odd hand-transcribed numbers, and a single wrong cell yields an
 * algorithm that still accepts and rejects numbers — just not the right ones.
 * The tests assert the mathematical properties that pin every cell (D5 group
 * axioms, permutation order 8, inverse correctness), which is only possible
 * with direct access. Not part of the public API; do not re-export from
 * src/index.ts.
 */
export const __tables = { D, P, INV } as const;

/**
 * Validates a digit string that already includes its Verhoeff check digit as
 * the final character.
 *
 * Returns false for empty input or anything containing a non-digit — callers
 * should strip grouping spaces before calling.
 */
export function isValidVerhoeff(digits: string): boolean {
  if (digits.length === 0) return false;

  let c = 0;
  // Walk right-to-left: the check digit is at position 0 for the permutation
  // table, which is what makes it validate to 0 for a well-formed number.
  for (let i = 0; i < digits.length; i++) {
    const code = digits.charCodeAt(digits.length - 1 - i) - 48;
    if (code < 0 || code > 9) return false;
    const pRow = P[i % 8];
    if (pRow == null) return false;
    const permuted = pRow[code];
    if (permuted == null) return false;
    const dRow = D[c];
    if (dRow == null) return false;
    const next = dRow[permuted];
    if (next == null) return false;
    c = next;
  }
  return c === 0;
}

/**
 * Computes the Verhoeff check digit for a payload that does NOT yet include
 * one. Not needed to read a card, but it is what makes the tests meaningful:
 * it lets them generate valid numbers to verify against, instead of hardcoding
 * a handful of samples.
 *
 * Returns -1 on non-digit input.
 */
export function verhoeffCheckDigit(payload: string): number {
  let c = 0;
  for (let i = 0; i < payload.length; i++) {
    const code = payload.charCodeAt(payload.length - 1 - i) - 48;
    if (code < 0 || code > 9) return -1;
    // Offset by one position: the check digit will occupy position 0.
    const pRow = P[(i + 1) % 8];
    if (pRow == null) return -1;
    const permuted = pRow[code];
    if (permuted == null) return -1;
    const dRow = D[c];
    if (dRow == null) return -1;
    const next = dRow[permuted];
    if (next == null) return -1;
    c = next;
  }
  const inv = INV[c];
  return inv == null ? -1 : inv;
}

/**
 * Full Aadhaar number validation: exactly 12 digits, first digit 2-9 (UIDAI
 * never issues a number starting with 0 or 1), and a valid Verhoeff checksum.
 *
 * Input must already be stripped of grouping spaces.
 */
export function isValidAadhaarNumber(digits: string): boolean {
  if (digits.length !== 12) return false;
  const first = digits.charCodeAt(0) - 48;
  if (first < 2 || first > 9) return false;
  return isValidVerhoeff(digits);
}
