import React, { useMemo, useState } from 'react';
import { Backdrop } from './Backdrop';
import { Modal, Pressable, ScrollView, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Location from 'expo-location';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { CITY_LIST } from '../categories';
import { colors, radius, space } from '../theme';
import { Button, Txt, notify } from '../ui';
import { useSettings } from '../context';
import { translate } from '../i18n';

const km = (a: number, b: number, c: number, d: number) => {
  const r = (x: number) => (x * Math.PI) / 180;
  const h = Math.sin(r(c - a) / 2) ** 2 + Math.cos(r(a)) * Math.cos(r(c)) * Math.sin(r(d - b) / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(h));
};

/** A big tappable field that opens a searchable list of Indian cities, with "Use my location". */
export function CityField({ value, onChange, label, anywhere }: { value?: string; onChange: (city: string | undefined, coords?: { lat: number; lng: number }) => void; label?: string; anywhere?: boolean }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [locating, setLocating] = useState(false);
  const insets = useSafeAreaInsets();
  const { scale } = useSettings();
  const current = CITY_LIST.find((c) => c.name === value);
  const shown = useMemo(() => {
    const t = q.trim().toLowerCase();
    return CITY_LIST.filter((c) => !t || c.name.toLowerCase().includes(t) || c.state.toLowerCase().includes(t));
  }, [q]);

  const pick = (city: string | undefined, coords?: { lat: number; lng: number }) => { onChange(city, coords); setOpen(false); setQ(''); };
  const locate = async () => {
    setLocating(true);
    try {
      const perm = await Location.requestForegroundPermissionsAsync();
      if (!perm.granted) { notify('Location not allowed', 'Please allow location access, or choose your city from the list.'); return; }
      const pos = await Location.getCurrentPositionAsync({});
      const { latitude: lat, longitude: lng } = pos.coords;
      const nearest = CITY_LIST.reduce((best, c) => (km(lat, lng, c.lat, c.lng) < km(lat, lng, best.lat, best.lng) ? c : best));
      pick(nearest.name, { lat, lng });
    } catch { notify('Could not get your location', 'Please choose your city from the list.'); } finally { setLocating(false); }
  };

  return (
    <View style={{ marginBottom: space.lg }}>
      {label ? <Txt bold style={{ marginBottom: 6 }}>{label}</Txt> : null}
      <Pressable accessibilityRole="button" accessibilityLabel={`${label || 'City'}: ${value || 'not chosen'}. Tap to change`} onPress={() => setOpen(true)}
        style={{ minHeight: 56, borderWidth: 2, borderColor: colors.line, borderRadius: radius.md, backgroundColor: colors.glass, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, gap: 10 }}>
        <Ionicons name="location" size={24} color={colors.primary} />
        <View style={{ flex: 1 }}>
          <Txt bold>{current ? current.name : value || translate(anywhere ? 'Anywhere' : 'Choose your city')}</Txt>
          {current ? <Txt variant="tiny" color={colors.sub}>{current.state}</Txt> : null}
        </View>
        <Ionicons name="chevron-down" size={22} color={colors.sub} />
      </Pressable>

      <Modal visible={open} animationType="slide" onRequestClose={() => setOpen(false)}>
        <View style={{ flex: 1, paddingTop: insets.top }}>
          <Backdrop />
          <View style={{ flexDirection: 'row', alignItems: 'center', padding: space.lg, gap: 8 }}>
            <Txt variant="h2" style={{ flex: 1 }}>Choose your city</Txt>
            <Pressable accessibilityRole="button" accessibilityLabel="Close" onPress={() => setOpen(false)} style={{ width: 48, height: 48, alignItems: 'center', justifyContent: 'center' }}><Ionicons name="close" size={30} color={colors.text} /></Pressable>
          </View>
          <View style={{ paddingHorizontal: space.lg, gap: 10 }}>
            <Button title="Use my location" icon="navigate" variant="light" onPress={locate} loading={locating} />
            <TextInput accessibilityLabel="Search city or state" autoFocus value={q} onChangeText={setQ} placeholder={translate('Search city or state…')} placeholderTextColor="#7A8794"
              style={{ minHeight: 56, borderWidth: 2, borderColor: colors.line, borderRadius: radius.pill, paddingHorizontal: 18, fontSize: 18 * scale, backgroundColor: colors.glass, color: colors.text }} />
          </View>
          <ScrollView contentContainerStyle={{ padding: space.lg, paddingBottom: insets.bottom + 24, gap: 8 }} keyboardShouldPersistTaps="handled">
            {anywhere ? <Row label={translate('Anywhere')} selected={!value} onPress={() => pick(undefined)} /> : null}
            {shown.map((c) => <Row key={c.name} label={c.name} sub={c.state} selected={c.name === value} onPress={() => pick(c.name)} />)}
            {!shown.length ? <Txt color={colors.sub}>No city found. Try another spelling.</Txt> : null}
          </ScrollView>
        </View>
      </Modal>
    </View>
  );
}

const Row = ({ label, sub, selected, onPress }: { label: string; sub?: string; selected?: boolean; onPress: () => void }) => (
  <Pressable accessibilityRole="button" accessibilityState={{ selected: !!selected }} onPress={onPress}
    style={{ minHeight: 60, flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: colors.glass, borderRadius: radius.md, paddingHorizontal: 16, borderWidth: 2, borderColor: selected ? colors.primary : 'transparent' }}>
    <View style={{ flex: 1 }}><Txt bold>{label}</Txt>{sub ? <Txt variant="small" color={colors.sub}>{sub}</Txt> : null}</View>
    {selected ? <Ionicons name="checkmark-circle" size={26} color={colors.primary} /> : null}
  </Pressable>
);
