import type { RecognizedText } from './types';

// String sources captured into the worklet are safe. RegExp objects are
// constructed inside the worklet body so their prototype methods (.test/.exec)
// are available in the worklet runtime.
const SERIAL_RE_SRC = '(?:serialnumber[:|?]*)([A-Za-z0-9]{6,})';
const LETTER_AND_NUMBER_RE_SRC = '^(?=.*[A-Za-z])(?=.*\\d)[A-Za-z0-9]+$';
const SPACE_SRC = ' ';
const NEWLINE_SRC = '\\n';

export function processSerial(rt: RecognizedText): string[] | null {
  'worklet';
  const reSerial = new RegExp(SERIAL_RE_SRC);
  const reLetterAndNumber = new RegExp(LETTER_AND_NUMBER_RE_SRC);
  const reSpace = new RegExp(SPACE_SRC, 'g');
  const reNewline = new RegExp(NEWLINE_SRC, 'g');

  for (let bi = 0; bi < rt.blocks.length; bi++) {
    const block = rt.blocks[bi];
    if (block == null) continue;
    let s = block.text.trim().replace(reSpace, '').toLowerCase();
    if (s.indexOf('\n') !== -1) s = s.replace(reNewline, '|');
    const m = reSerial.exec(s);
    if (m != null) {
      const serial = m[1];
      if (serial != null && reLetterAndNumber.test(serial)) {
        return [serial.toUpperCase()];
      }
    }
  }
  return null;
}
