import React, { useEffect, useState } from 'react';
import { Image, KeyboardAvoidingView, Platform, Pressable, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { useNavigation, useRoute } from '@react-navigation/native';
import { api, imageUrl, money } from '../api';
import { Button, Chip, Header, Input, Loading, Screen, Txt, notify, toast } from '../ui';
import { colors, radius, space } from '../theme';
import { CATEGORIES, CITIES, CONDITIONS } from '../categories';
import { Listing } from '../types';
import { useAuth } from '../context';

const MAX_PHOTOS = 5;

export function SellItem() {
  const nav = useNavigation<any>();
  const editId = (useRoute().params as any)?.id as number | undefined;
  const { user } = useAuth();
  const [loading, setLoading] = useState(!!editId);
  const [images, setImages] = useState<string[]>([]);
  const [uploading, setUploading] = useState(0);
  const [f, setF] = useState({ title: '', category: '', price: '', condition: 'Good', description: '', brand: '', city: user?.city || 'Chennai' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [hint, setHint] = useState<{ low: number; high: number; median: number } | null>(null);
  const set = (k: keyof typeof f) => (v: string) => { setF((p) => ({ ...p, [k]: v })); setErrors((e) => ({ ...e, [k]: '' })); };

  useEffect(() => {
    if (!editId) return;
    api<{ listing: Listing }>(`/listings/${editId}`).then(({ listing: l }) => {
      setF({ title: l.title, category: l.category, price: String(l.price), condition: l.condition, description: l.description, brand: l.brand, city: l.city });
      setImages(l.images);
    }).catch((e) => { notify('Could not load item', e.message); nav.goBack(); }).finally(() => setLoading(false));
  }, [editId, nav]);

  // Price guidance from the Python insights service.
  useEffect(() => {
    if (!f.category) { setHint(null); return; }
    let live = true;
    api<any>(`/listings-price-hint?category=${f.category}&title=${encodeURIComponent(f.title)}`).then((h) => live && setHint(h.available ? h : null)).catch(() => live && setHint(null));
    return () => { live = false; };
  }, [f.category]); // eslint-disable-line react-hooks/exhaustive-deps

  const upload = async (assets: ImagePicker.ImagePickerAsset[]) => {
    for (const a of assets.slice(0, MAX_PHOTOS - images.length)) {
      if (!a.base64) continue;
      setUploading((n) => n + 1);
      try {
        const r = await api<{ url: string }>('/uploads', { method: 'POST', body: { data: a.base64, mime: a.mimeType || 'image/jpeg' } });
        setImages((p) => [...p, r.url].slice(0, MAX_PHOTOS));
      } catch (e: any) { notify('Photo not added', e.message); } finally { setUploading((n) => n - 1); }
    }
  };
  const pick = async () => {
    const r = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsMultipleSelection: true, selectionLimit: MAX_PHOTOS - images.length, base64: true, quality: 0.5 });
    if (!r.canceled) await upload(r.assets);
  };
  const snap = async () => {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) { notify('Camera not allowed', 'Please allow camera access in your phone settings, or choose a photo from your gallery.'); return; }
    const r = await ImagePicker.launchCameraAsync({ base64: true, quality: 0.5 });
    if (!r.canceled) await upload(r.assets);
  };

  const submit = async () => {
    const e: Record<string, string> = {};
    if (f.title.trim().length < 3) e.title = 'Please enter a title (at least 3 letters)';
    if (!f.category) e.category = 'Please choose a category';
    const price = Number(f.price.replace(/,/g, ''));
    if (!f.price.trim() || !Number.isFinite(price) || price < 0) e.price = 'Please enter a price in rupees';
    setErrors(e);
    if (Object.keys(e).length) return;
    setBusy(true);
    try {
      const body = { ...f, title: f.title.trim(), price, images };
      const r = editId ? await api<{ listing: Listing }>(`/listings/${editId}`, { method: 'PATCH', body }) : await api<{ listing: Listing }>('/listings', { method: 'POST', body });
      if (editId) nav.goBack(); else nav.replace('ItemDetails', { id: r.listing.id });
      toast(editId ? 'Changes saved' : 'Your item is live. People nearby can see it now.');
    } catch (err: any) { notify('Could not list item', err.message); } finally { setBusy(false); }
  };

  if (loading) return <Screen scroll={false} header={<Header title="Edit item" />}><Loading /></Screen>;
  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <Screen header={<Header title={editId ? 'Edit item' : 'Sell an item'} />} footer={<Button title={editId ? 'Save changes' : 'List item'} icon="checkmark-circle" variant="sell" onPress={submit} loading={busy} disabled={uploading > 0} />}>
        <Txt bold style={{ marginBottom: 8 }}>Photos <Txt color={colors.sub}>(up to {MAX_PHOTOS})</Txt></Txt>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 20 }}>
          {images.map((u) => (
            <View key={u}>
              <Image source={{ uri: imageUrl(u) }} style={{ width: 96, height: 96, borderRadius: 14 }} accessibilityLabel="Item photo" />
              <Pressable accessibilityRole="button" accessibilityLabel="Remove photo" onPress={() => setImages(images.filter((x) => x !== u))} style={{ position: 'absolute', top: -8, right: -8, width: 36, height: 36, borderRadius: 18, backgroundColor: colors.danger, alignItems: 'center', justifyContent: 'center' }}><Ionicons name="close" size={22} color="#fff" /></Pressable>
            </View>
          ))}
          {uploading > 0 ? <View style={{ width: 96, height: 96, borderRadius: 14, backgroundColor: colors.primarySoft, alignItems: 'center', justifyContent: 'center' }}><Txt variant="tiny" color={colors.primary} bold>Adding…</Txt></View> : null}
          {images.length < MAX_PHOTOS ? <>
            <AddBtn icon="images" label="Gallery" onPress={pick} />
            {Platform.OS !== 'web' ? <AddBtn icon="camera" label="Camera" onPress={snap} /> : null}
          </> : null}
        </View>

        <Input label="What are you selling?" value={f.title} onChangeText={set('title')} error={errors.title} placeholder="e.g. iPhone 15, 128 GB" maxLength={100} />

        <Txt bold style={{ marginBottom: 8 }}>Category</Txt>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
          {CATEGORIES.map((c) => <Chip key={c.id} icon={c.icon as any} label={c.name} selected={f.category === c.id} onPress={() => set('category')(c.id)} />)}
        </View>
        {errors.category ? <Txt variant="small" color={colors.danger} style={{ marginBottom: 8 }}>{errors.category}</Txt> : <View style={{ height: 8 }} />}

        <Input label="Price (₹)" value={f.price} onChangeText={(v) => set('price')(v.replace(/[^0-9]/g, ''))} error={errors.price} keyboardType="number-pad" placeholder="e.g. 5000" />
        {hint ? (
          <Pressable accessibilityRole="button" onPress={() => set('price')(String(hint.median))} style={{ backgroundColor: colors.primarySoft, borderRadius: radius.md, padding: 12, marginTop: -6, marginBottom: 16, flexDirection: 'row', gap: 10, alignItems: 'center' }}>
            <Ionicons name="bulb" size={26} color={colors.primary} />
            <Txt variant="small" style={{ flex: 1 }}>Similar items usually sell for <Txt variant="small" bold>{money(hint.low)} – {money(hint.high)}</Txt>. Tap to use {money(hint.median)}.</Txt>
          </Pressable>
        ) : null}

        <Txt bold style={{ marginBottom: 8 }}>Condition</Txt>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginBottom: 8 }}>{CONDITIONS.map((c) => <Chip key={c} label={c} selected={f.condition === c} onPress={() => set('condition')(c)} />)}</View>

        <Input label="Brand (optional)" value={f.brand} onChangeText={set('brand')} placeholder="e.g. Apple" />
        <Input label="Description" value={f.description} onChangeText={set('description')} multiline placeholder="Age, condition, what is included…" maxLength={2000} />

        <Txt bold style={{ marginBottom: 8 }}>Location</Txt>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>{CITIES.map((c) => <Chip key={c} icon="location" label={c} selected={f.city === c} onPress={() => set('city')(c)} />)}</View>
        <Txt variant="small" color={colors.sub}>Only your city is shown, never your exact address.</Txt>
      </Screen>
    </KeyboardAvoidingView>
  );
}

const AddBtn = ({ icon, label, onPress }: { icon: any; label: string; onPress: () => void }) => (
  <Pressable accessibilityRole="button" accessibilityLabel={`Add photo from ${label}`} onPress={onPress} style={{ width: 96, height: 96, borderRadius: 14, borderWidth: 2, borderStyle: 'dashed', borderColor: colors.primary, backgroundColor: colors.primarySoft, alignItems: 'center', justifyContent: 'center', gap: 4 }}>
    <Ionicons name={icon} size={30} color={colors.primary} /><Txt variant="tiny" bold color={colors.primary}>{label}</Txt>
  </Pressable>
);
