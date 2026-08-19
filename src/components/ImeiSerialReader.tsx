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
   * Shows a card-shaped cutout and crops the frame to it before OCR. Pass `{}`
   * for the ID-1 (credit-card / PAN / Aadhaar) defaults, or override any field.
   * Omit entirely to scan the full frame as before.
   */
  scanRegion?: ScanRegionOptions;
  /** Overrides the preview fit mode. Defaults to 'contain' when scanRegion is set. */
  resizeMode?: 'cover' | 'contain';
}

export function ImeiSerialReader(props: ImeiSerialReaderProps) {
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
    scanRegion: props.scanRegion,
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
      {props.scanRegion != null && (
        <ScanRegionOverlay
          options={props.scanRegion}
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
