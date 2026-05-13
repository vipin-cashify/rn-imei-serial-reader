import type { ParserFn, RecognizedText } from './types';

const NON_WORD_SRC = '[^\\w]';
const WHITESPACE_SRC = '\\s+';
const SPACE_SRC = ' ';
const NEWLINE_SRC = '\\n';

export function makeExact(target: string): ParserFn {
  // Target normalization runs on the JS thread (this code is outside the
  // worklet directive), so module-level RegExps from the JS runtime are fine.
  const normalizedTarget = target.trim().toUpperCase().replace(/\s+/g, '');

  return function processExact(rt: RecognizedText): string[] | null {
    'worklet';
    const reSpace = new RegExp(SPACE_SRC, 'g');
    const reNewline = new RegExp(NEWLINE_SRC, 'g');
    const reNonWord = new RegExp(NON_WORD_SRC);
    // unused inside worklet but constructed for parity / future use
    void WHITESPACE_SRC;

    for (let bi = 0; bi < rt.blocks.length; bi++) {
      const block = rt.blocks[bi];
      if (block == null) continue;
      const s = block.text.trim().replace(reSpace, '').replace(reNewline, '');
      const normalizedScanned = s.toUpperCase();

      if (normalizedScanned === normalizedTarget) {
        return [normalizedTarget];
      }
      if (normalizedScanned.indexOf(normalizedTarget) !== -1) {
        return [normalizedTarget];
      }

      const words = s.split(reNonWord);
      for (let wi = 0; wi < words.length; wi++) {
        const word = words[wi];
        if (word != null && word.length > 0 && word.toUpperCase() === normalizedTarget) {
          return [normalizedTarget];
        }
      }
    }
    return null;
  };
}
