import type { ParserFn, ParserResult, RecognizedText, TextLine } from './types';

/**
 * PAN (Permanent Account Number) card reader.
 *
 * Extracts the PAN number plus name / father's name / date of birth from an
 * Indian PAN card. Works across all card eras — pre-2017, 2017+, and PAN 2.0
 * — because every era prints the same bilingual field labels:
 *
 *     स्थाई लेखा संख्या /PERMANENT ACCOUNT NUMBER
 *     नाम              /NAME
 *     पिता का नाम       /FATHER'S NAME
 *     जन्म तिथि         /DATE OF BIRTH
 *
 * Layout is label-ABOVE-value, so a value is the nearest line *below* its
 * label. That is position-independent, which is why one strategy covers the
 * differing era layouts. Only the fallback path (`Tier 2`, used when labels
 * fail to OCR through glare or wear) depends on absolute position.
 *
 * PAN number format is `AAAAA1111A`:
 *   pos 1-5   letters   (pos 4 = entity type, pos 5 = surname initial)
 *   pos 6-9   digits
 *   pos 10    letter    (check digit)
 *
 * IMPORTANT — there is no usable check digit. The algorithm behind position 10
 * is not published by the Income Tax Department (claims of "mod 36" online are
 * unverified). Unlike IMEI, which self-validates via Luhn, a PAN that matches
 * the format cannot be proven correct. Confidence therefore comes from label
 * context, position-aware confusable correction, and (in the hook) requiring
 * the same value across consecutive frames.
 *
 * Worklet note: this runs in a worklet runtime. The worklets-core babel plugin
 * does NOT reliably carry file-local helpers into worklet scope, so all logic
 * is inlined in the returned function on purpose. Do not factor it out.
 */

// Regex sources only — RegExp objects are constructed inside the worklet body
// so their prototype methods exist in the worklet VM.
const PAN_SRC = '[A-Z]{5}[0-9]{4}[A-Z]';
const PAN_STRICT_SRC = '^[A-Z]{5}[0-9]{4}[A-Z]$';
const DOB_SRC = '(\\d{2})[-/.](\\d{2})[-/.](\\d{4})';
const NON_ALNUM_SRC = '[^A-Z0-9]';
const NAME_VALID_SRC = "^[A-Z][A-Z .'-]*$";

/** Entity type encoded in the 4th character of every PAN. */
const ENTITY_TYPES: Record<string, string> = {
  A: 'Association of Persons',
  B: 'Body of Individuals',
  C: 'Company',
  F: 'Firm',
  G: 'Government',
  H: 'Hindu Undivided Family',
  J: 'Artificial Juridical Person',
  L: 'Local Authority',
  P: 'Individual',
  T: 'Trust',
};

/**
 * Label variants per field, checked LONGEST FIRST.
 *
 * Order is load-bearing: 'NAME' is a substring of both 'FATHERS NAME' and
 * 'PERMANENT ACCOUNT NUMBER'. Testing short labels first would match the wrong
 * line and silently swap name with father's name — producing output that looks
 * entirely plausible and is wrong. Each matched line is consumed so it cannot
 * match again.
 */
const LABELS: { field: string; variants: string[] }[] = [
  { field: 'pan', variants: ['PERMANENT ACCOUNT NUMBER', 'PERMANENT ACCOUNT NO'] },
  { field: 'fatherName', variants: ['FATHERS NAME', 'FATHER NAME'] },
  { field: 'dob', variants: ['DATE OF BIRTH', 'DATE OF INCORPORATION', 'DOB'] },
  { field: 'name', variants: ['NAME'] },
];

/** Lines that are card boilerplate, never a field value. */
const BOILERPLATE = [
  'INCOME TAX DEPARTMENT',
  'GOVT OF INDIA',
  'GOVT. OF INDIA',
  'GOVERNMENT OF INDIA',
  'CHIEF COMMISSIONER OF INCOME-TAX',
  'CHIEF COMMISSIONER OF INCOME TAX',
  'SIGNATURE',
  'PERMANENT ACCOUNT NUMBER CARD',
];

export interface PanCardOptions {
  /**
   * When true (default) every field must resolve before the parser reports a
   * match. When false, a valid PAN number alone is enough and the other fields
   * are returned best-effort.
   */
  requireAllFields?: boolean;
}

export function makePanCard(opts: PanCardOptions): ParserFn {
  const requireAllFields = opts.requireAllFields !== false;

  return function processPanCard(rt: RecognizedText): ParserResult | null {
    'worklet';
    const rePan = new RegExp(PAN_SRC);
    const rePanGlobal = new RegExp(PAN_SRC, 'g');
    const rePanStrict = new RegExp(PAN_STRICT_SRC);
    const reDob = new RegExp(DOB_SRC);
    const reNonAlnum = new RegExp(NON_ALNUM_SRC, 'g');
    const reNameValid = new RegExp(NAME_VALID_SRC);

    // ---- 1. Flatten to an ordered line list -----------------------------
    // Prefer real per-line geometry; fall back to splitting block text when
    // the adapter could not produce lines (its resultText fallback path).
    const lines: { text: string; y: number; x: number }[] = [];
    for (let bi = 0; bi < rt.blocks.length; bi++) {
      const block = rt.blocks[bi];
      if (block == null) continue;

      const blockLines: TextLine[] | undefined = block.lines;
      if (blockLines != null && blockLines.length > 0) {
        for (let li = 0; li < blockLines.length; li++) {
          const ln = blockLines[li];
          if (ln == null) continue;
          const t = ln.text.trim();
          if (t.length === 0) continue;
          lines.push({
            text: t,
            y: ln.box != null ? ln.box.y : bi * 1000 + li,
            x: ln.box != null ? ln.box.x : 0,
          });
        }
      } else {
        const parts = block.text.split('\n');
        for (let pi = 0; pi < parts.length; pi++) {
          const p = parts[pi];
          if (p == null) continue;
          const t = p.trim();
          if (t.length === 0) continue;
          lines.push({
            text: t,
            y: block.box != null ? block.box.y + pi : bi * 1000 + pi,
            x: block.box != null ? block.box.x : 0,
          });
        }
      }
    }
    if (lines.length === 0) return null;

    // Sort top-to-bottom, then left-to-right. Label-above-value only holds in
    // reading order, and OCR block order is not guaranteed to be spatial.
    lines.sort((a, b) => (a.y !== b.y ? a.y - b.y : a.x - b.x));

    // ---- 2. Normalize each line for label matching -----------------------
    // Uppercase, drop a leading '/', strip apostrophes (OCR renders them
    // inconsistently), and collapse to alphanumerics + spaces.
    const norm: string[] = [];
    for (let i = 0; i < lines.length; i++) {
      const raw = lines[i];
      if (raw == null) {
        norm.push('');
        continue;
      }
      let s = raw.text.toUpperCase();
      // Labels print as "हिन्दी /ENGLISH", so keep the part after the slash —
      // the Latin recognizer garbles the Devanagari half. Only do this when
      // the slash separates a label, never inside a value: a date written
      // '01/08/1963' would otherwise be truncated to '08/1963'.
      const slash = s.indexOf('/');
      if (slash !== -1) {
        const after = s.substring(slash + 1);
        // A label follows the slash immediately and is alphabetic.
        if (after.length > 0 && /^[A-Z]/.test(after)) s = after;
      }
      s = s.replace(/['`’]/g, '');
      // Keep date separators and name punctuation: stripping '-' would turn
      // '01-08-1963' into '01 08 1963' and the date would no longer parse.
      s = s.replace(/[^A-Z0-9 .\-/]/g, ' ');
      s = s.replace(/\s+/g, ' ').trim();
      norm.push(s);
    }

    // ---- 3. Tier 1: label-anchored extraction ---------------------------
    const consumed: boolean[] = [];
    for (let i = 0; i < lines.length; i++) consumed.push(false);

    const fields: Record<string, string | undefined> = {};

    for (let li = 0; li < LABELS.length; li++) {
      const label = LABELS[li];
      if (label == null) continue;

      for (let i = 0; i < norm.length; i++) {
        if (consumed[i]) continue;
        const n = norm[i];
        if (n == null || n.length === 0) continue;

        let matched = false;
        for (let vi = 0; vi < label.variants.length; vi++) {
          const v = label.variants[vi];
          if (v == null) continue;
          if (n.indexOf(v) !== -1) {
            matched = true;
            break;
          }
        }
        if (!matched) continue;

        consumed[i] = true;

        // The value may share the label's line (after the label text) or sit
        // on the next usable line below.
        let value: string | null = null;

        const own = norm[i];
        if (own != null) {
          for (let vi = 0; vi < label.variants.length; vi++) {
            const v = label.variants[vi];
            if (v == null) continue;
            const at = own.indexOf(v);
            if (at !== -1) {
              const tail = own.substring(at + v.length).trim();
              if (tail.length > 0) value = tail;
              break;
            }
          }
        }

        if (value == null) {
          for (let j = i + 1; j < lines.length; j++) {
            if (consumed[j]) continue;
            const cand = lines[j];
            const candNorm = norm[j];
            if (cand == null || candNorm == null || candNorm.length === 0) continue;

            // Guard against label-as-value: if the next line is itself a
            // label, this field's value is missing rather than being the
            // label text.
            let isLabel = false;
            for (let ai = 0; ai < LABELS.length; ai++) {
              const other = LABELS[ai];
              if (other == null) continue;
              for (let vi = 0; vi < other.variants.length; vi++) {
                const v = other.variants[vi];
                if (v != null && candNorm.indexOf(v) !== -1) {
                  isLabel = true;
                  break;
                }
              }
              if (isLabel) break;
            }
            if (isLabel) break;

            let isBoiler = false;
            for (let ci = 0; ci < BOILERPLATE.length; ci++) {
              const b = BOILERPLATE[ci];
              if (b != null && candNorm.indexOf(b) !== -1) {
                isBoiler = true;
                break;
              }
            }
            if (isBoiler) continue;

            value = candNorm;
            consumed[j] = true;
            break;
          }
        }

        if (value != null) fields[label.field] = value;
        break;
      }
    }

    // ---- 4. PAN number: regex sweep + confusable repair ------------------
    // The PAN is unambiguous in shape, so scan every line rather than relying
    // on its label having been read.
    let pan: string | null = null;

    const panCandidates: string[] = [];
    const labelled = fields.pan;
    if (labelled != null) panCandidates.push(labelled);
    for (let i = 0; i < norm.length; i++) {
      const n = norm[i];
      if (n != null && n.length > 0) panCandidates.push(n);
    }

    for (let ci = 0; ci < panCandidates.length && pan == null; ci++) {
      const cand = panCandidates[ci];
      if (cand == null) continue;
      const compact = cand.replace(reNonAlnum, '');

      // Direct hit first.
      const direct = compact.match(rePanGlobal);
      if (direct != null && direct.length > 0) {
        const hit = direct[0];
        if (hit != null) {
          pan = hit;
          break;
        }
      }

      // Confusable repair. PAN positions are typed, so ambiguity is
      // resolvable: 1-5 and 10 are letters, 6-9 are digits. Slide a 10-char
      // window and coerce each position to its required class.
      for (let s = 0; s + 10 <= compact.length; s++) {
        const win = compact.substring(s, s + 10);
        let fixed = '';
        for (let k = 0; k < 10; k++) {
          const ch = win.charAt(k);
          const wantsDigit = k >= 5 && k <= 8;
          if (wantsDigit) {
            if (ch === 'O' || ch === 'Q' || ch === 'D') fixed += '0';
            else if (ch === 'I' || ch === 'L') fixed += '1';
            else if (ch === 'Z') fixed += '2';
            else if (ch === 'S') fixed += '5';
            else if (ch === 'G') fixed += '6';
            else if (ch === 'T') fixed += '7';
            else if (ch === 'B') fixed += '8';
            else fixed += ch;
          } else {
            if (ch === '0') fixed += 'O';
            else if (ch === '1') fixed += 'I';
            else if (ch === '2') fixed += 'Z';
            else if (ch === '5') fixed += 'S';
            else if (ch === '6') fixed += 'G';
            else if (ch === '8') fixed += 'B';
            else fixed += ch;
          }
        }
        if (rePanStrict.test(fixed)) {
          pan = fixed;
          break;
        }
      }
    }

    if (pan == null) return null;
    if (!rePan.test(pan)) return null;

    // ---- 5. Validate and clean the remaining fields ----------------------
    const entityChar = pan.charAt(3);
    const entityType = ENTITY_TYPES[entityChar];
    // An unrecognised 4th character means this is not a real PAN — every issued
    // PAN uses one of the ten documented entity codes. Since there is no check
    // digit to fall back on, this is one of the few structural validations
    // available, so reject rather than return a confidently wrong read.
    if (entityType == null) return null;
    // Non-individual PANs (company, HUF, trust, …) carry no father's name.
    const isIndividual = entityChar === 'P';

    // DOB: accept only a real DD-MM-YYYY / DD/MM/YYYY / DD.MM.YYYY.
    let dob: string | undefined;
    const dobRaw = fields.dob;
    if (dobRaw != null) {
      const m = reDob.exec(dobRaw);
      if (m != null) dob = m[1] + '-' + m[2] + '-' + m[3];
    }
    if (dob == null) {
      // Not labelled (or the label failed to OCR) — sweep for a date shape.
      for (let i = 0; i < norm.length; i++) {
        const n = norm[i];
        if (n == null) continue;
        const m = reDob.exec(n);
        if (m != null) {
          dob = m[1] + '-' + m[2] + '-' + m[3];
          break;
        }
      }
    }

    // Names: reject anything that is a PAN, a date, or not name-shaped.
    let name: string | undefined;
    const nameRaw = fields.name;
    if (nameRaw != null && reNameValid.test(nameRaw) && !rePan.test(nameRaw) && reDob.exec(nameRaw) == null) {
      name = nameRaw;
    }

    let fatherName: string | undefined;
    const fatherRaw = fields.fatherName;
    if (
      fatherRaw != null &&
      reNameValid.test(fatherRaw) &&
      !rePan.test(fatherRaw) &&
      reDob.exec(fatherRaw) == null
    ) {
      fatherName = fatherRaw;
    }

    // ---- 6. Apply the match gate ----------------------------------------
    if (requireAllFields) {
      if (name == null || dob == null) return null;
      // Only individuals have a father's name; requiring it for a company PAN
      // would make non-individual cards impossible to match.
      if (isIndividual && fatherName == null) return null;
    }

    const out: Record<string, string | undefined> = { panNumber: pan };
    if (name != null) out.name = name;
    if (fatherName != null) out.fatherName = fatherName;
    if (dob != null) out.dob = dob;
    // `entityCode` is the raw 4th character and is the stable value to branch
    // on in code; `entityType` is a display string and may be reworded.
    out.entityCode = entityChar;
    out.entityType = entityType;

    return { values: [pan], fields: out };
  };
}
