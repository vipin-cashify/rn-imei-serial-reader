import type { BoundingBox, RecognizedText, TextBlock, TextElement, TextLine } from '../parsers/types';
import type { OcrBox, OcrFrame } from '../specs/OcrRecognizer.nitro';

/**
 * Maps a native `OcrFrame` (from the Nitro OCR camera output) to the parsers'
 * `RecognizedText` shape.
 *
 * The native side always fills a box; MLKit reports no box as all zeros. We
 * turn those into `undefined` so parsers use their index-based fallback
 * ordering, exactly as they did with the previous adapter's fallback path.
 */
export function toRecognizedText(frame: OcrFrame | null | undefined): RecognizedText {
  if (frame == null) return { blocks: [] };

  const blocks: TextBlock[] = [];
  for (const block of frame.blocks) {
    if (block.text.trim().length === 0) continue;

    const lines: TextLine[] = [];
    for (const line of block.lines) {
      if (line.text.trim().length === 0) continue;
      const elements: TextElement[] = line.elements.map((element) => withBox({ text: element.text }, element.box));
      lines.push(withBox({ text: line.text, elements }, line.box));
    }

    blocks.push(withBox({ text: block.text, lines }, block.box));
  }
  return { blocks };
}

function withBox<T extends object>(target: T, box: OcrBox): T & { box?: BoundingBox } {
  if (box.width <= 0 || box.height <= 0) return target;
  return { ...target, box: { x: box.x, y: box.y, width: box.width, height: box.height } };
}
