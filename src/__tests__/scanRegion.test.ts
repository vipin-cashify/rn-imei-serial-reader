import {
  DEFAULT_ASPECT_RATIO,
  DEFAULT_SCAN_REGION,
  ID1_ASPECT_RATIO,
  clampRect,
  computeCropRect,
  computePreviewBox,
  computeViewRect,
  previewRectToBufferRect,
  resolveScanRegion,
  viewRectToPreviewRect,
  type ResolvedScanRegion,
} from '../scanRegion';

const near = (a: number, b: number, eps = 1e-6) => Math.abs(a - b) < eps;

expect.extend({
  toBeCloseRect(received, expected: { x: number; y: number; width: number; height: number }) {
    const ok =
      received != null &&
      near(received.x, expected.x, 1e-4) &&
      near(received.y, expected.y, 1e-4) &&
      near(received.width, expected.width, 1e-4) &&
      near(received.height, expected.height, 1e-4);
    return {
      pass: ok,
      message: () => `expected ${JSON.stringify(received)} to be close to ${JSON.stringify(expected)}`,
    };
  },
});

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace jest {
    interface Matchers<R> {
      toBeCloseRect(expected: { x: number; y: number; width: number; height: number }): R;
    }
  }
}

describe('resolveScanRegion', () => {
  // The default is ID-1 opened up 20% in height, not ID-1 itself: a card-tight
  // window leaves no placement tolerance, and anything larger than a card (a
  // phone settings screen, a serial sticker) would not fit at all.
  it('defaults to ID-1 opened up 20% in height', () => {
    expect(ID1_ASPECT_RATIO).toBeCloseTo(85.6 / 54, 10);
    expect(DEFAULT_ASPECT_RATIO).toBeCloseTo(ID1_ASPECT_RATIO / 1.2, 10);
    expect(resolveScanRegion().aspectRatio).toBeCloseTo(DEFAULT_ASPECT_RATIO, 10);
  });

  it('yields a cutout 20% taller than ID-1 at the same width', () => {
    const idOne = computeViewRect({ ...DEFAULT_SCAN_REGION, aspectRatio: ID1_ASPECT_RATIO }, 1000, 2000)!;
    const dflt = computeViewRect(DEFAULT_SCAN_REGION, 1000, 2000)!;
    expect(dflt.width).toBeCloseTo(idOne.width, 10);
    expect(dflt.height / idOne.height).toBeCloseTo(1.2, 6);
  });

  it('applies overrides without dropping the other defaults', () => {
    const r = resolveScanRegion({ widthPercent: 0.5 });
    expect(r.widthPercent).toBe(0.5);
    expect(r.aspectRatio).toBe(DEFAULT_SCAN_REGION.aspectRatio);
    expect(r.dimOpacity).toBe(DEFAULT_SCAN_REGION.dimOpacity);
  });

  it('treats an explicit 0 as a real value, not a missing one', () => {
    expect(resolveScanRegion({ dimOpacity: 0 }).dimOpacity).toBe(0);
  });
});

describe('computePreviewBox', () => {
  it('fills the container under cover', () => {
    expect(computePreviewBox(1080, 2340, 720, 1280, 'cover')).toEqual({
      x: 0,
      y: 0,
      width: 1080,
      height: 2340,
    });
  });

  // The reported bug: under 'contain' a 16:9 buffer in a taller container is
  // letterboxed, so the video is narrower than the container. Drawing the
  // cutout against the container put its brackets in the black bars.
  it('letterboxes under contain and leaves side bars', () => {
    const box = computePreviewBox(1080, 2340, 720, 1280, 'contain');
    // Width binds: 1080/720 = 1.5 vs 2340/1280 = 1.828 -> scale 1.5.
    expect(box.width).toBeCloseTo(1080, 4);
    expect(box.height).toBeCloseTo(1920, 4);
    expect(box.y).toBeCloseTo(210, 4); // (2340-1920)/2
    expect(box.x).toBeCloseTo(0, 4);
  });

  it('letterboxes horizontally when height binds', () => {
    // A wide, short container: height binds, so bars appear on the sides.
    const box = computePreviewBox(2000, 1000, 720, 1280, 'contain');
    expect(box.height).toBeCloseTo(1000, 4);
    expect(box.width).toBeCloseTo(562.5, 4);
    expect(box.x).toBeCloseTo((2000 - 562.5) / 2, 4);
  });

  it('preserves the buffer aspect ratio under contain', () => {
    const box = computePreviewBox(1080, 2340, 720, 1280, 'contain');
    expect(box.width / box.height).toBeCloseTo(720 / 1280, 6);
  });

  it('never exceeds the container under contain', () => {
    const box = computePreviewBox(1080, 2340, 720, 1280, 'contain');
    expect(box.width).toBeLessThanOrEqual(1080);
    expect(box.height).toBeLessThanOrEqual(2340);
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.y).toBeGreaterThanOrEqual(0);
  });

  it('falls back to the container when dimensions are unusable', () => {
    expect(computePreviewBox(1080, 2340, 0, 0, 'contain')).toEqual({
      x: 0,
      y: 0,
      width: 1080,
      height: 2340,
    });
  });
});

describe('computeViewRect', () => {
  const region: ResolvedScanRegion = { ...DEFAULT_SCAN_REGION, widthPercent: 0.8, aspectRatio: 2 };

  it('centres the cutout horizontally', () => {
    const r = computeViewRect(region, 1000, 1000)!;
    expect(r.x).toBeCloseTo(0.1, 6);
    expect(r.width).toBeCloseTo(0.8, 6);
  });

  it('derives height from the aspect ratio', () => {
    // 800px wide at 2:1 -> 400px tall -> 0.4 of a 1000px view.
    const r = computeViewRect(region, 1000, 1000)!;
    expect(r.height).toBeCloseTo(0.4, 6);
  });

  it('preserves aspect ratio when height would overflow', () => {
    // A very short view forces the clamp; width must shrink to match.
    const r = computeViewRect(region, 1000, 100)!;
    const wPx = r.width * 1000;
    const hPx = r.height * 100;
    expect(wPx / hPx).toBeCloseTo(2, 4);
  });

  it('keeps the cutout on screen when pushed to an edge', () => {
    const top = computeViewRect({ ...region, verticalCenter: 0 }, 1000, 1000)!;
    expect(top.y).toBeGreaterThanOrEqual(0);
    const bottom = computeViewRect({ ...region, verticalCenter: 1 }, 1000, 1000)!;
    expect(bottom.y + bottom.height).toBeLessThanOrEqual(1 + 1e-9);
  });

  it('returns null for an unmeasured view', () => {
    expect(computeViewRect(region, 0, 0)).toBeNull();
    expect(computeViewRect(region, 100, 0)).toBeNull();
  });
});

describe('viewRectToPreviewRect', () => {
  const rect = { x: 0.1, y: 0.2, width: 0.5, height: 0.4 };

  it('is the identity under contain', () => {
    expect(viewRectToPreviewRect(rect, 1080, 2340, 720, 1280, 'contain')).toEqual(rect);
  });

  // 1280x720 buffer shown portrait (720x1280) on a 1080x2340 screen. Height
  // binds, so ~17.9% of the buffer width is off-screen, 8.96% per side.
  it('accounts for the cover centre-crop', () => {
    const out = viewRectToPreviewRect(rect, 1080, 2340, 720, 1280, 'cover');
    const scale = Math.max(1080 / 720, 2340 / 1280);
    const visW = 1080 / (720 * scale);
    expect(visW).toBeCloseTo(0.8205, 3);
    expect(out.x).toBeCloseTo((1 - visW) / 2 + 0.1 * visW, 6);
    expect(out.width).toBeCloseTo(0.5 * visW, 6);
    // Height binds, so the vertical axis is untouched.
    expect(out.y).toBeCloseTo(0.2, 6);
    expect(out.height).toBeCloseTo(0.4, 6);
  });

  it('falls back to the input rect when dimensions are unusable', () => {
    expect(viewRectToPreviewRect(rect, 0, 0, 720, 1280, 'cover')).toEqual(rect);
  });
});

describe('previewRectToBufferRect', () => {
  const rect = { x: 0.1, y: 0.2, width: 0.5, height: 0.3 };

  it('is the identity at 0 degrees', () => {
    expect(previewRectToBufferRect(rect, 0)).toEqual(rect);
  });

  // The Android case: sensor-native landscape buffer, portrait preview.
  it('swaps axes at 90 degrees', () => {
    const out = previewRectToBufferRect(rect, 90);
    expect(out).toBeCloseRect({ x: 0.2, y: 1 - 0.1 - 0.5, width: 0.3, height: 0.5 });
    // A wide-short rect must become narrow-tall.
    expect(out.width).toBeLessThan(out.height);
  });

  it('mirrors both axes at 180 degrees', () => {
    expect(previewRectToBufferRect(rect, 180)).toBeCloseRect({
      x: 1 - 0.1 - 0.5,
      y: 1 - 0.2 - 0.3,
      width: 0.5,
      height: 0.3,
    });
  });

  it('swaps axes the other way at 270 degrees', () => {
    expect(previewRectToBufferRect(rect, 270)).toBeCloseRect({
      x: 1 - 0.2 - 0.3,
      y: 0.1,
      width: 0.3,
      height: 0.5,
    });
  });

  it('normalises out-of-range and negative rotations', () => {
    expect(previewRectToBufferRect(rect, 450)).toEqual(previewRectToBufferRect(rect, 90));
    expect(previewRectToBufferRect(rect, -270)).toEqual(previewRectToBufferRect(rect, 90));
  });

  it('round-trips 90 then 270 back to the original', () => {
    const out = previewRectToBufferRect(previewRectToBufferRect(rect, 90), 270);
    expect(out).toBeCloseRect(rect);
  });

  it('keeps every rotation inside the unit square', () => {
    for (const deg of [0, 90, 180, 270]) {
      const out = previewRectToBufferRect(rect, deg);
      expect(out.x).toBeGreaterThanOrEqual(0);
      expect(out.y).toBeGreaterThanOrEqual(0);
      expect(out.x + out.width).toBeLessThanOrEqual(1 + 1e-9);
      expect(out.y + out.height).toBeLessThanOrEqual(1 + 1e-9);
    }
  });
});

describe('clampRect', () => {
  it('passes an in-range rect through', () => {
    const r = { x: 0.1, y: 0.1, width: 0.5, height: 0.5 };
    expect(clampRect(r)).toEqual(r);
  });

  it('trims a rect that overflows the buffer', () => {
    expect(clampRect({ x: -0.2, y: 0.5, width: 0.5, height: 0.9 })).toBeCloseRect({
      x: 0,
      y: 0.5,
      width: 0.3,
      height: 0.5,
    });
  });

  it('returns null when nothing remains', () => {
    expect(clampRect({ x: 1.5, y: 0, width: 0.2, height: 0.2 })).toBeNull();
    expect(clampRect({ x: 0, y: 0, width: 0, height: 0.5 })).toBeNull();
  });
});

describe('computeCropRect', () => {
  const base = {
    region: DEFAULT_SCAN_REGION,
    viewWidth: 1080,
    viewHeight: 2340,
    bufferWidth: 720,
    bufferHeight: 1280,
    resizeMode: 'contain' as const,
    rotationDegrees: 0,
  };

  it('produces a landscape rect for an upright buffer', () => {
    const r = computeCropRect(base)!;
    expect(r).not.toBeNull();
    expect(r.width).toBeGreaterThan(r.height);
  });

  it('produces a portrait rect once rotated 90 degrees', () => {
    const r = computeCropRect({ ...base, rotationDegrees: 90 })!;
    expect(r.height).toBeGreaterThan(r.width);
  });

  it('returns null when the region is disabled', () => {
    expect(computeCropRect({ ...base, region: { ...DEFAULT_SCAN_REGION, enabled: false } })).toBeNull();
  });

  it('returns null before the view has been measured', () => {
    expect(computeCropRect({ ...base, viewWidth: 0, viewHeight: 0 })).toBeNull();
  });

  it('stays within the unit square across every rotation and fit mode', () => {
    for (const resizeMode of ['cover', 'contain'] as const) {
      for (const rotationDegrees of [0, 90, 180, 270]) {
        const r = computeCropRect({ ...base, resizeMode, rotationDegrees })!;
        expect(r).not.toBeNull();
        expect(r.x).toBeGreaterThanOrEqual(0);
        expect(r.y).toBeGreaterThanOrEqual(0);
        expect(r.x + r.width).toBeLessThanOrEqual(1 + 1e-9);
        expect(r.y + r.height).toBeLessThanOrEqual(1 + 1e-9);
      }
    }
  });

  it('crops a narrower slice under cover than contain', () => {
    const contain = computeCropRect(base)!;
    const cover = computeCropRect({ ...base, resizeMode: 'cover' })!;
    // Cover hides part of the buffer, so the same on-screen cutout maps to a
    // smaller share of the buffer.
    expect(cover.width).toBeLessThan(contain.width);
  });
});
