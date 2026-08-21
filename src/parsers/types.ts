/**
 * Local OCR result shape, decoupled from the underlying MLKit plugin.
 * Parsers consume this; adapters translate the plugin's response into it.
 *
 * Originally this mirrored only the subset used by the Flutter parsers
 * (`blocks[].text`). Document readers (PAN, Aadhaar) need geometry as well —
 * associating a label like `/FATHER'S NAME` with its value is a positional
 * problem, not a string one — so line-level text and bounding boxes are
 * carried too.
 *
 * Everything beyond `blocks[].text` is OPTIONAL on purpose: the adapter's
 * fallback path (splitting `resultText` on blank lines) cannot produce
 * geometry, and the four original parsers never look at it.
 */

/** Axis-aligned box in source-image pixels, top-left origin. */
export interface BoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** A single recognized word within a line. */
export interface TextElement {
  text: string;
  box?: BoundingBox;
}

/** A single recognized line within a block. */
export interface TextLine {
  text: string;
  box?: BoundingBox;
  elements?: TextElement[];
}

export interface TextBlock {
  text: string;
  box?: BoundingBox;
  lines?: TextLine[];
}

export interface RecognizedText {
  blocks: TextBlock[];
}

/** Named fields extracted from a structured document (PAN, Aadhaar, …). */
export interface DocumentFields {
  [field: string]: string | undefined;
}

/**
 * What a parser returns on a match.
 *
 * `values` is always populated — for document readers it holds the primary
 * identifier (e.g. the PAN number) — so consumers that only ever read
 * `values` keep working unchanged. `fields` carries the named breakdown for
 * document readers and is absent for the simple string readers.
 */
export interface ParserResult {
  values: string[];
  fields?: DocumentFields;
}

export type ParserFn = (rt: RecognizedText) => ParserResult | null;
