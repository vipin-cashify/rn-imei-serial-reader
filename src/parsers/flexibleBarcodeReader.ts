import type { ParserFn, RecognizedText } from './types';

// String sources captured into the worklet are safe. RegExp objects are
// constructed inside the worklet body so their prototype methods are
// available in the worklet runtime.
const ALPHANUMERIC_DEFAULT_SRC = '[A-Za-z0-9]+';
const ALPHANUMERIC_VALID_SRC = '^[A-Za-z0-9]+$';
const HAS_LETTER_SRC = '[A-Za-z]';
const HAS_DIGIT_SRC = '[0-9]';
const NON_ALPHANUMERIC_SRC = '[^A-Za-z0-9]';
const SPACE_SRC = ' ';
const NEWLINE_SRC = '\\n';

export interface FlexibleOptions {
  minLength?: number;
  maxLength?: number;
  customRegexSource?: string;
}

export function makeFlexible(opts: FlexibleOptions): ParserFn {
  const minLength = opts.minLength;
  const maxLength = opts.maxLength;
  const customRegexSource = opts.customRegexSource;
  const hasCustom = typeof customRegexSource === 'string' && customRegexSource.length > 0;
  const safeCustomSrc = hasCustom ? (customRegexSource as string) : '';

  return function processFlexible(rt: RecognizedText): string[] | null {
    'worklet';
    const reSpace = new RegExp(SPACE_SRC, 'g');
    const reNewline = new RegExp(NEWLINE_SRC, 'g');
    const reAlnumValid = new RegExp(ALPHANUMERIC_VALID_SRC);
    const reHasLetter = new RegExp(HAS_LETTER_SRC);
    const reHasDigit = new RegExp(HAS_DIGIT_SRC);
    const reNonAlnum = new RegExp(NON_ALPHANUMERIC_SRC, 'g');
    const reAlnumDefaultGlobal = new RegExp(ALPHANUMERIC_DEFAULT_SRC, 'g');
    const customGlobal = hasCustom ? new RegExp(safeCustomSrc, 'g') : null;
    const customSingle = hasCustom ? new RegExp(safeCustomSrc) : null;

    const found: string[] = [];
    for (let bi = 0; bi < rt.blocks.length; bi++) {
      const block = rt.blocks[bi];
      if (block == null) continue;
      const s = block.text.trim().replace(reSpace, '').replace(reNewline, '');

      const regex = customGlobal != null ? customGlobal : reAlnumDefaultGlobal;
      const matches = s.matchAll(regex);
      for (const m of matches) {
        const candidate = m[0];
        if (candidate == null) continue;

        // inline validity check (file-local helpers don't carry into worklet scope)
        if (candidate.length === 0) continue;
        if (minLength != null && candidate.length < minLength) continue;
        if (maxLength != null && candidate.length > maxLength) continue;

        let valid: boolean;
        if (customSingle != null) {
          valid = customSingle.test(candidate);
        } else {
          if (!reAlnumValid.test(candidate)) {
            valid = false;
          } else if (candidate.length !== candidate.replace(reNonAlnum, '').length) {
            valid = false;
          } else if (!reHasLetter.test(candidate)) {
            valid = false;
          } else if (!reHasDigit.test(candidate)) {
            valid = false;
          } else {
            valid = true;
          }
        }
        if (!valid) continue;

        const up = candidate.toUpperCase();
        if (found.indexOf(up) === -1) found.push(up);
      }
    }

    return found.length > 0 ? found : null;
  };
}
