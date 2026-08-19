import { makeAadhaarCard } from '../aadhaarCardReader';
import type { RecognizedText } from '../types';
import { verhoeffCheckDigit } from '../verhoeff';

/**
 * Builds a RecognizedText with real per-line geometry, laid out top-to-bottom.
 * Same convention as panCardReader.test.ts — each parser test file defines its
 * own fixture helper rather than sharing one.
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

/**
 * All Aadhaar numbers here are SYNTHETIC — generated so the Verhoeff checksum
 * passes. No real Aadhaar number appears in this file.
 */
const mkNumber = (payload11: string) => payload11 + String(verhoeffCheckDigit(payload11));
const NUM = mkNumber('23456789012'); // 12 digits, valid checksum, leading 2
const NUM_GROUPED = NUM.slice(0, 4) + ' ' + NUM.slice(4, 8) + ' ' + NUM.slice(8);

// A 16-digit VID-shaped number — the false positive the parser must never
// return. Printed on the card directly below the Aadhaar number.
const VID = '9144221294402180';
const VID_GROUPED = '9144 2212 9440 2180';

/** e-Aadhaar bottom-left card: labelled, bilingual, DD/MM/YYYY. */
const E_AADHAAR = [
  'अनिता शर्मा',
  'ANITA SHARMA',
  'जन्म तिथि/DOB: 09/05/1997',
  'पुरुष/ MALE',
  NUM_GROUPED,
  'VID : ' + VID_GROUPED,
  'मेरा आधार, मेरी पहचान',
];

/** PVC card: NO labels at all, DD-MM-YYYY, bare gender. */
const PVC = ['GOVERNMENT OF INDIA', 'ANITA SHARMA', 'Female', '20-06-1986', NUM_GROUPED, 'MY AADHAAR'];

describe('makeAadhaarCard', () => {
  const parser = makeAadhaarCard({});

  it('reads the labelled e-Aadhaar card', () => {
    const r = parser(card(...E_AADHAAR));
    expect(r).not.toBeNull();
    expect(r!.values).toEqual([NUM]);
    expect(r!.fields!.aadhaarNumber).toBe(NUM);
    expect(r!.fields!.name).toBe('ANITA SHARMA');
    expect(r!.fields!.dob).toBe('09-05-1997');
    expect(r!.fields!.gender).toBe('MALE');
  });

  it('reads the unlabelled PVC card', () => {
    const r = parser(card(...PVC));
    expect(r).not.toBeNull();
    expect(r!.fields!.aadhaarNumber).toBe(NUM);
    expect(r!.fields!.name).toBe('ANITA SHARMA');
    expect(r!.fields!.dob).toBe('20-06-1986');
    expect(r!.fields!.gender).toBe('FEMALE');
  });

  // The key convergence test: a labelled and an unlabelled layout must yield
  // the same shape of result, since only one is label-anchored.
  it('resolves the same field set from both layouts', () => {
    const a = parser(card(...E_AADHAAR))!;
    const b = parser(card(...PVC))!;
    expect(Object.keys(a.fields!).sort()).toEqual(Object.keys(b.fields!).sort());
    expect(a.fields!.aadhaarNumber).toBe(b.fields!.aadhaarNumber);
    expect(a.fields!.name).toBe(b.fields!.name);
  });

  describe('VID must never be returned as the Aadhaar number', () => {
    // The 16-digit VID sits on the card, so the crop does not remove it, and a
    // 12-digit window inside it can pass Verhoeff by chance. Excluding the line
    // and matching exact run boundaries are the two guards.
    it('ignores the VID line even when it is the only 12+ digit run', () => {
      const r = parser(card('ANITA SHARMA', '09/05/1997', 'MALE', 'VID : ' + VID_GROUPED));
      expect(r).toBeNull();
    });

    it('never returns a 12-digit slice of a 16-digit run', () => {
      const panOnly = makeAadhaarCard({ requireAllFields: false });
      // Bare 16-digit run with no 'VID' text — only the exact-length rule saves us.
      const r = panOnly(card('ANITA SHARMA', VID));
      expect(r).toBeNull();
    });

    it('picks the Aadhaar number, not the VID, when both are present', () => {
      const r = parser(card(...E_AADHAAR));
      expect(r!.fields!.aadhaarNumber).toBe(NUM);
      expect(r!.fields!.aadhaarNumber).not.toBe(VID);
      expect(r!.fields!.aadhaarNumber!.length).toBe(12);
    });
  });

  describe('number validation', () => {
    const panOnly = makeAadhaarCard({ requireAllFields: false });

    it('rejects a number whose checksum fails', () => {
      // Corrupt the last digit — Verhoeff catches every single-digit error.
      const bad = NUM.slice(0, 11) + String((+NUM[11]! + 1) % 10);
      expect(panOnly(card('ANITA SHARMA', bad))).toBeNull();
    });

    it('rejects a leading 0 or 1 even with a valid checksum', () => {
      for (const lead of ['0', '1']) {
        const n = mkNumber(lead + '2345678901');
        expect(panOnly(card('ANITA SHARMA', n))).toBeNull();
      }
    });

    it('accepts grouped and ungrouped forms identically', () => {
      const grouped = panOnly(card('ANITA SHARMA', NUM_GROUPED));
      const plain = panOnly(card('ANITA SHARMA', NUM));
      expect(grouped!.fields!.aadhaarNumber).toBe(NUM);
      expect(plain!.fields!.aadhaarNumber).toBe(NUM);
    });

    it('repairs OCR confusables, with Verhoeff arbitrating', () => {
      // Replace digits with their common letter misreads; the checksum confirms
      // the repair landed on the right number.
      const garbled = NUM.replace(/0/g, 'O').replace(/1/g, 'I').replace(/5/g, 'S');
      const r = panOnly(card('ANITA SHARMA', garbled));
      expect(r).not.toBeNull();
      expect(r!.fields!.aadhaarNumber).toBe(NUM);
    });
  });

  describe('date of birth', () => {
    it('normalises DD/MM/YYYY and DD-MM-YYYY and DD.MM.YYYY alike', () => {
      for (const [raw, expected] of [
        ['09/05/1997', '09-05-1997'],
        ['09-05-1997', '09-05-1997'],
        ['09.05.1997', '09-05-1997'],
      ] as const) {
        const r = parser(card('ANITA SHARMA', 'DOB: ' + raw, 'MALE', NUM_GROUPED));
        expect(r!.fields!.dob).toBe(expected);
      }
    });

    // The bilingual slash rule must not truncate a slash-separated DATE.
    it('does not truncate a DD/MM/YYYY value at the slash', () => {
      const r = parser(card('ANITA SHARMA', 'जन्म तिथि/DOB: 09/05/1997', 'MALE', NUM_GROUPED));
      expect(r!.fields!.dob).toBe('09-05-1997');
    });

    it('returns yearOfBirth when only a year is printed', () => {
      const r = parser(card('ANITA SHARMA', 'Year of Birth: 1997', 'MALE', NUM_GROUPED));
      expect(r!.fields!.yearOfBirth).toBe('1997');
      expect(r!.fields!.dob).toBeUndefined();
    });

    // 'DOB' is a substring of 'DATE OF BIRTH', and 'YEAR OF BIRTH' shares words
    // with it. Wrong ordering puts a full date in yearOfBirth or vice versa.
    it('does not confuse Year of Birth with Date of Birth', () => {
      const full = parser(card('ANITA SHARMA', 'Date of Birth: 09/05/1997', 'MALE', NUM_GROUPED));
      expect(full!.fields!.dob).toBe('09-05-1997');
      expect(full!.fields!.yearOfBirth).toBeUndefined();

      const yearOnly = parser(card('ANITA SHARMA', 'YOB: 1997', 'MALE', NUM_GROUPED));
      expect(yearOnly!.fields!.yearOfBirth).toBe('1997');
      expect(yearOnly!.fields!.dob).toBeUndefined();
    });

    it('never widens a year into a fabricated full date', () => {
      const r = parser(card('ANITA SHARMA', 'Year of Birth: 1997', 'MALE', NUM_GROUPED));
      expect(r!.fields!.dob).toBeUndefined();
      expect(r!.fields!.yearOfBirth).toBe('1997');
    });

    it('ignores a download or issue date', () => {
      const r = parser(
        card('ANITA SHARMA', 'Download Date: 12/11/2020', 'DOB: 09/05/1997', 'MALE', NUM_GROUPED),
      );
      expect(r!.fields!.dob).toBe('09-05-1997');
    });

    it('rejects an impossible date', () => {
      const panOnly = makeAadhaarCard({ requireAllFields: false });
      const r = panOnly(card('ANITA SHARMA', '45/13/1997', NUM_GROUPED));
      expect(r!.fields!.dob).toBeUndefined();
    });
  });

  describe('gender', () => {
    it('trims the space after the slash in "पुरुष/ MALE"', () => {
      const r = parser(card(...E_AADHAAR));
      expect(r!.fields!.gender).toBe('MALE');
    });

    it('matches a bare gender with no label', () => {
      const r = parser(card('ANITA SHARMA', 'Female', '20-06-1986', NUM_GROUPED));
      expect(r!.fields!.gender).toBe('FEMALE');
    });

    // 'MALE' is a substring of 'FEMALE', so ordering matters here too.
    it('does not read FEMALE as MALE', () => {
      const r = parser(card('ANITA SHARMA', 'FEMALE', '20-06-1986', NUM_GROUPED));
      expect(r!.fields!.gender).toBe('FEMALE');
    });

    it('matches TRANSGENDER without falling back to MALE', () => {
      const r = parser(card('ANITA SHARMA', 'TRANSGENDER', '20-06-1986', NUM_GROUPED));
      expect(r!.fields!.gender).toBe('TRANSGENDER');
    });
  });

  describe('name', () => {
    it('does not read boilerplate as the name', () => {
      const r = parser(card(...PVC));
      expect(r!.fields!.name).toBe('ANITA SHARMA');
      expect(r!.fields!.name).not.toContain('GOVERNMENT');
    });

    it('does not read a date or the number as the name', () => {
      const r = parser(card(...E_AADHAAR));
      expect(r!.fields!.name).toBe('ANITA SHARMA');
    });

    // Reported from device: 'GOVERNMENT OF INDIA' was being returned as the
    // name. Exact-phrase boilerplate matching missed the garbled variants OCR
    // actually produces, so the header line fell through to the name check.
    it('never returns a header line as the name, however garbled', () => {
      const headers = [
        'GOVERNMENT OF INDIA',
        'G0VERNMENT 0F INDIA', // zeros for O
        'GOVERNMENT OF lNDIA', // lowercase L for I
        'GOVERNMENTOFINDIA', // spaces dropped
        'GOVERNMENT OF IND1A', // one for I
        'G0VERNMENT 0F 1NDIA',
        'GOVT OF INDIA',
        'UNIQUE IDENTIFICATION AUTHORITY OF INDIA',
        'UNIQUE IDENTIFICATI0N AUTH0RITY 0F INDIA',
        'MERA AADHAAR MERI PEHCHAN',
        'MY AADHAAR',
        'AADHAAR IS PROOF OF IDENTITY NOT OF CITIZENSHIP',
      ];
      for (const header of headers) {
        const r = parser(card(header, 'ANITA SHARMA', 'DOB: 09/05/1997', 'MALE', NUM_GROUPED));
        expect(r).not.toBeNull();
        expect(r!.fields!.name).toBe('ANITA SHARMA');
      }
    });

    it('returns no name rather than boilerplate when the real name is absent', () => {
      const panOnly = makeAadhaarCard({ requireAllFields: false });
      const r = panOnly(card('G0VERNMENT 0F INDIA', 'MY AADHAAR', NUM_GROUPED));
      expect(r).not.toBeNull();
      expect(r!.fields!.name).toBeUndefined();
    });

    // The other half of the boilerplate filter: it must not swallow real names.
    // 'GOV' is a substring of GOVIND and 'HELP' of HELPA, so those tokens are
    // matched as whole words only — an earlier version rejected both.
    it('keeps a real name that contains a boilerplate word as a substring', () => {
      const realNames = [
        'GOVIND KUMAR',
        'GOVINDA RAJ',
        'INDIRA DEVI',
        'HELPA DEVI',
        'VIDYA NAIR',
        'INDU BALA',
      ];
      const panOnly = makeAadhaarCard({ requireAllFields: false });
      for (const realName of realNames) {
        const r = panOnly(card(realName, NUM_GROUPED));
        expect(r).not.toBeNull();
        expect(r!.fields!.name).toBe(realName);
      }
    });

    it('still rejects those words when they stand alone', () => {
      const panOnly = makeAadhaarCard({ requireAllFields: false });
      for (const boiler of ['GOV OF INDIA', 'HELP UIDAI GOV IN', 'GOVT OF INDIA']) {
        const r = panOnly(card(boiler, NUM_GROUPED));
        expect(r!.fields!.name).toBeUndefined();
      }
    });

    it('tolerates garbled regional-language lines', () => {
      const r = parser(
        card('~~~ |||', '<<>> ??', 'ANITA SHARMA', 'DOB: 09/05/1997', 'MALE', NUM_GROUPED),
      );
      expect(r!.fields!.name).toBe('ANITA SHARMA');
    });
  });

  describe('masked Aadhaar', () => {
    // Only 4 digits are real, so returning a number at all would be wrong.
    it('flags a masked card and withholds the number', () => {
      const r = parser(card('ANITA SHARMA', 'XXXX XXXX 3861', 'DOB: 09/05/1997', 'MALE'));
      expect(r).not.toBeNull();
      expect(r!.fields!.masked).toBe('true');
      expect(r!.fields!.aadhaarNumber).toBeUndefined();
      expect(r!.values).toEqual([]);
    });

    it('detects an asterisk mask too', () => {
      const r = parser(card('ANITA SHARMA', '**** **** 3861'));
      expect(r!.fields!.masked).toBe('true');
    });
  });

  describe('match gate', () => {
    it('returns null when the name is missing under requireAllFields', () => {
      expect(parser(card('DOB: 09/05/1997', 'MALE', NUM_GROUPED))).toBeNull();
    });

    it('returns null when no date of birth resolves', () => {
      expect(parser(card('ANITA SHARMA', 'MALE', NUM_GROUPED))).toBeNull();
    });

    it('accepts a year of birth in place of a full date', () => {
      const r = parser(card('ANITA SHARMA', 'YOB: 1997', 'MALE', NUM_GROUPED));
      expect(r).not.toBeNull();
    });

    it('returns the number alone when requireAllFields is false', () => {
      const panOnly = makeAadhaarCard({ requireAllFields: false });
      const r = panOnly(card(NUM_GROUPED));
      expect(r).not.toBeNull();
      expect(r!.values).toEqual([NUM]);
      expect(r!.fields!.name).toBeUndefined();
    });
  });

  describe('rejections', () => {
    it('returns null when no Aadhaar number is present', () => {
      expect(parser(card('GOVERNMENT OF INDIA', 'ANITA SHARMA', 'DOB: 09/05/1997'))).toBeNull();
    });

    it('returns null for empty input', () => {
      expect(parser({ blocks: [] })).toBeNull();
    });
  });

  it('works without geometry, falling back to block text order', () => {
    // The adapter's resultText fallback path yields text with no boxes.
    const r = parser({ blocks: [{ text: E_AADHAAR.join('\n') }] });
    expect(r).not.toBeNull();
    expect(r!.fields!.aadhaarNumber).toBe(NUM);
    expect(r!.fields!.name).toBe('ANITA SHARMA');
    expect(r!.fields!.dob).toBe('09-05-1997');
  });
});
