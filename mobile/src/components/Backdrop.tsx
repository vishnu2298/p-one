import React from 'react';
import { StyleSheet, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { BlurView } from 'expo-blur';

/**
 * Soft aurora behind the whole app: a pale gradient with three colour blobs, blurred into mist.
 * It is static (no animation), so it costs almost nothing, and every screen is transparent so it shows through.
 */
export function Backdrop() {
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      <LinearGradient colors={['#ECEEFF', '#F7F2FC', '#E9F6F4']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />
      <View style={{ position: 'absolute', top: -90, left: -70, width: 320, height: 320, borderRadius: 160, backgroundColor: '#8F92FF', opacity: 0.55 }} />
      <View style={{ position: 'absolute', top: 240, right: -130, width: 360, height: 360, borderRadius: 180, backgroundColor: '#FFB8D8', opacity: 0.42 }} />
      <View style={{ position: 'absolute', bottom: -110, left: -50, width: 340, height: 340, borderRadius: 170, backgroundColor: '#86E1D0', opacity: 0.45 }} />
      <BlurView intensity={80} tint="light" experimentalBlurMethod="dimezisBlurView" style={StyleSheet.absoluteFill} />
    </View>
  );
}
