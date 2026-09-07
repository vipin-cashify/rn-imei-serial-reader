import React from 'react';
import { ActivityIndicator, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { Camera } from 'react-native-vision-camera';
import { useImeiSerialReader } from '../hooks/useImeiSerialReader';
import type { DocumentFields } from '../parsers/types';
import type { ScanRegionOptions } from '../scanRegion';
import type { Frame, ParserConfig } from '../types';
import { ReloadButton } from './ReloadButton';
import { ScanRegionOverlay } from './ScanRegionOverlay';

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
  const scanRegion = React.useMemo<ScanRegionOptions>(() => {
    const base = props.scanRegion ?? {};
    return props.hintText != null && base.hintText == null ? { ...base, hintText: props.hintText } : base;
  }, [props.scanRegion, props.hintText]);

  const {
    cameraRef,
    isActive,
    reload,
    error,
    device,
    outputs,
    bufferSize,
    hasPermission,
    onCameraLayout,
    onCameraStarted,
    onCameraError,
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
        isActive={isActive}
        outputs={outputs}
        // The crop rect and the overlay both live in INTERFACE space. VC5
        // defaults to 'device', which rotates the analysis stream whenever the
        // operator tilts a portrait-locked phone — the cutout would then no
        // longer match what is analysed.
        orientationSource="interface"
        resizeMode={resizeMode}
        onStarted={onCameraStarted}
        onError={onCameraError}
      />
      {scanRegion.enabled !== false && (
        <ScanRegionOverlay
          options={scanRegion}
          onLayoutSize={onCameraLayout}
          bufferWidth={bufferSize.width}
          bufferHeight={bufferSize.height}
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
