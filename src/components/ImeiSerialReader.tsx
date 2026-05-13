import React from 'react';
import { ActivityIndicator, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { Camera } from 'react-native-vision-camera';
import { useImeiSerialReader } from '../hooks/useImeiSerialReader';
import type { Frame, ParserConfig } from '../types';
import { ReloadButton } from './ReloadButton';

export interface ImeiSerialReaderProps {
  parserConfig: ParserConfig;
  onDone: (values: string[], frame?: Frame) => void;
  onCameraReload?: () => void;
  onError?: (error: Error) => void;
  captureFrame?: boolean;
  hideReloadButton?: boolean;
  reloadLabel?: string;
  style?: StyleProp<ViewStyle>;
}

export function ImeiSerialReader(props: ImeiSerialReaderProps) {
  const {
    cameraRef,
    isActive,
    reload,
    error,
    device,
    hasPermission,
    frameProcessor,
  } = useImeiSerialReader({
    parserConfig: props.parserConfig,
    onDone: props.onDone,
    onError: props.onError,
    captureFrame: props.captureFrame,
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

  console.log(
    `[IMEI-Reader] component render isActive=${isActive} device=${device.id} photo=${!!props.captureFrame}`,
  );

  return (
    <View style={[styles.fill, props.style]}>
      <Camera
        ref={cameraRef}
        style={StyleSheet.absoluteFill}
        device={device}
        isActive={isActive}
        photo={!!props.captureFrame}
        frameProcessor={frameProcessor}
        onInitialized={() => console.log('[IMEI-Reader] Camera onInitialized')}
        onStarted={() => console.log('[IMEI-Reader] Camera onStarted')}
        onStopped={() => console.log('[IMEI-Reader] Camera onStopped')}
        onError={(e) =>
          console.log(
            `[IMEI-Reader] Camera onError code=${e.code} message=${e.message} cause=${JSON.stringify(e.cause)}`,
          )
        }
      />
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
