import type { ParserFn, ParserResult, RecognizedText, TextLine } from './types';
import { isValidAadhaarNumber } from './verhoeff';

/**
 * Aadhaar card reader — FRONT SIDE ONLY.
 *
 * Extracts the Aadhaar number, name, date of birth, and gender. The address is
 * printed on the back and is out of scope; reading it needs a two-sided flow.
 *
 * The scan target is the card portion — the PVC card itself, or the perforated
 * card at the bottom-left of an e-Aadhaar printout. Everything else on an
 * e-Aadhaar sheet (the address block, the boilerplate column, the enrolment
 * header) sits outside that card and is removed by the scan-region crop.
 *
 * Two layouts, both handled:
 *
 *   e-Aadhaar card — labelled, bilingual "Hindi/ENGLISH:" with a colon:
 *     <name in regional script>
 *     ANITA SHARMA
 *     जन्म तिथि/DOB: 09/05/1997
 *     पुरुष/ MALE
 *     2345 6789 0123
 *     VID : 9144 2212 9440 2180
 *
 *   PVC card — NO labels at all, bare values:
 *     GOVERNMENT OF INDIA
 *     ANITA SHARMA
 *     Female
 *     20-06-1986
 *     2345 6789 0123
 *
 * Because the PVC card has no DOB or gender label, label-anchoring alone cannot
 * cover both forms — there is a format sweep as a fallback for each field. The
 * crop is what makes that safe: without it, a bare date sweep would happily
 * match a download date or an enrolment number elsewhere on the sheet.
 *
 * Unlike PAN, the Aadhaar number carries a REAL check digit (Verhoeff), so a
 * candidate can be mathematically verified rather than merely format-matched.
 * That is why confusable repair here is aggressive and uniform: a wrong repair
 * simply fails the checksum. See verhoeff.ts.
 *
 * All logic is inlined in the returned function on purpose. Do not factor it
 * out.
 */

// Regex sources only — the RegExp objects are built inside the returned
// function below.
const DIGIT_RUN_SRC = '[0-9]+';
const DOB_SRC = '\\b(\\d{2})[-/.](\\d{2})[-/.](\\d{4})\\b';
const YEAR_SRC = '\\b(19\\d{2}|20\\d{2})\\b';
const NAME_VALID_SRC = "^[A-Z][A-Z .'-]{2,}$";
const MASKED_SRC = '[X*]{4}\\s*[X*]{4}\\s*\\d{4}';

/**
 * Lines that must never yield the Aadhaar number.
 *
 * `VID` is the one that matters, and the only one that survives the crop: it is
 * printed on the card itself directly below the Aadhaar number, and it is 16
 * digits. A sliding 12-digit window inside it can pass the Verhoeff checksum by
 * coincidence, so the checksum cannot protect us — the line has to be excluded
 * outright. The rest are cheap insurance for a loosely-positioned card or a
 * consumer that scans without a scan region.
 */
const NUMBER_EXCLUDED_LINES = ['VID', 'ENROLMENT', 'ENROLLMENT', 'नामांकन', 'MOBILE', 'VIRTUAL'];

/**
 * Distinctive words that only ever appear in card boilerplate, never in a
 * person's name.
 *
 * Exact-string boilerplate matching is not enough on its own: OCR routinely
 * garbles 'GOVERNMENT OF INDIA' into 'G0VERNMENT 0F INDIA', 'GOVERNMENTOFINDIA',
 * 'GOVERNMENT OF lNDIA' and similar, none of which `indexOf` catches — and the
 * line then falls through and is accepted as the name. Matching on single
 * distinctive tokens survives that, because a garbled line almost always keeps
 * at least one recognisable word.
 *
 * These are checked after collapsing confusable characters (0→O, 1→I, 5→S,
 * 8→B) and removing spaces, so 'G0VERNMENT' and 'GOVERNMENT' both hit.
 */
const BOILERPLATE_TOKENS = [
  'GOVERNMENT',
  'GOVERNMEN', // OCR sometimes clips the trailing T
  'INDIA',
  'UNIQUE',
  'IDENTIFICATION',
  'IDENTIFICATI',
  'AUTHORITY',
  'AUTH0RITY',
  'AADHAAR',
  'AADHAR',
  'ADHAAR',
  'UIDAI',
  'PEHCHAN',
  'PEHCHAAN',
  'IDENTITY',
  'CITIZENSHIP',
  'ENROLMENT',
  'ENROLLMENT',
  'DOWNLOAD',
  'INFORMATION',
  'ADDRESS',
  'MOBILE',
];

/**
 * Short boilerplate words that are ALSO substrings of real Indian names, so they
 * must match as whole words rather than substrings.
 *
 * Without this distinction 'GOV' rejects GOVIND, and 'HELP' rejects HELPA — both
 * plausible names. Checked against the space-preserving text, not the collapsed
 * form, since word boundaries are the whole point.
 */
const BOILERPLATE_WORDS = ['GOVT', 'GOV', 'HELP', 'PROOF', 'VID', 'UID', 'INFO'];

/**
 * Label variants per field, checked LONGEST FIRST.
 *
 * Order is load-bearing, exactly as in panCardReader: 'DOB' is a substring of
 * 'DATE OF BIRTH', and 'YEAR OF BIRTH' shares words with 'DATE OF BIRTH'.
 * Testing the short forms first would let a full date land in `yearOfBirth`, or
 * a bare year land in `dob` — plausible-looking wrong output. Each matched line
 * is consumed so it cannot match again.
 *
 * NOTE: this ordering is hand-maintained, not computed. Adding a variant means
 * placing it correctly by length yourself.
 */
const LABELS: { field: string; variants: string[] }[] = [
  { field: 'yearOfBirth', variants: ['YEAR OF BIRTH', 'YOB'] },
  { field: 'dob', variants: ['DATE OF BIRTH', 'जन्म तिथि', 'DOB', 'D.O.B'] },
  { field: 'gender', variants: ['GENDER', 'SEX', 'लिंग'] },
  { field: 'name', variants: ['NAME', 'नाम'] },
];

const GENDERS = ['TRANSGENDER', 'FEMALE', 'MALE', 'OTHER'];

export interface AadhaarCardOptions {
  /**
   * When true (default) the parser reports a match only once the number, name,
   * and a date of birth (full date or year) have all resolved. When false, a
   * checksum-valid Aadhaar number alone is enough.
   */
  requireAllFields?: boolean;
}

export function makeAadhaarCard(opts: AadhaarCardOptions): ParserFn {
  const requireAllFields = opts.requireAllFields !== false;

  return function processAadhaarCard(rt: RecognizedText): ParserResult | null {
    const reDigitRun = new RegExp(DIGIT_RUN_SRC, 'g');
    const reDob = new RegExp(DOB_SRC);
    const reYear = new RegExp(YEAR_SRC);
    const reNameValid = new RegExp(NAME_VALID_SRC);
    const reMasked = new RegExp(MASKED_SRC);

    // ---- 1. Flatten to an ordered line list -----------------------------
    // Prefer real per-line geometry; fall back to splitting block text when the
    // adapter could not produce lines (its resultText fallback path).
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

    lines.sort((a, b) => (a.y !== b.y ? a.y - b.y : a.x - b.x));

    // ---- 2. Normalize each line ------------------------------------------
    // Aadhaar labels print as "जन्म तिथि/DOB: 09/05/1997" — Hindi and English
    // joined by a slash with no space, then a colon before the value. Keeping
    // the text after the slash discards the Devanagari half (which the Latin
    // recognizer garbles anyway) and leaves "DOB: 09/05/1997".
    //
    // Only strip when the text after the slash starts with a LETTER. Without
    // that guard a bare date '09/05/1997' would be truncated to '05/1997' —
    // which is exactly why the PAN parser has the same condition. Do not
    // "simplify" this.
    const norm: string[] = [];
    for (let i = 0; i < lines.length; i++) {
      const raw = lines[i];
      if (raw == null) {
        norm.push('');
        continue;
      }
      let s = raw.text.toUpperCase();
      const slash = s.indexOf('/');
      if (slash !== -1) {
        const after = s.substring(slash + 1).trim();
        // 'पुरुष/ MALE' has a space after the slash, hence the trim above.
        if (after.length > 0 && /^[A-Z]/.test(after)) s = after;
      }
      s = s.replace(/['`’]/g, '');
      // Keep date separators; stripping '-' would turn '20-06-1986' into
      // '20 06 1986' and the date would no longer parse. Keep '*' too, since a
      // masked number may be printed as '**** **** 1234' and the mask check
      // below runs on this normalised text.
      s = s.replace(/[^A-Z0-9 .\-/:*]/g, ' ');
      s = s.replace(/\s+/g, ' ').trim();
      norm.push(s);
    }

    // ---- 3. Masked-Aadhaar detection (before anything else) ---------------
    // 'XXXX XXXX 1234' is a legitimately-issued document, but only 4 digits are
    // real. Returning that as a complete number would be a data-integrity bug,
    // so report the mask and withhold the number entirely.
    for (let i = 0; i < norm.length; i++) {
      const n = norm[i];
      if (n != null && reMasked.test(n)) {
        return { values: [], fields: { masked: 'true' } };
      }
    }

    // ---- 4. Aadhaar number ------------------------------------------------
    let aadhaarNumber: string | null = null;

    for (let pass = 0; pass < 2 && aadhaarNumber == null; pass++) {
      for (let i = 0; i < norm.length && aadhaarNumber == null; i++) {
        const n = norm[i];
        if (n == null || n.length === 0) continue;

        // Exclude the line BEFORE looking for digits. See NUMBER_EXCLUDED_LINES.
        let excluded = false;
        for (let ei = 0; ei < NUMBER_EXCLUDED_LINES.length; ei++) {
          const bad = NUMBER_EXCLUDED_LINES[ei];
          if (bad != null && n.indexOf(bad) !== -1) {
            excluded = true;
            break;
          }
        }
        if (excluded) continue;

        // Pass 0 only considers lines carrying the number's own label; pass 1
        // considers everything else. Prefers the labelled line when present.
        const isLabelled = n.indexOf('AADHAAR NO') !== -1 || n.indexOf('आधार क्रमांक') !== -1;
        if (pass === 0 && !isLabelled) continue;
        if (pass === 1 && isLabelled) continue;

        // Join grouped digits ('2345 6789 0123' -> '234567890123') but keep
        // non-digit runs as boundaries so a 16-digit VID cannot be sliced into
        // a 12-digit candidate.
        const compact = n.replace(/(?<=\d)\s+(?=\d)/g, '');
        reDigitRun.lastIndex = 0;
        let m = reDigitRun.exec(compact);
        while (m != null) {
          const run = m[0];
          // EXACT length only — never a window inside a longer run.
          if (run != null && run.length === 12 && isValidAadhaarNumber(run)) {
            aadhaarNumber = run;
            break;
          }
          m = reDigitRun.exec(compact);
        }

        // Confusable repair, then let Verhoeff arbitrate. Every position is a
        // digit, so coercion is uniform — no position typing needed as in PAN.
        if (aadhaarNumber == null) {
          const repaired = n
            .replace(/(?<=[\dOQDILZSGTB])\s+(?=[\dOQDILZSGTB])/g, '')
            .replace(/[OQD]/g, '0')
            .replace(/[IL]/g, '1')
            .replace(/Z/g, '2')
            .replace(/S/g, '5')
            .replace(/G/g, '6')
            .replace(/T/g, '7')
            .replace(/B/g, '8');
          reDigitRun.lastIndex = 0;
          let rm = reDigitRun.exec(repaired);
          while (rm != null) {
            const run = rm[0];
            if (run != null && run.length === 12 && isValidAadhaarNumber(run)) {
              aadhaarNumber = run;
              break;
            }
            rm = reDigitRun.exec(repaired);
          }
        }
      }
    }

    if (aadhaarNumber == null) return null;

    // ---- 5. Label-anchored fields ----------------------------------------
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

        let hitAt = -1;
        let hitLen = 0;
        for (let vi = 0; vi < label.variants.length; vi++) {
          const v = label.variants[vi];
          if (v == null) continue;
          const at = n.indexOf(v);
          if (at !== -1) {
            hitAt = at;
            hitLen = v.length;
            break;
          }
        }
        if (hitAt === -1) continue;

        consumed[i] = true;

        // Value may follow the label on the same line (after an optional
        // colon), or sit on the next usable line.
        let value: string | null = null;
        const tail = n.substring(hitAt + hitLen).replace(/^[:\s.]+/, '').trim();
        if (tail.length > 0) value = tail;

        if (value == null) {
          for (let j = i + 1; j < lines.length; j++) {
            if (consumed[j]) continue;
            const candNorm = norm[j];
            if (candNorm == null || candNorm.length === 0) continue;

            // Label-as-value guard: if the next line is itself a label, this
            // field's value is missing rather than being the label text.
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

            // Fuzzy boilerplate check — see the name loop below for why exact
            // phrase matching is not enough.
            const candCollapsed = candNorm
              .replace(/0/g, 'O')
              .replace(/1/g, 'I')
              .replace(/5/g, 'S')
              .replace(/8/g, 'B')
              .replace(/[^A-Z]/g, '');
            let isBoiler = false;
            for (let ci = 0; ci < BOILERPLATE_TOKENS.length; ci++) {
              const t = BOILERPLATE_TOKENS[ci];
              if (t != null && candCollapsed.indexOf(t) !== -1) {
                isBoiler = true;
                break;
              }
            }
            if (!isBoiler) {
              const cwords = candNorm.split(/[^A-Z0-9]+/);
              for (let wi = 0; wi < cwords.length && !isBoiler; wi++) {
                const w = cwords[wi];
                if (w == null || w.length === 0) continue;
                for (let bi2 = 0; bi2 < BOILERPLATE_WORDS.length; bi2++) {
                  if (w === BOILERPLATE_WORDS[bi2]) {
                    isBoiler = true;
                    break;
                  }
                }
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

    // ---- 6. Resolve DOB / year of birth ----------------------------------
    // Two paths, because the PVC card prints a bare date with no label.
    let dob: string | undefined;
    let yearOfBirth: string | undefined;

    const dobRaw = fields.dob;
    if (dobRaw != null) {
      const m2 = reDob.exec(dobRaw);
      if (m2 != null) {
        const d = m2[1];
        const mo = m2[2];
        const y = m2[3];
        if (d != null && mo != null && y != null) {
          const dn = +d;
          const mn = +mo;
          const yn = +y;
          if (dn >= 1 && dn <= 31 && mn >= 1 && mn <= 12 && yn >= 1900) {
            dob = d + '-' + mo + '-' + y;
          }
        }
      }
    }

    // Fallback sweep for an unlabelled date. Safe only because the crop
    // excludes download/issue dates that live outside the card.
    if (dob == null) {
      for (let i = 0; i < norm.length; i++) {
        const n = norm[i];
        if (n == null) continue;
        // A date on a line naming a download/issue date is not a birth date.
        if (n.indexOf('DOWNLOAD') !== -1 || n.indexOf('ISSUE') !== -1) continue;
        const m3 = reDob.exec(n);
        if (m3 == null) continue;
        const d = m3[1];
        const mo = m3[2];
        const y = m3[3];
        if (d == null || mo == null || y == null) continue;
        const dn = +d;
        const mn = +mo;
        const yn = +y;
        if (dn < 1 || dn > 31 || mn < 1 || mn > 12 || yn < 1900) continue;
        dob = d + '-' + mo + '-' + y;
        break;
      }
    }

    // Year-only cards: UIDAI prints just the year when the DOB is 'declared' or
    // 'approximate'. Never widen a year into a full date — that invents
    // precision the card does not carry.
    if (dob == null) {
      const yobRaw = fields.yearOfBirth;
      if (yobRaw != null) {
        const my = reYear.exec(yobRaw);
        if (my != null && my[1] != null) yearOfBirth = my[1];
      }
    }

    // ---- 7. Gender --------------------------------------------------------
    // The PVC card prints a bare 'Male'/'Female' with no label, so match the
    // keyword anywhere. TRANSGENDER is tested before MALE because 'MALE' is a
    // substring of 'FEMALE' — order matters here as much as in the label table.
    let gender: string | undefined;
    const genderRaw = fields.gender;
    const genderHaystack: string[] = [];
    if (genderRaw != null) genderHaystack.push(genderRaw);
    for (let i = 0; i < norm.length; i++) {
      const n = norm[i];
      if (n != null) genderHaystack.push(n);
    }
    for (let hi = 0; hi < genderHaystack.length && gender == null; hi++) {
      const hay = genderHaystack[hi];
      if (hay == null) continue;
      for (let gi = 0; gi < GENDERS.length; gi++) {
        const g = GENDERS[gi];
        if (g != null && hay.indexOf(g) !== -1) {
          gender = g;
          break;
        }
      }
    }

    // ---- 8. Name ----------------------------------------------------------
    // Label-anchored when a label exists (rare on Aadhaar); otherwise the first
    // name-shaped line that is not boilerplate, a date, a number, or a gender.
    let name: string | undefined;
    const nameRaw = fields.name;
    if (
      nameRaw != null &&
      reNameValid.test(nameRaw) &&
      reDob.exec(nameRaw) == null &&
      /[A-Z]/.test(nameRaw)
    ) {
      // Even a label-anchored value must clear the boilerplate check: if 'NAME'
      // matched a garbled header line, the value taken from it can still be
      // boilerplate.
      const rawCollapsed = nameRaw
        .replace(/0/g, 'O')
        .replace(/1/g, 'I')
        .replace(/5/g, 'S')
        .replace(/8/g, 'B')
        .replace(/[^A-Z]/g, '');
      let rawIsBoiler = false;
      for (let ci = 0; ci < BOILERPLATE_TOKENS.length; ci++) {
        const t = BOILERPLATE_TOKENS[ci];
        if (t != null && rawCollapsed.indexOf(t) !== -1) {
          rawIsBoiler = true;
          break;
        }
      }
      if (!rawIsBoiler) {
        const rwords = nameRaw.split(/[^A-Z0-9]+/);
        for (let wi = 0; wi < rwords.length && !rawIsBoiler; wi++) {
          const w = rwords[wi];
          if (w == null || w.length === 0) continue;
          for (let bi2 = 0; bi2 < BOILERPLATE_WORDS.length; bi2++) {
            if (w === BOILERPLATE_WORDS[bi2]) {
              rawIsBoiler = true;
              break;
            }
          }
        }
      }
      if (!rawIsBoiler) name = nameRaw;
    }

    if (name == null) {
      for (let i = 0; i < norm.length; i++) {
        const n = norm[i];
        if (n == null || n.length === 0) continue;

        // Boilerplate check, fuzzy. Collapse confusable characters and remove
        // spaces first, so a garbled 'G0VERNMENT 0F lNDIA' still matches the
        // 'GOVERNMENT' / 'INDIA' tokens. An exact indexOf on the full phrase
        // misses those, and the line then gets accepted as the name — which is
        // exactly how 'GOVERNMENT OF INDIA' was being returned.
        const collapsed = n
          .replace(/0/g, 'O')
          .replace(/1/g, 'I')
          .replace(/5/g, 'S')
          .replace(/8/g, 'B')
          .replace(/[^A-Z]/g, '');
        let isBoiler = false;
        for (let ci = 0; ci < BOILERPLATE_TOKENS.length; ci++) {
          const t = BOILERPLATE_TOKENS[ci];
          if (t != null && collapsed.indexOf(t) !== -1) {
            isBoiler = true;
            break;
          }
        }
        // Whole-word pass for short tokens that are substrings of real names.
        if (!isBoiler) {
          const words = n.split(/[^A-Z0-9]+/);
          for (let wi = 0; wi < words.length && !isBoiler; wi++) {
            const w = words[wi];
            if (w == null || w.length === 0) continue;
            for (let bi2 = 0; bi2 < BOILERPLATE_WORDS.length; bi2++) {
              if (w === BOILERPLATE_WORDS[bi2]) {
                isBoiler = true;
                break;
              }
            }
          }
        }
        if (isBoiler) continue;

        let isGender = false;
        for (let gi = 0; gi < GENDERS.length; gi++) {
          const g = GENDERS[gi];
          if (g != null && n.indexOf(g) !== -1) {
            isGender = true;
            break;
          }
        }
        if (isGender) continue;

        let isLabel = false;
        for (let ai = 0; ai < LABELS.length; ai++) {
          const other = LABELS[ai];
          if (other == null) continue;
          for (let vi = 0; vi < other.variants.length; vi++) {
            const v = other.variants[vi];
            if (v != null && n.indexOf(v) !== -1) {
              isLabel = true;
              break;
            }
          }
          if (isLabel) break;
        }
        if (isLabel) continue;

        if (reDob.exec(n) != null) continue;
        if (/\d/.test(n)) continue;
        if (!reNameValid.test(n)) continue;

        name = n;
        break;
      }
    }

    // ---- 9. Match gate ----------------------------------------------------
    if (requireAllFields) {
      if (name == null) return null;
      if (dob == null && yearOfBirth == null) return null;
    }

    const out: Record<string, string | undefined> = { aadhaarNumber };
    if (name != null) out.name = name;
    if (dob != null) out.dob = dob;
    if (yearOfBirth != null) out.yearOfBirth = yearOfBirth;
    if (gender != null) out.gender = gender;

    return { values: [aadhaarNumber], fields: out };
  };
}
