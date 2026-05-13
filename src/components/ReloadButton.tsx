import React from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';

export interface ReloadButtonProps {
  label: string;
  onPress: () => void;
}

export function ReloadButton({ label, onPress }: ReloadButtonProps) {
  return (
    <View style={styles.container} pointerEvents="box-none">
      <Pressable onPress={onPress} style={styles.button} hitSlop={16}>
        <Image source={require('../../assets/ic_camera.png')} style={styles.icon} />
        <Text style={styles.label}>{label}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    right: 16,
    bottom: 16,
  },
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: 'rgba(0,0,0,0.55)',
    borderRadius: 20,
  },
  icon: {
    width: 20,
    height: 20,
    marginRight: 8,
    tintColor: '#fff',
  },
  label: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
});
