import React from 'react';
import { StyleSheet, Text, View, type LayoutChangeEvent, type StyleProp, type TextStyle } from 'react-native';
import {
  computePreviewBox,
  computeViewRect,
  resolveScanRegion,
  type ScanRegionOptions,
} from '../scanRegion';

export interface ScanRegionOverlayProps {
  options?: ScanRegionOptions;
  /** Called with the view size so the caller can compute the crop rect. */
  onLayoutSize?: (width: number, height: number) => void;
  hintTextStyle?: StyleProp<TextStyle>;
  /**
   * Buffer dimensions as displayed (portrait: short side first) and the fit
   * mode, so the overlay can align itself to the letterboxed preview rather
   * than to its container. Without these the cutout is drawn against the
   * container and its brackets land in the letterbox bars.
   */
  bufferWidth?: number;
  bufferHeight?: number;
  resizeMode?: 'cover' | 'contain';
}

/**
 * Dims the camera preview except for a card-shaped cutout, and draws corner
 * brackets around it so the user knows where to place the card.
 *
 * The dim is drawn as four solid views around the cutout rather than as a
 * masked overlay — that keeps the cutout genuinely transparent without pulling
 * in a masking library or an SVG dependency.
 *
 * Purely presentational: `pointerEvents="none"` throughout so taps still reach
 * the camera (tap-to-focus, and the reload button beneath).
 */
export function ScanRegionOverlay(props: Readonly<ScanRegionOverlayProps>) {
  const region = resolveScanRegion(props.options);
  const [size, setSize] = React.useState<{ width: number; height: number } | null>(null);

  const handleLayout = (e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    if (width > 0 && height > 0) {
      setSize((prev) =>
        prev?.width === width && prev?.height === height ? prev : { width, height },
      );
      // Report the PREVIEW box, not the container. The crop transform treats
      // the reported size as the visible video, so under 'contain' handing it
      // the container would make the crop rect a fraction too wide.
      const box = computePreviewBox(
        width,
        height,
        props.bufferWidth ?? 0,
        props.bufferHeight ?? 0,
        props.resizeMode ?? 'cover',
      );
      props.onLayoutSize?.(box.width, box.height);
    }
  };

  if (!region.enabled) {
    return <View style={StyleSheet.absoluteFill} pointerEvents="none" onLayout={handleLayout} />;
  }

  // Align to the letterboxed preview, not the container. Under `contain` the
  // video occupies only part of the container, so a cutout sized against the
  // container would put its corner brackets in the black bars.
  const preview =
    size == null
      ? null
      : computePreviewBox(
          size.width,
          size.height,
          props.bufferWidth ?? 0,
          props.bufferHeight ?? 0,
          props.resizeMode ?? 'cover',
        );

  const rectNorm = preview == null ? null : computeViewRect(region, preview.width, preview.height);

  // Convert the dim opacity into an rgba colour. See the note below on why the
  // panels cannot simply carry an `opacity` prop.
  const dimAlpha = Math.max(0, Math.min(1, region.dimOpacity));
  const dimColor = `rgba(0,0,0,${dimAlpha})`;
  const previewW = preview == null ? 0 : Math.ceil(preview.width + (preview.x - Math.floor(preview.x)));
  const previewH = preview == null ? 0 : Math.ceil(preview.height + (preview.y - Math.floor(preview.y)));

  // Convert to ROUNDED PIXELS before laying anything out. Percentage positions
  // land on fractional pixels, which is what produced the visible seams.
  const rect =
    rectNorm == null || preview == null
      ? null
      : {
          left: Math.round(rectNorm.x * preview.width),
          top: Math.round(rectNorm.y * preview.height),
          width: Math.round(rectNorm.width * preview.width),
          height: Math.round(rectNorm.height * preview.height),
        };

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none" onLayout={handleLayout}>
      {rect != null && preview != null && (
        <View
          style={{
            position: 'absolute',
            // Round the preview box OUTWARD (floor the origin, ceil the size).
            // Rounding to nearest could shrink it by a fraction of a pixel and
            // leave a sliver of undimmed container showing down the left or top
            // edge — the thin line reported on the non-document scanners.
            left: Math.floor(preview.x),
            top: Math.floor(preview.y),
            width: Math.ceil(preview.width + (preview.x - Math.floor(preview.x))),
            height: Math.ceil(preview.height + (preview.y - Math.floor(preview.y))),
          }}
        >
          {/* Dim as a single view whose BORDERS do the shading.
              Tiling four separate panels cannot win: abutting them leaves a
              light hairline under sub-pixel rounding, and overlapping them
              stacks alpha into a dark one. One view sized to the cutout, with
              borders thick enough to reach the preview edges, has no interior
              seams at all — the browser/native layer draws the border as a
              single region. */}
          <View
            style={{
              position: 'absolute',
              left: 0,
              top: 0,
              right: 0,
              bottom: 0,
              borderColor: dimColor,
              borderTopWidth: rect.top,
              borderBottomWidth: Math.max(0, previewH - rect.top - rect.height),
              borderLeftWidth: rect.left,
              borderRightWidth: Math.max(0, previewW - rect.left - rect.width),
            }}
          />

          {/* Corner brackets, sharp to match the dim's hard 90-degree corners. */}
          <View
            style={{
              position: 'absolute',
              left: rect.left,
              top: rect.top,
              width: rect.width,
              height: rect.height,
            }}
          >
            {/* Each bracket draws only the two edges adjacent to its corner. */}
            <View
              style={[
                styles.corner,
                {
                  width: region.cornerLength,
                  height: region.cornerLength,
                  borderColor: region.cornerColor,
                  top: 0,
                  left: 0,
                  borderTopWidth: region.cornerWidth,
                  borderLeftWidth: region.cornerWidth,
                  borderTopLeftRadius: region.borderRadius,
                },
              ]}
            />
            <View
              style={[
                styles.corner,
                {
                  width: region.cornerLength,
                  height: region.cornerLength,
                  borderColor: region.cornerColor,
                  top: 0,
                  right: 0,
                  borderTopWidth: region.cornerWidth,
                  borderRightWidth: region.cornerWidth,
                  borderTopRightRadius: region.borderRadius,
                },
              ]}
            />
            <View
              style={[
                styles.corner,
                {
                  width: region.cornerLength,
                  height: region.cornerLength,
                  borderColor: region.cornerColor,
                  bottom: 0,
                  left: 0,
                  borderBottomWidth: region.cornerWidth,
                  borderLeftWidth: region.cornerWidth,
                  borderBottomLeftRadius: region.borderRadius,
                },
              ]}
            />
            <View
              style={[
                styles.corner,
                {
                  width: region.cornerLength,
                  height: region.cornerLength,
                  borderColor: region.cornerColor,
                  bottom: 0,
                  right: 0,
                  borderBottomWidth: region.cornerWidth,
                  borderRightWidth: region.cornerWidth,
                  borderBottomRightRadius: region.borderRadius,
                },
              ]}
            />
          </View>

          {region.hintText.length > 0 && (
            <View
              style={[styles.hintWrap, { bottom: preview.height - rect.top + 10 }]}
              pointerEvents="none"
            >
              <Text style={[styles.hint, props.hintTextStyle]}>{region.hintText}</Text>
            </View>
          )}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  dim: { position: 'absolute' },
  corner: { position: 'absolute' },
  hintWrap: { position: 'absolute', left: 0, right: 0, alignItems: 'center' },
  hint: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
    textShadowColor: 'rgba(0,0,0,0.75)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },
});
