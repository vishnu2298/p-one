import React from 'react';
import { View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '../theme';

// Brand mark: three people (Buy, Sell, Connect) in a rounded badge.
export function Logo({ size = 72 }: { size?: number }) {
  return (
    <View accessibilityLabel="Connectly logo" style={{ width: size, height: size, borderRadius: size * 0.3, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' }}>
      <Ionicons name="people" size={size * 0.6} color="#fff" />
    </View>
  );
}
