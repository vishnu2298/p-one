import React, { useEffect, useState } from 'react';
import { Linking, Platform, Pressable, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { api } from '../api';
import { Pill, Txt } from '../ui';
import { colors, radius, shadow } from '../theme';

export type Ad = { id: number; title: string; body: string; ctaLabel: string; listingId: number | null; hasLink: boolean; brand: { id: number; name: string } };

/** Loads sponsored cards once per mount. Failures are silent: an ad slot should never break a screen. */
export function useAds(placement: 'home' | 'deals') {
  const [ads, setAds] = useState<Ad[]>([]);
  useEffect(() => {
    let live = true;
    api<{ ads: Ad[] }>(`/ads?placement=${placement}`).then((r) => live && setAds(r.ads)).catch(() => {});
    return () => { live = false; };
  }, [placement]);
  return ads;
}

/** Always labelled "Sponsored". Calm styling so it reads as a suggestion, not a shout. */
export function SponsoredCard({ ad }: { ad: Ad }) {
  const nav = useNavigation<any>();
  const open = async () => {
    try {
      const r = await api<{ listingId: number | null; url: string | null }>(`/ads/${ad.id}/click`, { method: 'POST' });
      if (r.listingId) nav.navigate('ItemDetails', { id: r.listingId });
      else if (r.url) { if (Platform.OS === 'web') window.open(r.url, '_blank', 'noopener'); else await Linking.openURL(r.url); }
    } catch { /* offer ended: nothing to open */ }
  };
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={`Sponsored by ${ad.brand.name}. ${ad.title}`} onPress={open}
      style={({ pressed }) => ({ backgroundColor: '#FFF8EC', borderRadius: radius.lg, padding: 16, gap: 8, borderWidth: 1, borderColor: '#F2DFB8', transform: [{ scale: pressed ? 0.985 : 1 }], ...shadow })}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <Pill text="Sponsored" color={colors.warn} bg="#FBE9BE" />
        <Txt variant="small" color={colors.sub} numberOfLines={1} style={{ flex: 1 }}>{ad.brand.name}</Txt>
      </View>
      <Txt variant="h2">{ad.title}</Txt>
      {ad.body ? <Txt color={colors.sub}>{ad.body}</Txt> : null}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 4 }}>
        <Txt bold color={colors.sell}>{ad.ctaLabel}</Txt><Ionicons name="arrow-forward" size={20} color={colors.sell} />
      </View>
    </Pressable>
  );
}
