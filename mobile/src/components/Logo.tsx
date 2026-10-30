import React from 'react';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { colors } from '../theme';

// Brand mark: people in a soft indigo-to-violet tile.
export function Logo({ size = 72 }: { size?: number }) {
  return (
    <LinearGradient accessibilityLabel="Connectly logo" colors={[colors.primary, colors.accent]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
      style={{ width: size, height: size, borderRadius: size * 0.32, alignItems: 'center', justifyContent: 'center', boxShadow: `0px ${size * 0.14}px ${size * 0.34}px rgba(79,70,229,0.38)` } as any}>
      <Ionicons name="people" size={size * 0.56} color="#fff" />
    </LinearGradient>
  );
}
