import React from 'react';
import { Image, Pressable, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Listing } from '../types';
import { catById } from '../categories';
import { colors, radius, shadow } from '../theme';
import { Txt } from '../ui';
import { imageUrl, money } from '../api';

export function ListingImage({ listing, height, iconSize = 48 }: { listing: Pick<Listing, 'images' | 'category' | 'title'>; height: number; iconSize?: number }) {
  const cat = catById(listing.category);
  const uri = imageUrl(listing.images[0]);
  if (uri) return <Image source={{ uri }} accessibilityLabel={listing.title} style={{ width: '100%', height, backgroundColor: cat.bg }} resizeMode="cover" />;
  return (
    <View accessibilityLabel={`${listing.title} (no photo)`} style={{ width: '100%', height, backgroundColor: cat.bg, alignItems: 'center', justifyContent: 'center' }}>
      <Ionicons name={cat.icon as any} size={iconSize} color={cat.color} />
    </View>
  );
}

export function ListingCard({ listing, onPress, onToggleFav, width }: { listing: Listing; onPress: () => void; onToggleFav?: (l: Listing) => void; width?: number | string }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={`${listing.title}, ${money(listing.price)}`} onPress={onPress}
      style={({ pressed }) => ({ width: width as any, backgroundColor: '#fff', borderRadius: radius.lg, overflow: 'hidden', opacity: pressed ? 0.92 : 1, ...shadow })}>
      <View>
        <ListingImage listing={listing} height={130} />
        {listing.status === 'sold' ? (
          <View style={{ position: 'absolute', left: 8, top: 8, backgroundColor: colors.text, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 4 }}><Txt variant="tiny" bold color="#fff">SOLD</Txt></View>
        ) : null}
        {onToggleFav ? (
          <Pressable accessibilityRole="button" accessibilityLabel={listing.isFavorite ? 'Remove from saved' : 'Save this item'} onPress={() => onToggleFav(listing)} hitSlop={6}
            style={{ position: 'absolute', right: 6, top: 6, width: 48, height: 48, borderRadius: 24, backgroundColor: 'rgba(255,255,255,0.95)', alignItems: 'center', justifyContent: 'center' }}>
            <Ionicons name={listing.isFavorite ? 'heart' : 'heart-outline'} size={26} color={listing.isFavorite ? colors.danger : colors.text} />
          </Pressable>
        ) : null}
      </View>
      <View style={{ padding: 12, gap: 2 }}>
        <Txt bold numberOfLines={2} style={{ minHeight: 46 }}>{listing.title}</Txt>
        <Txt variant="h2" color={colors.primary}>{money(listing.price)}</Txt>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
          <Ionicons name="location" size={15} color={colors.sub} />
          <Txt variant="tiny" color={colors.sub} style={{ flex: 1 }}>{listing.city}{listing.distanceKm != null ? ` · ${listing.distanceKm} km` : ''}</Txt>
        </View>
      </View>
    </Pressable>
  );
}

// Two-column grid that works inside a ScrollView on every platform.
export function ListingGrid({ items, onOpen, onToggleFav }: { items: Listing[]; onOpen: (l: Listing) => void; onToggleFav?: (l: Listing) => void }) {
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12 }}>
      {items.map((l) => (
        <View key={l.id} style={{ width: '47.5%', flexGrow: 1, flexBasis: '45%' }}>
          <ListingCard listing={l} onPress={() => onOpen(l)} onToggleFav={onToggleFav} />
        </View>
      ))}
    </View>
  );
}

// Shared optimistic favourite toggle.
import { api } from '../api';
export async function toggleFavorite(l: Listing, apply: (next: Listing) => void) {
  const next = { ...l, isFavorite: !l.isFavorite };
  apply(next);
  try { await api(`/listings/${l.id}/favorite`, { method: l.isFavorite ? 'DELETE' : 'POST' }); } catch { apply(l); }
}
