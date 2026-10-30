import React, { useState } from 'react';
import { Image, Linking, Platform, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { api, money } from '../api';
import { Button, Pill, Stars, Txt, notify } from '../ui';
import { colors, radius, shadow } from '../theme';
import { Product } from '../types';

/** Creates a tracked click on the server, then opens the merchant (with our affiliate tag) in the browser. */
export async function openDeal(p: Product) {
  try {
    const r = await api<{ url: string }>('/affiliate/click', { method: 'POST', body: { productId: p.id } });
    if (Platform.OS === 'web') window.open(r.url, '_blank', 'noopener');
    else await Linking.openURL(r.url);
  } catch (e: any) { notify('Could not open this deal', e.message); }
}

export function DealCard({ p, width }: { p: Product; width?: number }) {
  const [busy, setBusy] = useState(false);
  const go = async () => { setBusy(true); await openDeal(p); setBusy(false); };
  return (
    <View style={{ width, backgroundColor: '#fff', borderRadius: radius.lg, overflow: 'hidden', ...shadow }}>
      <View style={{ height: 130, backgroundColor: '#F1F4F8', alignItems: 'center', justifyContent: 'center' }}>
        {p.image ? <Image source={{ uri: p.image }} accessibilityLabel={p.title} style={{ width: '100%', height: '100%' }} resizeMode="contain" /> : <Ionicons name="bag-handle" size={48} color={colors.sub} />}
        <View style={{ position: 'absolute', left: 8, top: 8 }}><Pill text="Ad" color={colors.sub} bg="#fff" /></View>
      </View>
      <View style={{ padding: 12, gap: 4 }}>
        <Txt variant="tiny" color={colors.sub} numberOfLines={1}>{p.merchant || 'Online store'}</Txt>
        <Txt bold numberOfLines={2} style={{ minHeight: 46 }}>{p.title}</Txt>
        <Txt variant="h2" color={colors.primary}>{money(p.price)}</Txt>
        {p.rating ? <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}><Stars rating={p.rating} size={15} /><Txt variant="tiny" color={colors.sub}>{p.reviews ? `(${p.reviews.toLocaleString('en-IN')})` : ''}</Txt></View> : null}
        <Button compact title="View deal" icon="open-outline" variant="buy" onPress={go} loading={busy} style={{ marginTop: 6 }} />
      </View>
    </View>
  );
}

export const DISCLOSURE = 'Connectly may earn a commission when you buy through these links. It does not change the price you pay.';
