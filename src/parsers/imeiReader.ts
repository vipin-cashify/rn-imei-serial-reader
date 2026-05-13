import type { RecognizedText } from './types';

// String sources captured into the worklet are safe. The RegExp objects
// themselves are constructed inside the worklet body so their prototype
// methods (.test/.matchAll) are available in the worklet runtime.
const IMEI_RE_SRC = '(.)*([0-9]{15,16})(.)*';
const ALL_DIGITS_SRC = '^\\d+$';
const SPACE_SRC = ' ';

export function processImei(rt: RecognizedText): string[] | null {
  'worklet';
  const reTest = new RegExp(IMEI_RE_SRC);
  const reGlobal = new RegExp(IMEI_RE_SRC, 'g');
  const reAllDigits = new RegExp(ALL_DIGITS_SRC);
  const reSpace = new RegExp(SPACE_SRC, 'g');

  const blockTextList: string[] = [];
  for (let bi = 0; bi < rt.blocks.length; bi++) {
    const block = rt.blocks[bi];
    if (block == null) continue;
    const s = block.text.trim().replace(reSpace, '');
    if (reTest.test(s) && blockTextList.indexOf(s) === -1) {
      blockTextList.push(s);
    }
  }
  if (blockTextList.length === 0) return null;

  const combined = blockTextList.join('\n');
  const found: string[] = [];
  const matches = combined.matchAll(reGlobal);
  for (const m of matches) {
    for (let i = 0; i < 3; i++) {
      const candidate = m[i];
      if (candidate == null) continue;

      // inline isValidImei (file-local helpers don't carry reliably into worklet scope)
      if (!reAllDigits.test(candidate)) continue;
      if (candidate.length !== 15) continue;
      let sum = 0;
      for (let k = candidate.length; k >= 1; k--) {
        let d = candidate.charCodeAt(candidate.length - k) - 48;
        if (k % 2 === 0) d = 2 * d;
        sum += d >= 10 ? Math.floor(d / 10) + (d % 10) : d;
      }
      if (sum % 10 !== 0) continue;

      const trimmed = candidate.trim();
      if (found.indexOf(trimmed) === -1) found.push(trimmed);
    }
  }
  return found.length > 0 ? found : null;
}
