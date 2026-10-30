import React, { useCallback, useEffect, useState } from 'react';
import { View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { api, money, storage } from './api';
import { Button, Card, Empty, ErrorState, Header, Screen, SkeletonRows, Txt } from './ui';
import { colors } from './theme';

export type Business = {
  id: number; name: string; category: string; city: string; address: string; description: string; gstin: string; phone: string; public_slug: string;
  role: string; permissions: string[]; storefront_enabled: number; verified: number;
};

/** Paise → "₹1,234.50". Money is stored as integer paise everywhere on the server. */
export const rs = (paise: number | null | undefined) => {
  const v = (paise || 0) / 100;
  return '₹' + v.toLocaleString('en-IN', { minimumFractionDigits: Number.isInteger(v) ? 0 : 2, maximumFractionDigits: 2 });
};
/** "12.5" → 1250. Returns NaN for empty/invalid text so callers can validate. */
export const toPaise = (s: string) => (s.trim() === '' ? NaN : Math.round(Number(s.replace(/,/g, '')) * 100));
export const newKey = (p: string) => `${p}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
export const bizPath = (id: number, p: string) => `/api/v1/businesses/${id}${p}`;
export const day = (iso: string) => (iso || '').slice(0, 10);
export const fmtDate = (ms: number) => new Date(ms).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
export const fmtLeft = (ms: number) => {
  if (ms <= 0) return '0s';
  const s = Math.floor(ms / 1000), d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60);
  return d ? `${d}d ${h}h` : h ? `${h}h ${m}m` : m ? `${m}m ${s % 60}s` : `${s}s`;
};

// Which workspace is open is remembered between launches and shared by every business screen.
let currentId: number | null = null;
const listeners = new Set<() => void>();
export const selectBusiness = (id: number) => { currentId = id; void storage.set('biz.current', String(id)); listeners.forEach((l) => l()); };

export function useBiz() {
  const [list, setList] = useState<Business[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [, bump] = useState(0);
  useEffect(() => { const l = () => bump((n) => n + 1); listeners.add(l); return () => { listeners.delete(l); }; }, []);
  const load = useCallback(async () => {
    try {
      const r = await api<{ businesses: Business[] }>('/api/v1/me/businesses');
      if (currentId === null) { const s = await storage.get('biz.current'); if (s) currentId = Number(s); }
      setList(r.businesses); setError(null);
    } catch (e: any) { setError(e.message); }
  }, []);
  useFocusEffect(useCallback(() => { void load(); }, [load]));
  const current = list?.find((b) => b.id === currentId) || list?.[0] || null;
  const can = (perm: string) => !!current?.permissions.includes(perm);
  return { list, current, error, can, reload: load, loading: list === null && !error };
}

/** Wraps a business screen: loading / no business / error states, then renders children with the active business. */
export function BizScreen({ title, children, footer, right, refresh, need }: {
  title: string; children: (b: Business, can: (p: string) => boolean) => React.ReactNode; footer?: React.ReactNode; right?: React.ReactNode;
  refresh?: { refreshing: boolean; onRefresh: () => void }; need?: string;
}) {
  const biz = useBiz();
  const b = biz.current;
  if (biz.loading) return <Screen header={<Header title={title} />}><SkeletonRows /></Screen>;
  if (biz.error && !b) return <Screen header={<Header title={title} />}><ErrorState message={biz.error} retry={biz.reload} /></Screen>;
  if (!b) return <Screen header={<Header title={title} />}><Empty icon="storefront" title="No business yet" text="Create one to start selling and tracking stock." /></Screen>;
  if (need && !biz.can(need)) return <Screen header={<Header title={title} />}><Empty icon="lock-closed" title="Not available for your role" text={`You are signed in as ${b.role}. Ask the owner if you need this.`} /></Screen>;
  return <Screen header={<Header title={title} subtitle={b.name} right={right} />} footer={footer} refresh={refresh}>{children(b, biz.can)}</Screen>;
}

export function Kpi({ label, value, tone }: { label: string; value: string; tone?: 'good' | 'bad' }) {
  return (
    <Card style={{ flex: 1, minWidth: 150, gap: 2 }}>
      <Txt variant="small" color={colors.sub}>{label}</Txt>
      <Txt variant="h2" color={tone === 'bad' ? colors.danger : tone === 'good' ? colors.buy : colors.text}>{value}</Txt>
    </Card>
  );
}

export function Line({ label, value, bold, color }: { label: string; value: string; bold?: boolean; color?: string }) {
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 6, gap: 12 }}>
      <Txt bold={bold} style={{ flex: 1 }}>{label}</Txt><Txt bold={bold} color={color}>{value}</Txt>
    </View>
  );
}

export { money, Button };
