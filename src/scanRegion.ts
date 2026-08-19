/**
 * Scan-region geometry: where the card cutout sits on screen, and how that
 * rectangle maps into the camera's pixel buffer so the native plugin can crop
 * to it.
 *
 * This module is deliberately PURE — no React, no native calls — because the
 * view→buffer transform is the riskiest code in the feature and a wrong
 * transform fails silently (you crop the wrong region and OCR simply stops
 * finding anything). Keeping it pure means it can be unit-tested exhaustively
 * without a device.
 *
 * Three transforms stack between the on-screen rect and the buffer rect:
 *
 *   1. PREVIEW FIT. `resizeMode: 'cover'` (Vision Camera's default) scales the
 *      buffer to fill the view and centre-crops the overflow, so part of the
 *      buffer is off-screen. `'contain'` letterboxes instead and makes this
 *      transform the identity.
 *   2. ROTATION. On Android the analysis buffer is sensor-native landscape
 *      while the preview is portrait, so a wide-short screen rect becomes a
 *      narrow-tall buffer rect. `rotationDegrees` is the rotation needed to
 *      make the buffer upright, so we apply its inverse to the rect.
 *   3. NORMALISATION. Everything here is in 0..1 so the native side can
 *      denormalise against whatever the real buffer dimensions turn out to be.
 */

/** Normalised rect, top-left origin, all values 0..1. */
export interface NormalizedRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** ISO/IEC 7810 ID-1 (CR80): 85.6mm x 54mm — PAN, Aadhaar, credit cards. */
export const ID1_ASPECT_RATIO = 85.6 / 54; // ≈ 1.5852

export interface ScanRegionOptions {
  /** Cutout width ÷ height. Defaults to ID-1 (≈1.585). */
  aspectRatio?: number;
  /** Cutout width as a fraction of the view width. Default 0.88. */
  widthPercent?: number;
  /** Vertical centre of the cutout as a fraction of view height. Default 0.5. */
  verticalCenter?: number;
  /** Opacity of the dimmed area outside the cutout. Default 0.6. */
  dimOpacity?: number;
  /** Corner bracket colour. Default '#fff'. */
  cornerColor?: string;
  /** Corner bracket arm length in dp. Default 28. */
  cornerLength?: number;
  /** Corner bracket stroke width in dp. Default 3. */
  cornerWidth?: number;
  /** Cutout corner radius in dp. Default 12. */
  borderRadius?: number;
  /** Hint text above the cutout. Pass '' to hide. */
  hintText?: string;
  /** Master switch. Default true. */
  enabled?: boolean;
}

export interface ResolvedScanRegion {
  aspectRatio: number;
  widthPercent: number;
  verticalCenter: number;
  dimOpacity: number;
  cornerColor: string;
  cornerLength: number;
  cornerWidth: number;
  borderRadius: number;
  hintText: string;
  enabled: boolean;
}

export const DEFAULT_SCAN_REGION: ResolvedScanRegion = {
  aspectRatio: ID1_ASPECT_RATIO,
  widthPercent: 0.88,
  verticalCenter: 0.5,
  dimOpacity: 0.6,
  cornerColor: '#ffffff',
  cornerLength: 28,
  cornerWidth: 3,
  borderRadius: 12,
  hintText: 'Fit the card inside the frame',
  enabled: true,
};

export function resolveScanRegion(opts?: ScanRegionOptions): ResolvedScanRegion {
  if (opts == null) return DEFAULT_SCAN_REGION;
  return {
    aspectRatio: opts.aspectRatio ?? DEFAULT_SCAN_REGION.aspectRatio,
    widthPercent: opts.widthPercent ?? DEFAULT_SCAN_REGION.widthPercent,
    verticalCenter: opts.verticalCenter ?? DEFAULT_SCAN_REGION.verticalCenter,
    dimOpacity: opts.dimOpacity ?? DEFAULT_SCAN_REGION.dimOpacity,
    cornerColor: opts.cornerColor ?? DEFAULT_SCAN_REGION.cornerColor,
    cornerLength: opts.cornerLength ?? DEFAULT_SCAN_REGION.cornerLength,
    cornerWidth: opts.cornerWidth ?? DEFAULT_SCAN_REGION.cornerWidth,
    borderRadius: opts.borderRadius ?? DEFAULT_SCAN_REGION.borderRadius,
    hintText: opts.hintText ?? DEFAULT_SCAN_REGION.hintText,
    enabled: opts.enabled ?? DEFAULT_SCAN_REGION.enabled,
  };
}

/**
 * Where the camera preview actually sits inside its container, in container
 * pixels.
 *
 * Under `contain` the preview keeps its aspect ratio and is letterboxed, so it
 * does NOT fill the container: a 16:9 buffer shown portrait in a taller
 * container leaves black bars down the sides. The overlay must be drawn
 * against this rect rather than the container, or the cutout and its corner
 * brackets land in the letterbox bars where there is no video at all.
 *
 * Under `cover` the preview always fills the container, so this is the
 * container itself.
 */
export function computePreviewBox(
  containerWidth: number,
  containerHeight: number,
  bufferWidth: number,
  bufferHeight: number,
  resizeMode: 'cover' | 'contain',
): { x: number; y: number; width: number; height: number } {
  const full = { x: 0, y: 0, width: containerWidth, height: containerHeight };
  if (resizeMode === 'cover') return full;
  if (!(containerWidth > 0) || !(containerHeight > 0) || !(bufferWidth > 0) || !(bufferHeight > 0)) {
    return full;
  }

  const scale = Math.min(containerWidth / bufferWidth, containerHeight / bufferHeight);
  const w = bufferWidth * scale;
  const h = bufferHeight * scale;
  return { x: (containerWidth - w) / 2, y: (containerHeight - h) / 2, width: w, height: h };
}

/**
 * The cutout rectangle in VIEW space, normalised against the view's own size.
 *
 * The cutout is horizontally centred, sized by `widthPercent`, and its height
 * follows from `aspectRatio`. If the resulting height would overflow the view,
 * it is clamped and the width recomputed so the aspect ratio is preserved.
 */
export function computeViewRect(
  region: ResolvedScanRegion,
  viewWidth: number,
  viewHeight: number,
): NormalizedRect | null {
  if (!(viewWidth > 0) || !(viewHeight > 0)) return null;

  let wPx = viewWidth * region.widthPercent;
  let hPx = wPx / region.aspectRatio;

  const maxH = viewHeight * 0.9;
  if (hPx > maxH) {
    hPx = maxH;
    wPx = hPx * region.aspectRatio;
  }

  const w = wPx / viewWidth;
  const h = hPx / viewHeight;
  const x = (1 - w) / 2;

  let y = region.verticalCenter - h / 2;
  // Keep the cutout fully on screen.
  if (y < 0) y = 0;
  if (y + h > 1) y = 1 - h;

  return { x, y, width: w, height: h };
}

/**
 * Maps a view-space rect through the preview's fit mode into buffer space.
 *
 * With `cover` the buffer is scaled to fill the view and the overflow is
 * centre-cropped, so only part of the buffer is visible: a rect at view
 * coordinate 0 actually starts partway into the buffer. With `contain` the
 * whole buffer is visible and this is the identity.
 *
 * `bufferWidth`/`bufferHeight` must be the buffer dims AS DISPLAYED (i.e.
 * already rotated upright), not the raw sensor dims.
 */
export function viewRectToPreviewRect(
  rect: NormalizedRect,
  viewWidth: number,
  viewHeight: number,
  bufferWidth: number,
  bufferHeight: number,
  resizeMode: 'cover' | 'contain',
): NormalizedRect {
  if (resizeMode === 'contain') return rect;
  if (!(viewWidth > 0) || !(viewHeight > 0) || !(bufferWidth > 0) || !(bufferHeight > 0)) {
    return rect;
  }

  const scale = Math.max(viewWidth / bufferWidth, viewHeight / bufferHeight);
  const visW = viewWidth / (bufferWidth * scale);
  const visH = viewHeight / (bufferHeight * scale);
  const offsetX = (1 - visW) / 2;
  const offsetY = (1 - visH) / 2;

  return {
    x: offsetX + rect.x * visW,
    y: offsetY + rect.y * visH,
    width: rect.width * visW,
    height: rect.height * visH,
  };
}

/**
 * Rotates an upright-preview rect into raw buffer space.
 *
 * `rotationDegrees` is the clockwise rotation that must be applied to the
 * buffer to make it appear upright, so mapping a rect the other way applies
 * the inverse. For 90°, `bx = py` and `by = 1 - px - ph` — note the axis swap:
 * a wide-short screen rect becomes a narrow-tall buffer rect.
 *
 * Pass 0 on platforms where the JPEG is already written upright (iOS bakes the
 * rotation into the pixels before cropping).
 */
export function previewRectToBufferRect(rect: NormalizedRect, rotationDegrees: number): NormalizedRect {
  const r = ((rotationDegrees % 360) + 360) % 360;
  switch (r) {
    case 90:
      return { x: rect.y, y: 1 - rect.x - rect.width, width: rect.height, height: rect.width };
    case 180:
      return {
        x: 1 - rect.x - rect.width,
        y: 1 - rect.y - rect.height,
        width: rect.width,
        height: rect.height,
      };
    case 270:
      return { x: 1 - rect.y - rect.height, y: rect.x, width: rect.height, height: rect.width };
    default:
      return rect;
  }
}

/** Clamps a rect into 0..1, returning null if nothing usable remains. */
export function clampRect(rect: NormalizedRect): NormalizedRect | null {
  const x = Math.max(0, Math.min(1, rect.x));
  const y = Math.max(0, Math.min(1, rect.y));
  const right = Math.max(0, Math.min(1, rect.x + rect.width));
  const bottom = Math.max(0, Math.min(1, rect.y + rect.height));
  const width = right - x;
  const height = bottom - y;
  if (!(width > 0) || !(height > 0)) return null;
  return { x, y, width, height };
}

/**
 * Full view→buffer pipeline. Returns null when the inputs are not yet usable
 * (e.g. the view has not been measured), in which case the caller must skip
 * cropping rather than crop against a zero or stale size.
 */
export function computeCropRect(params: {
  region: ResolvedScanRegion;
  viewWidth: number;
  viewHeight: number;
  bufferWidth: number;
  bufferHeight: number;
  resizeMode: 'cover' | 'contain';
  rotationDegrees: number;
}): NormalizedRect | null {
  const { region, viewWidth, viewHeight, bufferWidth, bufferHeight, resizeMode, rotationDegrees } = params;
  if (!region.enabled) return null;

  const viewRect = computeViewRect(region, viewWidth, viewHeight);
  if (viewRect == null) return null;

  const previewRect = viewRectToPreviewRect(
    viewRect,
    viewWidth,
    viewHeight,
    bufferWidth,
    bufferHeight,
    resizeMode,
  );
  return clampRect(previewRectToBufferRect(previewRect, rotationDegrees));
}
