import { processSerial } from '../serialNoReader';

const block = (text: string) => ({ blocks: [{ text }] });

describe('processSerial', () => {
  it('extracts a serial after "Serial Number:" prefix', () => {
    expect(processSerial(block('Serial Number: ABC123XYZ'))).toEqual({ values: ['ABC123XYZ'] });
  });

  it('uppercases the result', () => {
    expect(processSerial(block('serialnumber:abc123'))).toEqual({ values: ['ABC123'] });
  });

  it('requires both letters and digits', () => {
    expect(processSerial(block('Serial Number: ABCDEF'))).toBeNull();
    expect(processSerial(block('Serial Number: 123456'))).toBeNull();
  });

  it('rejects serials shorter than 6 chars', () => {
    expect(processSerial(block('Serial Number: AB12'))).toBeNull();
  });

  it('handles newline replacement', () => {
    expect(processSerial(block('Serial Number\nABC123XYZ'))).toEqual({ values: ['ABC123XYZ'] });
  });

  it('returns null for empty input', () => {
    expect(processSerial({ blocks: [] })).toBeNull();
  });

  it('returns null when no serial number marker present', () => {
    expect(processSerial(block('random text ABC123'))).toBeNull();
  });

  /**
   * Reported from device: an iPhone "About" screen would not scan, while a Mac
   * "About This Mac" panel did. Both are two-column layouts, so the column
   * arrangement was not the differentiator — the Mac's columns are tight enough
   * that ML Kit merges label and value into one block (which the original
   * same-block match handled), whereas the iPhone pushes the value to the far
   * right edge and they land in separate blocks with nothing to join them.
   */
  describe('label and value in separate columns', () => {
    const ln = (text: string, x: number, y: number, w = 200) => ({
      text,
      box: { x, y, width: w, height: 20 },
    });

    it('reads a value to the right of the label on the same row', () => {
      const rt = {
        blocks: [
          {
            text: 'Serial Number\nTN647Y07QV',
            box: { x: 70, y: 880, width: 780, height: 40 },
            lines: [ln('Serial Number', 70, 880, 260), ln('TN647Y07QV', 600, 880, 250)],
          },
        ],
      };
      expect(processSerial(rt)).toEqual({ values: ['TN647Y07QV'] });
    });

    it('reads a value on the line below the label', () => {
      const rt = {
        blocks: [
          {
            text: 'Serial Number\nTN647Y07QV',
            box: { x: 70, y: 880, width: 300, height: 60 },
            lines: [ln('Serial Number', 70, 880), ln('TN647Y07QV', 70, 910)],
          },
        ],
      };
      expect(processSerial(rt)).toEqual({ values: ['TN647Y07QV'] });
    });

    // The row above holds 'Model Number  MLPF3HN/A'. Picking that would be a
    // silent, plausible-looking wrong answer.
    it('does not take the value from a neighbouring row', () => {
      const rt = {
        blocks: [
          {
            text: 'about',
            box: { x: 70, y: 300, width: 800, height: 650 },
            lines: [
              ln('Model Number', 70, 750, 270),
              ln('MLPF3HN/A', 625, 750, 225),
              ln('Serial Number', 70, 885, 260),
              ln('TN647Y07QV', 600, 885, 250),
            ],
          },
        ],
      };
      expect(processSerial(rt)).toEqual({ values: ['TN647Y07QV'] });
    });

    it('still reads the Mac layout, where the columns merge into one block', () => {
      const merged = block(
        'Chip Apple M1 Pro\nMemory 16 GB\nSerial number W7Q47F0H4L\nmacOS Tahoe 26.2',
      );
      expect(processSerial(merged)).toEqual({ values: ['W7Q47F0H4L'] });
    });

    it('reads the Mac layout when it arrives as separate columns', () => {
      const rt = {
        blocks: [
          {
            text: 'about this mac',
            box: { x: 60, y: 320, width: 330, height: 120 },
            lines: [
              ln('Chip', 100, 326, 90),
              ln('Apple M1 Pro', 195, 326, 130),
              ln('Serial number', 62, 390, 128),
              ln('W7Q47F0H4L', 195, 390, 118),
              ln('macOS', 90, 422, 100),
              ln('Tahoe 26.2', 195, 422, 105),
            ],
          },
        ],
      };
      expect(processSerial(rt)).toEqual({ values: ['W7Q47F0H4L'] });
    });

    it('works when label and value are separate blocks with no geometry', () => {
      expect(processSerial({ blocks: [{ text: 'Serial Number' }, { text: 'TN647Y07QV' }] })).toEqual({
        values: ['TN647Y07QV'],
      });
    });

    /**
     * Reported from device: the reader returned the MODEL NAME instead of the
     * serial. Cause: when ML Kit groups column-major (all labels in one block,
     * all values in another) and supplies no per-line boxes, the y coordinates
     * are synthesised from block/line indices — so every value line looks
     * "below" every label line, and the first plausible one won regardless of
     * which label it belonged to. Values are now paired by their index within
     * the column instead.
     */
    /**
     * VERIFIED against real device output. An iPhone About screen arrives as
     * ONE block with zero lines and no boxes, rows column-major:
     *
     *   [0] iOS Version   [4] 26.3.1 (a)
     *   [1] Model Name    [5] iPhone 13
     *   [2] Model Number  [6] MLPF3HN/A
     *   [3] Serial Number [7] TN647Y07QV
     *
     * Earlier fixtures here guessed at the grouping and guessed wrong, which is
     * why several "fixes" passed tests and still failed on device. This text is
     * copied verbatim from a logcat capture.
     */
    it('reads the serial from real iPhone About OCR output', () => {
      const rt = block(
        'iOS Version\nModel Name\nModel Number\nSerial Number\n' +
          '26.3.1 (a)\niPhone 13\nMLPF3HN/A\nTN647Y07QV',
      );
      expect(processSerial(rt)).toEqual({ values: ['TN647Y07QV'] });
    });

    it('reads it despite the trailing chevron OCR picks up on the version row', () => {
      const rt = block(
        'iOS Version\nModel Name\nModel Number\nSerial Number\n' +
          '26.3.1 (a) >\niPhone 13\nMLPF3HNA\nTN647Y07QV',
      );
      expect(processSerial(rt)).toEqual({ values: ['TN647Y07QV'] });
    });

    // The value column contains entries that are NOT serial-shaped
    // ('26.3.1 (a)' has dots and a space, 'MLPF3HN/A' a slash). Counting only
    // serial-shaped candidates therefore skips rows and lands on the wrong one,
    // which is why the parser finds the label-run/value-run BOUNDARY instead of
    // ranking candidates.
    it('is not thrown off by non-serial-shaped values in the same column', () => {
      const rt = block(
        'iOS Version\nModel Name\nModel Number\nSerial Number\n' +
          '26.3.1 (a)\niPhone 13\nMLPF3HN/A\nTN647Y07QV',
      );
      expect(processSerial(rt)?.values[0]).not.toBe('IPHONE13');
      expect(processSerial(rt)).toEqual({ values: ['TN647Y07QV'] });
    });

    it('pairs column-major blocks that DO carry geometry', () => {
      const rt = {
        blocks: [
          {
            text: 'labels',
            box: { x: 76, y: 330, width: 340, height: 580 },
            lines: [
              ln('Model Name', 76, 600, 290),
              ln('Model Number', 76, 735, 335),
              ln('Serial Number', 76, 870, 320),
            ],
          },
          {
            text: 'values',
            box: { x: 755, y: 330, width: 320, height: 580 },
            lines: [
              ln('iPhone 13', 850, 600, 225),
              ln('MLPF3HN/A', 790, 735, 285),
              ln('TN647Y07QV', 755, 870, 320),
            ],
          },
        ],
      };
      expect(processSerial(rt)).toEqual({ values: ['TN647Y07QV'] });
    });

    it('reads the whole About screen when merged into one block', () => {
      const rt = block(
        'Name iPhone\niOS Version 26.3.1 (a)\nModel Name iPhone 13\n' +
          'Model Number MLPF3HN/A\nSerial Number TN647Y07QV',
      );
      expect(processSerial(rt)).toEqual({ values: ['TN647Y07QV'] });
    });

    it('does not match a nearby value that is not serial-shaped', () => {
      const rt = {
        blocks: [
          {
            text: 'x',
            box: { x: 70, y: 880, width: 780, height: 40 },
            // 'Tahoe 26.2' has a letter and a digit but a space and a dot; the
            // label row's value must still be rejected if it is not alphanumeric.
            lines: [ln('Serial Number', 70, 880, 260), ln('Not Available', 600, 880, 250)],
          },
        ],
      };
      expect(processSerial(rt)).toBeNull();
    });
  });
});
