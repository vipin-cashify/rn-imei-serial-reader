import type { RecognizedText } from '../parsers/types';

/**
 * Maps the response from `react-native-vision-camera-text-recognition` v3's
 * `scanText(frame)` into our local RecognizedText shape.
 *
 * v3 returns `Text[]`, where each `Text` has `{ resultText, blocks }` and the
 * `blocks` value is a tuple `[frame, cornerPoints, lines, languages, blockText]`.
 * We read `blockText` (index 4) when present and fall back to `resultText`,
 * then to `\n\n`-splitting the resultText so blocks survive even if a future
 * plugin version flattens the shape.
 *
 * Implementation note: this function is called from a worklet runtime via the
 * Vision Camera frame processor. The worklets-core babel plugin auto-workletizes
 * the directly-called function but does NOT reliably carry private file-local
 * helpers into worklet scope, so all logic is inlined here on purpose.
 */
type V3Text = {
  resultText?: string;
  blocks?: unknown;
};

export function toRecognizedText(raw: unknown): RecognizedText {
  'worklet';
  if (raw == null) return { blocks: [] };

  const blocks: { text: string }[] = [];

  if (Array.isArray(raw)) {
    const arr = raw as V3Text[];
    for (let i = 0; i < arr.length; i++) {
      const item = arr[i];
      if (item == null) continue;
      const blocksField = item.blocks;
      let text = '';
      if (Array.isArray(blocksField) && blocksField.length >= 5) {
        const candidate = blocksField[4];
        if (typeof candidate === 'string' && candidate.length > 0) text = candidate;
      }
      if (text.length === 0 && item.resultText != null) text = item.resultText;
      if (text.length > 0) blocks.push({ text });
    }
    return { blocks };
  }

  if (typeof raw === 'object') {
    const r = raw as { result?: { text?: string }; resultText?: string; text?: string };
    const t1 = r.result == null ? undefined : r.result.text;
    const fullText =
      t1 != null ? t1 : r.resultText != null ? r.resultText : r.text != null ? r.text : '';
    if (fullText.length === 0) return { blocks: [] };
    const parts = fullText.split('\n\n');
    for (let i = 0; i < parts.length; i++) {
      const p = parts[i];
      if (p == null) continue;
      const t = p.trim();
      if (t.length > 0) blocks.push({ text: t });
    }
    return { blocks };
  }

  return { blocks: [] };
}
