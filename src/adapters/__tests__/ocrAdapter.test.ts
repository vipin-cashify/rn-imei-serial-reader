import { toRecognizedText } from '../ocrAdapter';
import type { OcrFrame } from '../../specs/OcrRecognizer.nitro';

const box = (x: number, y: number, width: number, height: number) => ({ x, y, width, height });
const ZERO = box(0, 0, 0, 0);

function frame(blocks: OcrFrame['blocks']): OcrFrame {
  return { blocks, width: 720, height: 1280, orientation: 'portrait' };
}

describe('toRecognizedText', () => {
  it('returns no blocks for null or undefined input', () => {
    expect(toRecognizedText(null)).toEqual({ blocks: [] });
    expect(toRecognizedText(undefined)).toEqual({ blocks: [] });
  });

  it('maps blocks, lines and elements with their boxes', () => {
    const rt = toRecognizedText(
      frame([
        {
          text: 'Serial Number',
          box: box(10, 20, 100, 30),
          lines: [
            {
              text: 'Serial Number',
              box: box(10, 20, 100, 30),
              elements: [
                { text: 'Serial', box: box(10, 20, 40, 30) },
                { text: 'Number', box: box(55, 20, 55, 30) },
              ],
            },
          ],
        },
      ]),
    );

    expect(rt.blocks).toHaveLength(1);
    expect(rt.blocks[0]).toEqual({
      text: 'Serial Number',
      box: { x: 10, y: 20, width: 100, height: 30 },
      lines: [
        {
          text: 'Serial Number',
          box: { x: 10, y: 20, width: 100, height: 30 },
          elements: [
            { text: 'Serial', box: { x: 10, y: 20, width: 40, height: 30 } },
            { text: 'Number', box: { x: 55, y: 20, width: 55, height: 30 } },
          ],
        },
      ],
    });
  });

  it('turns all-zero boxes into undefined so parsers fall back to index ordering', () => {
    const rt = toRecognizedText(
      frame([
        {
          text: 'ABC',
          box: ZERO,
          lines: [{ text: 'ABC', box: ZERO, elements: [{ text: 'ABC', box: ZERO }] }],
        },
      ]),
    );
    expect(rt.blocks[0]?.box).toBeUndefined();
    expect(rt.blocks[0]?.lines?.[0]?.box).toBeUndefined();
    expect(rt.blocks[0]?.lines?.[0]?.elements?.[0]?.box).toBeUndefined();
  });

  it('drops blocks and lines whose text is blank', () => {
    const rt = toRecognizedText(
      frame([
        { text: '   ', box: ZERO, lines: [] },
        {
          text: 'KEEP',
          box: ZERO,
          lines: [
            { text: '  ', box: ZERO, elements: [] },
            { text: 'KEEP', box: ZERO, elements: [] },
          ],
        },
      ]),
    );
    expect(rt.blocks.map((b) => b.text)).toEqual(['KEEP']);
    expect(rt.blocks[0]?.lines?.map((l) => l.text)).toEqual(['KEEP']);
  });

  it('preserves block order (parsers sort by geometry themselves)', () => {
    const rt = toRecognizedText(
      frame([
        { text: 'second', box: box(0, 500, 10, 10), lines: [] },
        { text: 'first', box: box(0, 10, 10, 10), lines: [] },
      ]),
    );
    expect(rt.blocks.map((b) => b.text)).toEqual(['second', 'first']);
  });
});
