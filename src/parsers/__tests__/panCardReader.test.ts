import { makePanCard } from '../panCardReader';
import type { RecognizedText } from '../types';

/**
 * Builds a RecognizedText with real per-line geometry, laid out top-to-bottom.
 * The existing `block()` helper in the sibling test files cannot express lines
 * or boxes, and label→value association is positional, so document parsers
 * need this richer fixture.
 */
const card = (...lineTexts: string[]): RecognizedText => ({
  blocks: [
    {
      text: lineTexts.join('\n'),
      box: { x: 0, y: 0, width: 400, height: lineTexts.length * 20 },
      lines: lineTexts.map((text, i) => ({
        text,
        box: { x: 0, y: i * 20, width: 400, height: 18 },
      })),
    },
  ],
});

/** A well-formed pre-2017 card, in the bilingual label order seen on real cards. */
const FULL_CARD = [
  'INCOME TAX DEPARTMENT',
  'GOVT. OF INDIA',
  'स्थाई लेखा संख्या /PERMANENT ACCOUNT NUMBER',
  'ABGPR1484A',
  'नाम /NAME',
  'GUDISIVARIPALLI RADHIKA',
  'पिता का नाम /FATHERS NAME',
  'ANANTHAKRISHNA',
  'जन्म तिथि /DATE OF BIRTH',
  '01-08-1963',
];

describe('makePanCard', () => {
  const parser = makePanCard({});

  it('extracts all four fields from a labelled card', () => {
    const r = parser(card(...FULL_CARD));
    expect(r).not.toBeNull();
    expect(r!.values).toEqual(['ABGPR1484A']);
    expect(r!.fields).toEqual({
      panNumber: 'ABGPR1484A',
      name: 'GUDISIVARIPALLI RADHIKA',
      fatherName: 'ANANTHAKRISHNA',
      dob: '01-08-1963',
      entityCode: 'P',
      entityType: 'Individual',
    });
  });

  // Every issued PAN uses one of the ten documented entity codes, so an
  // unrecognised 4th character means the read is wrong. With no check digit to
  // fall back on this is one of the few structural validations available.
  it('rejects a PAN whose 4th character is not a valid entity code', () => {
    const panOnly = makePanCard({ requireAllFields: false });
    expect(panOnly(card('/PERMANENT ACCOUNT NUMBER', 'ABGNR1484A'))).toBeNull();
  });

  it('exposes entityCode as the stable value to branch on', () => {
    const panOnly = makePanCard({ requireAllFields: false });
    const r = panOnly(card('/PERMANENT ACCOUNT NUMBER', 'ABGCR1484A'));
    expect(r!.fields!.entityCode).toBe('C');
    expect(r!.fields!.entityType).toBe('Company');
  });

  // The single most likely correctness bug: 'NAME' is a substring of both
  // 'FATHERS NAME' and 'PERMANENT ACCOUNT NUMBER'. Matching short labels first
  // swaps these two fields and produces plausible-looking wrong output.
  it('does not swap name and fatherName', () => {
    const r = parser(card(...FULL_CARD));
    expect(r!.fields!.name).toBe('GUDISIVARIPALLI RADHIKA');
    expect(r!.fields!.fatherName).toBe('ANANTHAKRISHNA');
  });

  it('does not treat the PAN label line as the name', () => {
    const r = parser(card(...FULL_CARD));
    expect(r!.fields!.name).not.toContain('PERMANENT');
    expect(r!.fields!.name).not.toContain('ACCOUNT');
  });

  it('accepts values on the same line as their label', () => {
    const r = parser(
      card(
        '/PERMANENT ACCOUNT NUMBER ABGPR1484A',
        '/NAME GUDISIVARIPALLI RADHIKA',
        '/FATHERS NAME ANANTHAKRISHNA',
        '/DATE OF BIRTH 01-08-1963',
      ),
    );
    expect(r).not.toBeNull();
    expect(r!.fields!.panNumber).toBe('ABGPR1484A');
    expect(r!.fields!.fatherName).toBe('ANANTHAKRISHNA');
  });

  it('accepts DD/MM/YYYY and DD.MM.YYYY dates', () => {
    for (const d of ['01/08/1963', '01.08.1963']) {
      const lines = FULL_CARD.slice(0, -1).concat([d]);
      const r = parser(card(...lines));
      expect(r!.fields!.dob).toBe('01-08-1963');
    }
  });

  it('tolerates garbled Devanagari between real content', () => {
    const r = parser(
      card(
        'INCOME TAX DEPARTMENT',
        '~~~ |||',
        '/PERMANENT ACCOUNT NUMBER',
        'ABGPR1484A',
        '<<>> ??',
        '/NAME',
        'GUDISIVARIPALLI RADHIKA',
        '/FATHERS NAME',
        'ANANTHAKRISHNA',
        '/DATE OF BIRTH',
        '01-08-1963',
      ),
    );
    expect(r).not.toBeNull();
    expect(r!.fields!.name).toBe('GUDISIVARIPALLI RADHIKA');
  });

  describe('OCR confusable repair', () => {
    it('repairs letters misread as digits in the letter block', () => {
      // ABGPR -> 4BGPR (A misread as 4 is not repaired), so use O/0 and I/1:
      // 'ABGPR1484A' with O in place of the letter position.
      const lines = FULL_CARD.slice();
      lines[3] = 'A8GPR1484A'; // '8' should be repaired back to 'B'
      const r = parser(card(...lines));
      expect(r!.fields!.panNumber).toBe('ABGPR1484A');
    });

    it('repairs digits misread as letters in the digit block', () => {
      const lines = FULL_CARD.slice();
      lines[3] = 'ABGPRI484A'; // 'I' should be repaired to '1'
      const r = parser(card(...lines));
      expect(r!.fields!.panNumber).toBe('ABGPR1484A');
    });
  });

  describe('entity type decoding', () => {
    const cases: [string, string][] = [
      ['ABGPR1484A', 'Individual'],
      ['ABGCR1484A', 'Company'],
      ['ABGHR1484A', 'Hindu Undivided Family'],
      ['ABGFR1484A', 'Firm'],
      ['ABGTR1484A', 'Trust'],
      ['ABGAR1484A', 'Association of Persons'],
      ['ABGBR1484A', 'Body of Individuals'],
      ['ABGLR1484A', 'Local Authority'],
      ['ABGJR1484A', 'Artificial Juridical Person'],
      ['ABGGR1484A', 'Government'],
    ];
    const panOnly = makePanCard({ requireAllFields: false });

    for (const [pan, expected] of cases) {
      it(`decodes ${pan.charAt(3)} as ${expected}`, () => {
        const r = panOnly(card('/PERMANENT ACCOUNT NUMBER', pan));
        expect(r!.fields!.entityType).toBe(expected);
      });
    }
  });

  describe('match gate', () => {
    it('returns null when a required field is missing', () => {
      const r = parser(card('/PERMANENT ACCOUNT NUMBER', 'ABGPR1484A', '/NAME', 'RADHIKA'));
      expect(r).toBeNull();
    });

    it('returns the PAN alone when requireAllFields is false', () => {
      const panOnly = makePanCard({ requireAllFields: false });
      const r = panOnly(card('/PERMANENT ACCOUNT NUMBER', 'ABGPR1484A'));
      expect(r).not.toBeNull();
      expect(r!.values).toEqual(['ABGPR1484A']);
      expect(r!.fields!.name).toBeUndefined();
    });

    // A company PAN carries no father's name, so requiring one would make
    // non-individual cards impossible to match.
    it('does not require fatherName for a non-individual PAN', () => {
      const r = parser(
        card(
          '/PERMANENT ACCOUNT NUMBER',
          'ABGCR1484A',
          '/NAME',
          'ACME TRADING PRIVATE LIMITED',
          '/DATE OF INCORPORATION',
          '01-08-1963',
        ),
      );
      expect(r).not.toBeNull();
      expect(r!.fields!.entityType).toBe('Company');
      expect(r!.fields!.fatherName).toBeUndefined();
    });
  });

  describe('rejections', () => {
    it('returns null when no PAN is present', () => {
      expect(parser(card('INCOME TAX DEPARTMENT', '/NAME', 'RADHIKA'))).toBeNull();
    });

    it('returns null for empty input', () => {
      expect(parser({ blocks: [] })).toBeNull();
    });

    it('rejects a malformed PAN', () => {
      // Only four leading letters — not repairable into a valid PAN.
      expect(parser(card('/PERMANENT ACCOUNT NUMBER', 'ABG1484A'))).toBeNull();
    });

    it('does not accept a date as a name', () => {
      const r = parser(
        card(
          '/PERMANENT ACCOUNT NUMBER',
          'ABGPR1484A',
          '/NAME',
          '01-08-1963',
          '/FATHERS NAME',
          'ANANTHAKRISHNA',
          '/DATE OF BIRTH',
          '01-08-1963',
        ),
      );
      expect(r).toBeNull();
    });
  });

  it('works without geometry, falling back to block text order', () => {
    // The adapter's resultText fallback path yields text with no boxes.
    const rt: RecognizedText = {
      blocks: [{ text: FULL_CARD.join('\n') }],
    };
    const r = parser(rt);
    expect(r).not.toBeNull();
    expect(r!.fields!.panNumber).toBe('ABGPR1484A');
    expect(r!.fields!.fatherName).toBe('ANANTHAKRISHNA');
  });
});
