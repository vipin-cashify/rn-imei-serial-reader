import type { ParserResult, RecognizedText } from './types';

// String sources captured into the worklet are safe. RegExp objects are
// constructed inside the worklet body so their prototype methods (.test/.exec)
// are available in the worklet runtime.
const SERIAL_RE_SRC = '(?:serialnumber[:|?]*)([A-Za-z0-9]{6,})';
const LETTER_AND_NUMBER_RE_SRC = '^(?=.*[A-Za-z])(?=.*\\d)[A-Za-z0-9]+$';
const SPACE_SRC = ' ';
const NEWLINE_SRC = '\\n';

/**
 * Serial number reader.
 *
 * Two strategies, in order:
 *
 *   1. Same-block match — the original behaviour. Handles "Serial Number:
 *      ABC123" and the label-above-value form, where stripping spaces puts the
 *      label directly against the value.
 *
 *   2. Cross-line/column match. On a settings screen the label and value sit in
 *      SEPARATE columns ("Serial Number" left, "TN647Y07QV" right), so ML Kit
 *      emits them as different lines or blocks and strategy 1 can never see
 *      them together — it only ever matched within one block's text. This pass
 *      finds the label line, then takes the nearest candidate to its right (or
 *      on the following line) using the per-line geometry the adapter now
 *      provides.
 *
 * Worklet note: runs in a worklet runtime, so all logic is inlined here on
 * purpose — the babel plugin does not reliably carry file-local helpers into
 * worklet scope.
 */
export function processSerial(rt: RecognizedText): ParserResult | null {
  'worklet';
  const reSerial = new RegExp(SERIAL_RE_SRC);
  const reLetterAndNumber = new RegExp(LETTER_AND_NUMBER_RE_SRC);
  const reSpace = new RegExp(SPACE_SRC, 'g');
  const reNewline = new RegExp(NEWLINE_SRC, 'g');

  // ---- Strategy 1: label and value within the same block -----------------
  for (let bi = 0; bi < rt.blocks.length; bi++) {
    const block = rt.blocks[bi];
    if (block == null) continue;
    let s = block.text.trim().replace(reSpace, '').toLowerCase();
    if (s.indexOf('\n') !== -1) s = s.replace(reNewline, '|');
    const m = reSerial.exec(s);
    if (m != null) {
      const serial = m[1];
      if (serial != null && reLetterAndNumber.test(serial)) {
        return { values: [serial.toUpperCase()] };
      }
    }
  }

  // ---- Strategy 2: label and value on different lines / in columns -------
  // Flatten to positioned lines. Falls back to block text (split on newlines)
  // when the adapter could not produce per-line geometry.
  // `hasGeometry` records whether a line's y/x came from a real bounding box or
  // was synthesised from its index. Without it, positional reasoning below is
  // meaningless: synthesised coordinates make every line in a later block look
  // "below" every line in an earlier one.
  const lines: {
    text: string;
    y: number;
    x: number;
    right: number;
    hasGeometry: boolean;
    blockIndex: number;
    lineIndex: number;
  }[] = [];
  for (let bi = 0; bi < rt.blocks.length; bi++) {
    const block = rt.blocks[bi];
    if (block == null) continue;

    const blockLines = block.lines;
    if (blockLines != null && blockLines.length > 0) {
      for (let li = 0; li < blockLines.length; li++) {
        const ln = blockLines[li];
        if (ln == null) continue;
        const t = ln.text.trim();
        if (t.length === 0) continue;
        const bx = ln.box;
        lines.push({
          text: t,
          y: bx != null ? bx.y : bi * 1000 + li,
          x: bx != null ? bx.x : 0,
          right: bx != null ? bx.x + bx.width : 0,
          hasGeometry: bx != null,
          blockIndex: bi,
          lineIndex: li,
        });
      }
    } else {
      const parts = block.text.split('\n');
      for (let pi = 0; pi < parts.length; pi++) {
        const p = parts[pi];
        if (p == null) continue;
        const t = p.trim();
        if (t.length === 0) continue;
        const bx = block.box;
        lines.push({
          text: t,
          y: bx != null ? bx.y + pi : bi * 1000 + pi,
          x: bx != null ? bx.x : 0,
          right: bx != null ? bx.x + bx.width : 0,
          hasGeometry: bx != null,
          blockIndex: bi,
          lineIndex: pi,
        });
      }
    }
  }
  if (lines.length === 0) return null;

  lines.sort((a, b) => (a.y !== b.y ? a.y - b.y : a.x - b.x));

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line == null) continue;
    const flat = line.text.replace(reSpace, '').toLowerCase();
    if (flat.indexOf('serialnumber') === -1 && flat.indexOf('serialno') === -1) continue;

    // The value may already be on this line after the label.
    const own = reSerial.exec(flat);
    if (own != null) {
      const serial = own[1];
      if (serial != null && reLetterAndNumber.test(serial)) {
        return { values: [serial.toUpperCase()] };
      }
    }

    // A candidate must look like a serial: 6+ alphanumerics with at least one
    // letter and one digit.
    //
    // NOTE: the returned value is NOT confusable-corrected. Observed on-device,
    // ML Kit read a real 'TN647Y07QV' as 'TN647YO7QV' — letter O for zero. That
    // cannot be repaired here: a serial has no checksum and no positional
    // structure (unlike a PAN, where positions 6-9 must be digits, or an
    // Aadhaar, where Verhoeff arbitrates), so any substitution would be a
    // coin-flip that silently corrupts correct reads. Surfacing the OCR's actual
    // output is the honest behaviour; O-vs-0 ambiguity is inherent to reading
    // alphanumeric serials and belongs in the consumer's confirmation step.
    const isCandidate = (text: string): string | null => {
      const t = text.replace(reSpace, '');
      if (t.length < 6) return null;
      if (!reLetterAndNumber.test(t)) return null;
      return t.toUpperCase();
    };

    if (line.hasGeometry) {
      // Real coordinates: look to the right on the same row first, since a
      // settings screen pairs label and value horizontally. Row height is the
      // right scale for the tolerance, and a "below" candidate must be within
      // roughly one row — otherwise an unrelated value further down the list
      // gets picked up.
      const rowTolerance = 24;
      const nearBelow = 90;
      for (let pass = 0; pass < 2; pass++) {
        let best: { text: string; dist: number } | null = null;
        for (let j = 0; j < lines.length; j++) {
          if (j === i) continue;
          const cand = lines[j];
          if (cand == null || !cand.hasGeometry) continue;

          const dy = cand.y - line.y;
          const sameRow = Math.abs(dy) <= rowTolerance && cand.x >= line.right - 1;
          const below = dy > rowTolerance && dy <= nearBelow;
          if (pass === 0 && !sameRow) continue;
          if (pass === 1 && !below) continue;

          const val = isCandidate(cand.text);
          if (val == null) continue;

          // Nearest wins, so the adjacent value beats one further away.
          const dist = pass === 0 ? cand.x - line.right : dy;
          if (best == null || dist < best.dist) best = { text: val, dist };
        }
        if (best != null) return { values: [best.text] };
      }
    } else {
      // No geometry at all. Confirmed on-device: an iPhone About screen arrives
      // as ONE block, zero lines, no boxes, with the rows column-major —
      // every label first, then every value:
      //
      //   [0] iOS Version    [4] 26.3.1 (a)
      //   [1] Model Name     [5] iPhone 13
      //   [2] Model Number   [6] MLPF3HN/A
      //   [3] Serial Number  [7] TN647Y07QV
      //
      // So the value for the label at index i is at index i + labelCount. What
      // matters is finding that BOUNDARY, and it cannot be found by asking
      // "does this line look like a serial?" — only 2 of the 4 values above
      // pass such a test ('26.3.1 (a)' and 'MLPF3HN/A' contain a dot, space and
      // slash). Rank-counting on candidates therefore skips entries and lands
      // on the wrong row, which is how the model name kept being returned.
      //
      // Instead detect the boundary structurally: a run of label-like lines
      // followed by the rest. A label here is text with no digits — true of
      // every label on the screen and of none of the values.
      // A label is a short run of words with no digits ('Serial Number') OR one
      // whose digits are not the payload ('iOS Version' has none; 'iPhone 13'
      // does, and is a VALUE). Distinguish by asking whether the line is mostly
      // letters and spaces and does not END in a digit — labels never do,
      // whereas 'iPhone 13' and '26.3.1 (a)' both effectively do.
      let labelCount = 0;
      while (labelCount < lines.length) {
        const l = lines[labelCount];
        if (l == null) break;
        const t = l.text.trim();
        const endsInDigit = /\d\s*[)>\].]*$/.test(t);
        const hasDigit = /\d/.test(t);
        if (endsInDigit || hasDigit) break;
        labelCount++;
      }

      if (labelCount > 0 && i < labelCount) {
        const paired = lines[i + labelCount];
        if (paired != null) {
          const val = isCandidate(paired.text);
          if (val != null) return { values: [val] };
        }
      }

      // Label-above-value, or label then value in reading order: no separate
      // value column, so take the next candidate after the label.
      for (let j = i + 1; j < lines.length; j++) {
        const cand = lines[j];
        if (cand == null) continue;
        const val = isCandidate(cand.text);
        if (val != null) return { values: [val] };
      }
    }
  }

  return null;
}
