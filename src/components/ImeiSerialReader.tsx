import React from 'react';
import { ActivityIndicator, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { Camera } from 'react-native-vision-camera';
import { CAPTURE_MODE } from '../captureMode';
import { useImeiSerialReader } from '../hooks/useImeiSerialReader';
import type { Frame, ParserConfig } from '../types';
import type { DocumentFields } from '../parsers/types';
import { ReloadButton } from './ReloadButton';
import { ScanRegionOverlay } from './ScanRegionOverlay';
import type { ScanRegionOptions } from '../scanRegion';

export interface ImeiSerialReaderProps {
  parserConfig: ParserConfig;
  /**
   * Fired once a parser matches. `fields` carries the named breakdown for
   * document readers (PAN, …) and is absent for the simple string readers.
   */
  onDone: (values: string[], frame?: Frame, fields?: DocumentFields) => void;
  onCameraReload?: () => void;
  onError?: (error: Error) => void;
  captureFrame?: boolean;
  hideReloadButton?: boolean;
  reloadLabel?: string;
  style?: StyleProp<ViewStyle>;
  /**
   * The card-shaped cutout, which crops the frame to it before OCR.
   *
   * ON BY DEFAULT for every reader type — pass `{ enabled: false }` to scan the
   * full frame instead. Override any field to restyle it; `hintText` sets the
   * message shown above the cutout.
   */
  scanRegion?: ScanRegionOptions;
  /**
   * Convenience shortcut for `scanRegion.hintText`. Ignored if `scanRegion`
   * already sets `hintText`.
   */
  hintText?: string;
  /** Overrides the preview fit mode. Defaults to 'contain' when a scan region is active. */
  resizeMode?: 'cover' | 'contain';
}

export function ImeiSerialReader(props: ImeiSerialReaderProps) {
  // The scan region is on by default for every reader — a tighter region keeps
  // background text out of the OCR input, which helps IMEI and serial reads as
  // much as document ones. `{ enabled: false }` opts out.
  const scanRegion = React.useMemo<ScanRegionOptions>(() => {
    const base = props.scanRegion ?? {};
    return props.hintText != null && base.hintText == null
      ? { ...base, hintText: props.hintText }
      : base;
  }, [props.scanRegion, props.hintText]);

  const {
    cameraRef,
    isActive,
    reload,
    error,
    device,
    format,
    hasPermission,
    frameProcessor,
    onCameraLayout,
    resizeMode,
  } = useImeiSerialReader({
    parserConfig: props.parserConfig,
    onDone: props.onDone,
    onError: props.onError,
    captureFrame: props.captureFrame,
    scanRegion,
    resizeMode: props.resizeMode,
  });

  if (!hasPermission) {
    return (
      <View style={[styles.fill, styles.centered, props.style]}>
        <Text style={styles.message}>Camera permission required</Text>
      </View>
    );
  }
  if (device == null) {
    return (
      <View style={[styles.fill, styles.centered, props.style]}>
        <ActivityIndicator />
      </View>
    );
  }
  if (error != null) {
    return (
      <View style={[styles.fill, styles.centered, props.style]}>
        <Text style={styles.message}>{error.message}</Text>
      </View>
    );
  }

  return (
    <View style={[styles.fill, props.style]}>
      <Camera
        ref={cameraRef}
        style={StyleSheet.absoluteFill}
        device={device}
        format={format}
        isActive={isActive}
        photo={CAPTURE_MODE === 'take-photo' && !!props.captureFrame}
        photoQualityBalance="speed"
        resizeMode={resizeMode}
        frameProcessor={frameProcessor}
      />
      {scanRegion.enabled !== false && (
        <ScanRegionOverlay
          options={scanRegion}
          onLayoutSize={onCameraLayout}
          // Buffer dims as displayed (portrait: short side first) so the
          // overlay can align to the letterboxed preview under 'contain'
          // instead of to its container.
          bufferWidth={
            format != null ? Math.min(format.videoWidth, format.videoHeight) : undefined
          }
          bufferHeight={
            format != null ? Math.max(format.videoWidth, format.videoHeight) : undefined
          }
          resizeMode={resizeMode}
        />
      )}
      {!props.hideReloadButton && (
        <ReloadButton
          label={props.reloadLabel ?? 'Reload Camera'}
          onPress={() => {
            reload();
            props.onCameraReload?.();
          }}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: '#000' },
  centered: { alignItems: 'center', justifyContent: 'center' },
  message: { color: '#fff', fontSize: 14 },
});
