/**
 * Local OCR result shape, decoupled from the underlying MLKit plugin.
 * Parsers consume this; adapters translate the plugin's response into it.
 *
 * Mirrors the subset of `RecognizedText` used by the Flutter parsers:
 * only `blocks[].text` is referenced.
 */
export interface TextBlock {
  text: string;
}

export interface RecognizedText {
  blocks: TextBlock[];
}

export type ParserFn = (rt: RecognizedText) => string[] | null;
