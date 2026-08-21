import type { BoundingBox, RecognizedText, TextBlock, TextLine } from '../parsers/types';

/**
 * Maps the response from `react-native-vision-camera-text-recognition` v3 into
 * our local RecognizedText shape.
 *
 * The plugin encodes each block as a positional TUPLE rather than an object:
 *
 *   BlocksData   = [blockFrame, blockCornerPoints, lines, blockLanguages, blockText]
 *   LinesData    = [lineCornerPoints, elements, lineFrame, lineLanguages, lineText]
 *   ElementsData = [elementCornerPoints, elementFrame, elementText]
 *   FrameType    = { x, y, width, height, boundingCenterX, boundingCenterY }
 *
 * Note the index of the frame differs between blocks (0) and lines (2) — easy
 * to get wrong, hence the named constants below.
 *
 * Historically this adapter read only `blockText` and discarded the geometry.
 * Document parsers need it: associating `/FATHER'S NAME` with the value
 * beneath it is a positional problem solved by ordering on `line.box.y`.
 *
 * Robustness note: the plugin's own `.d.ts` declares `PhotoRecognizer` returns
 * a single `Text`, while `scanText` returns `Text[]`. Rather than trust either,
 * we accept BOTH an array of blocks and a single object, and fall back to
 * splitting `resultText` when no structured blocks are present. The fallback
 * yields text without geometry, which is why every geometry field is optional.
 *
 * Implementation note: this runs in a worklet runtime. The worklets-core babel
 * plugin does NOT reliably carry file-local helpers into worklet scope, so all
 * logic is inlined in this one function on purpose. Do not factor it out.
 */

const BLOCK_FRAME = 0;
const BLOCK_LINES = 2;
const BLOCK_TEXT = 4;

const LINE_ELEMENTS = 1;
const LINE_FRAME = 2;
const LINE_TEXT = 4;

const ELEMENT_FRAME = 1;
const ELEMENT_TEXT = 2;

type V3Text = {
  resultText?: string;
  blocks?: unknown;
};

export function toRecognizedText(raw: unknown): RecognizedText {
  'worklet';
  if (raw == null) return { blocks: [] };

  const blocks: TextBlock[] = [];

  // Normalize the top level: `scanText` returns Text[], `PhotoRecognizer`
  // declares a single Text. Treat both as a list of Text objects.
  const items: V3Text[] = Array.isArray(raw) ? (raw as V3Text[]) : [raw as V3Text];

  let resultTextFallback = '';

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (item == null) continue;

    if (typeof item.resultText === 'string' && item.resultText.length > 0) {
      resultTextFallback =
        resultTextFallback.length > 0 ? resultTextFallback + '\n\n' + item.resultText : item.resultText;
    }

    const blocksField = item.blocks;
    if (!Array.isArray(blocksField)) continue;

    // `blocks` is either ONE block tuple, or a list of block tuples. A block
    // tuple has its text (a string) at index 4; a list has arrays as entries.
    const isSingleBlockTuple = typeof blocksField[BLOCK_TEXT] === 'string';
    const blockTuples: unknown[] = isSingleBlockTuple ? [blocksField] : blocksField;

    for (let bi = 0; bi < blockTuples.length; bi++) {
      const bt = blockTuples[bi];
      if (!Array.isArray(bt)) continue;

      const blockText = bt[BLOCK_TEXT];
      if (typeof blockText !== 'string' || blockText.length === 0) continue;

      // --- block bounding box (inlined; no helpers in worklet scope) ---
      let blockBox: BoundingBox | undefined;
      const bf = bt[BLOCK_FRAME] as Record<string, unknown> | undefined;
      if (
        bf != null &&
        typeof bf.x === 'number' &&
        typeof bf.y === 'number' &&
        typeof bf.width === 'number' &&
        typeof bf.height === 'number'
      ) {
        blockBox = { x: bf.x, y: bf.y, width: bf.width, height: bf.height };
      }

      // --- lines ---
      const lines: TextLine[] = [];
      const lineTuples = bt[BLOCK_LINES];
      if (Array.isArray(lineTuples)) {
        // Same ambiguity as blocks: one line tuple, or a list of them.
        const isSingleLineTuple = typeof (lineTuples as unknown[])[LINE_TEXT] === 'string';
        const lineList: unknown[] = isSingleLineTuple ? [lineTuples] : (lineTuples as unknown[]);

        for (let li = 0; li < lineList.length; li++) {
          const lt = lineList[li];
          if (!Array.isArray(lt)) continue;

          const lineText = lt[LINE_TEXT];
          if (typeof lineText !== 'string' || lineText.length === 0) continue;

          let lineBox: BoundingBox | undefined;
          const lf = lt[LINE_FRAME] as Record<string, unknown> | undefined;
          if (
            lf != null &&
            typeof lf.x === 'number' &&
            typeof lf.y === 'number' &&
            typeof lf.width === 'number' &&
            typeof lf.height === 'number'
          ) {
            lineBox = { x: lf.x, y: lf.y, width: lf.width, height: lf.height };
          }

          // --- elements (words) ---
          const elements: { text: string; box?: BoundingBox }[] = [];
          const elTuples = lt[LINE_ELEMENTS];
          if (Array.isArray(elTuples)) {
            const isSingleElTuple = typeof (elTuples as unknown[])[ELEMENT_TEXT] === 'string';
            const elList: unknown[] = isSingleElTuple ? [elTuples] : (elTuples as unknown[]);

            for (let ei = 0; ei < elList.length; ei++) {
              const et = elList[ei];
              if (!Array.isArray(et)) continue;
              const elText = et[ELEMENT_TEXT];
              if (typeof elText !== 'string' || elText.length === 0) continue;

              let elBox: BoundingBox | undefined;
              const ef = et[ELEMENT_FRAME] as Record<string, unknown> | undefined;
              if (
                ef != null &&
                typeof ef.x === 'number' &&
                typeof ef.y === 'number' &&
                typeof ef.width === 'number' &&
                typeof ef.height === 'number'
              ) {
                elBox = { x: ef.x, y: ef.y, width: ef.width, height: ef.height };
              }

              elements.push(elBox != null ? { text: elText, box: elBox } : { text: elText });
            }
          }

          const line: TextLine = { text: lineText };
          if (lineBox != null) line.box = lineBox;
          if (elements.length > 0) line.elements = elements;
          lines.push(line);
        }
      }

      const block: TextBlock = { text: blockText };
      if (blockBox != null) block.box = blockBox;
      if (lines.length > 0) block.lines = lines;
      blocks.push(block);
    }
  }

  if (blocks.length > 0) return { blocks };

  // --- Fallback: no structured blocks, split resultText on blank lines. ---
  // Produces text without geometry, so geometry-dependent parsers degrade to
  // their non-positional path rather than breaking.
  if (resultTextFallback.length === 0) {
    // Some shapes nest the full text differently; try those before giving up.
    const r = raw as { result?: { text?: string }; resultText?: string; text?: string };
    const t1 = r.result == null ? undefined : r.result.text;
    resultTextFallback = t1 != null ? t1 : r.resultText != null ? r.resultText : r.text != null ? r.text : '';
  }
  if (resultTextFallback.length === 0) return { blocks: [] };

  const parts = resultTextFallback.split('\n\n');
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i];
    if (p == null) continue;
    const t = p.trim();
    if (t.length > 0) blocks.push({ text: t });
  }
  return { blocks };
}
