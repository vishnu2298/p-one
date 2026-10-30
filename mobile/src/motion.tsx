// Motion kit. Everything animates opacity/transform only (GPU friendly on budget phones) and
// switches off when the phone's "reduce motion" setting is on.
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, Easing, LayoutChangeEvent, Platform, Pressable, StyleProp, View, ViewStyle } from 'react-native';
import * as Haptics from 'expo-haptics';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { colors, radius, shadow } from './theme';
import { Txt, IconName } from './ui';
import { Logo } from './components/Logo';

const native = Platform.OS !== 'web';

/* ---------- Haptics (tiny, native only) ---------- */
export const haptic = {
  tap: () => { if (native) void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {}); },
  success: () => { if (native) void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {}); },
  warn: () => { if (native) void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {}); },
};

/* ---------- Reduced motion ---------- */
let reduced = false;
AccessibilityInfo.isReduceMotionEnabled().then((v) => { reduced = v; }).catch(() => {});
AccessibilityInfo.addEventListener?.('reduceMotionChanged', (v: boolean) => { reduced = v; });
export const reduceMotion = () => reduced;

/** Springy scale "pop" whenever `trigger` changes (e.g. a heart being tapped). */
export function Pop({ trigger, children, style }: { trigger: unknown; children: React.ReactNode; style?: StyleProp<ViewStyle> }) {
  const v = useRef(new Animated.Value(1)).current;
  const first = useRef(true);
  useEffect(() => {
    if (first.current) { first.current = false; return; }
    if (reduced) return;
    v.setValue(0.6);
    Animated.spring(v, { toValue: 1, friction: 4, tension: 160, useNativeDriver: native }).start();
  }, [trigger, v]);
  return <Animated.View style={[{ transform: [{ scale: v }] }, style]}>{children}</Animated.View>;
}

/** Colourful confetti burst from the top. Set `run` to true to fire it. */
const PIECES = 30;
const CONFETTI = ['#1747C6', '#12794A', '#C2410C', '#F5A623', '#BE185D', '#7E22CE'];
export function Confetti({ run, onDone }: { run: boolean; onDone?: () => void }) {
  const items = useMemo(() => Array.from({ length: PIECES }, (_, i) => ({
    x: Math.random() * 100, size: 8 + Math.random() * 8, color: CONFETTI[i % CONFETTI.length], delay: Math.random() * 350,
    drift: (Math.random() - 0.5) * 120, spin: (Math.random() > 0.5 ? 1 : -1) * (360 + Math.random() * 360), dur: 1500 + Math.random() * 900, round: Math.random() > 0.5,
  })), []);
  const anims = useRef(items.map(() => new Animated.Value(0))).current;
  const [live, setLive] = useState(false);
  useEffect(() => {
    if (!run || reduced) { if (run) onDone?.(); return; }
    setLive(true);
    anims.forEach((a) => a.setValue(0));
    Animated.parallel(anims.map((a, i) => Animated.timing(a, { toValue: 1, duration: items[i].dur, delay: items[i].delay, easing: Easing.out(Easing.quad), useNativeDriver: native }))).start(() => { setLive(false); onDone?.(); });
  }, [run]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!live) return null;
  return (
    <View pointerEvents="none" style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, overflow: 'hidden', zIndex: 50 }}>
      {items.map((p, i) => (
        <Animated.View key={i} style={{
          position: 'absolute', top: -20, left: `${p.x}%`, width: p.size, height: p.round ? p.size : p.size * 1.6, borderRadius: p.round ? p.size / 2 : 2, backgroundColor: p.color,
          opacity: anims[i].interpolate({ inputRange: [0, 0.1, 0.85, 1], outputRange: [0, 1, 1, 0] }),
          transform: [
            { translateY: anims[i].interpolate({ inputRange: [0, 1], outputRange: [0, 620] }) },
            { translateX: anims[i].interpolate({ inputRange: [0, 1], outputRange: [0, p.drift] }) },
            { rotate: anims[i].interpolate({ inputRange: [0, 1], outputRange: ['0deg', `${p.spin}deg`] }) },
          ],
        }} />
      ))}
    </View>
  );
}

/** Tabs with a pill that slides to the chosen option. */
export function Segmented<T extends string>({ options, value, onChange }: { options: { id: T; label: string }[]; value: T; onChange: (id: T) => void }) {
  const [w, setW] = useState(0);
  const x = useRef(new Animated.Value(0)).current;
  const idx = Math.max(0, options.findIndex((o) => o.id === value));
  const seg = w ? (w - 8) / options.length : 0;
  useEffect(() => {
    if (!seg) return;
    if (reduced) x.setValue(idx * seg);
    else Animated.spring(x, { toValue: idx * seg, friction: 9, tension: 120, useNativeDriver: native }).start();
  }, [idx, seg, x]);
  return (
    <View onLayout={(e: LayoutChangeEvent) => setW(e.nativeEvent.layout.width)} accessibilityRole="tablist" style={{ flexDirection: 'row', backgroundColor: 'rgba(16,18,31,0.06)', borderRadius: 20, padding: 4, marginBottom: 14 }}>
      {seg ? <Animated.View style={{ position: 'absolute', top: 4, left: 4, width: seg, height: 52, borderRadius: 16, backgroundColor: 'rgba(255,255,255,0.95)', transform: [{ translateX: x }], ...shadow }} /> : null}
      {options.map((o) => (
        <Pressable key={o.id} accessibilityRole="tab" accessibilityState={{ selected: o.id === value }} onPress={() => { if (o.id !== value) { haptic.tap(); onChange(o.id); } }} style={{ flex: 1, minHeight: 52, borderRadius: 16, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4 }}>
          <Txt bold center color={o.id === value ? colors.primary : colors.sub} numberOfLines={2}>{o.label}</Txt>
        </Pressable>
      ))}
    </View>
  );
}

/** Cycles through hints with a soft cross-fade (for the search bar). */
export function useRotating(list: string[], ms = 3200) {
  const [i, setI] = useState(0);
  const v = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    if (reduced || list.length < 2) return;
    const t = setInterval(() => {
      Animated.timing(v, { toValue: 0, duration: 220, useNativeDriver: native }).start(() => {
        setI((n) => (n + 1) % list.length);
        Animated.timing(v, { toValue: 1, duration: 260, useNativeDriver: native }).start();
      });
    }, ms);
    return () => clearInterval(t);
  }, [list.length, ms, v]);
  return { text: list[i % list.length], style: { opacity: v, transform: [{ translateY: v.interpolate({ inputRange: [0, 1], outputRange: [6, 0] }) }] } };
}

/** Auto-advancing banner with gradient slides and dots. */
export type HeroSlide = { id: string; title: string; text: string; icon: IconName; colors: [string, string]; cta: string; onPress: () => void };
export function Hero({ slides }: { slides: HeroSlide[] }) {
  const [i, setI] = useState(0);
  const v = useRef(new Animated.Value(1)).current;
  const go = (n: number) => {
    if (reduced) { setI(n); return; }
    Animated.timing(v, { toValue: 0, duration: 180, useNativeDriver: native }).start(() => { setI(n); Animated.timing(v, { toValue: 1, duration: 280, easing: Easing.out(Easing.cubic), useNativeDriver: native }).start(); });
  };
  useEffect(() => {
    if (slides.length < 2) return;
    const t = setInterval(() => go((i + 1) % slides.length), 5200);
    return () => clearInterval(t);
  }); // re-armed on every render so the index stays current
  const s = slides[i % slides.length];
  return (
    <View>
      <Pressable accessibilityRole="button" accessibilityLabel={`${s.title}. ${s.text}`} onPress={() => { haptic.tap(); s.onPress(); }} style={({ pressed }) => ({ transform: [{ scale: pressed ? 0.985 : 1 }] })}>
        <LinearGradient colors={s.colors} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ borderRadius: 32, padding: 22, minHeight: 156, overflow: 'hidden', boxShadow: '0px 16px 36px rgba(79,70,229,0.25)' } as any}>
          <Ionicons name={s.icon} size={150} color="rgba(255,255,255,0.16)" style={{ position: 'absolute', right: -20, bottom: -26 }} />
          <Animated.View style={{ opacity: v, transform: [{ translateY: v.interpolate({ inputRange: [0, 1], outputRange: [10, 0] }) }], gap: 6, maxWidth: '78%' }}>
            <Txt variant="h2" color="#fff">{s.title}</Txt>
            <Txt color="rgba(255,255,255,0.94)">{s.text}</Txt>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: 'rgba(255,255,255,0.24)', alignSelf: 'flex-start', borderRadius: 999, paddingVertical: 8, paddingHorizontal: 14, marginTop: 6 }}>
              <Txt bold color="#fff">{s.cta}</Txt><Ionicons name="arrow-forward" size={18} color="#fff" />
            </View>
          </Animated.View>
        </LinearGradient>
      </Pressable>
      <View style={{ flexDirection: 'row', justifyContent: 'center', gap: 6, marginTop: 10 }}>
        {slides.map((x, k) => <Pressable key={x.id} accessibilityRole="button" accessibilityLabel={`Slide ${k + 1}`} hitSlop={8} onPress={() => go(k)}><View style={{ width: k === i ? 22 : 8, height: 8, borderRadius: 4, backgroundColor: k === i ? colors.primary : colors.line }} /></Pressable>)}
      </View>
    </View>
  );
}

/** Branded splash: logo springs in, a ring pulses, tagline fades up. */
export function AnimatedSplash() {
  const logo = useRef(new Animated.Value(0)).current;
  const ring = useRef(new Animated.Value(0)).current;
  const text = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.parallel([
      Animated.spring(logo, { toValue: 1, friction: 5, tension: 70, useNativeDriver: native }),
      Animated.sequence([Animated.delay(250), Animated.timing(text, { toValue: 1, duration: 500, useNativeDriver: native })]),
      Animated.loop(Animated.timing(ring, { toValue: 1, duration: 1600, easing: Easing.out(Easing.ease), useNativeDriver: native })),
    ]).start();
  }, [logo, ring, text]);
  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 18 }}>
      <View style={{ alignItems: 'center', justifyContent: 'center' }}>
        <Animated.View style={{ position: 'absolute', width: 120, height: 120, borderRadius: 60, borderWidth: 3, borderColor: colors.primary, opacity: ring.interpolate({ inputRange: [0, 1], outputRange: [0.5, 0] }), transform: [{ scale: ring.interpolate({ inputRange: [0, 1], outputRange: [0.8, 1.9] }) }] }} />
        <Animated.View style={{ transform: [{ scale: logo }], opacity: logo }}><Logo size={104} /></Animated.View>
      </View>
      <Animated.View style={{ opacity: text, transform: [{ translateY: text.interpolate({ inputRange: [0, 1], outputRange: [12, 0] }) }], alignItems: 'center', gap: 4 }}>
        <Txt variant="hero" color={colors.primary}>Connectly</Txt>
        <Txt color={colors.sub}>Buy  •  Sell  •  Connect</Txt>
      </Animated.View>
    </View>
  );
}

/** Slides in from the top when the phone has no internet, and leaves by itself when it is back. */
import { onNetChange, isOnline, api as _api } from './api';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
export function OfflineBanner() {
  const [off, setOff] = useState(!isOnline());
  const insets = useSafeAreaInsets();
  const v = useRef(new Animated.Value(0)).current;
  useEffect(() => onNetChange((o) => setOff(!o)), []);
  useEffect(() => { Animated.timing(v, { toValue: off ? 1 : 0, duration: 260, easing: Easing.out(Easing.cubic), useNativeDriver: native }).start(); }, [off, v]);
  // While offline, quietly probe so the banner clears as soon as the connection returns.
  useEffect(() => {
    if (!off) return;
    const t = setInterval(() => { void _api('/health').catch(() => {}); }, 4000);
    return () => clearInterval(t);
  }, [off]);
  return (
    <Animated.View pointerEvents="none" accessibilityLiveRegion="polite" style={{ position: 'absolute', top: 0, left: 0, right: 0, zIndex: 100, opacity: v, transform: [{ translateY: v.interpolate({ inputRange: [0, 1], outputRange: [-80, 0] }) }] }}>
      <View style={{ backgroundColor: '#1F2A37', paddingTop: insets.top + 8, paddingBottom: 10, paddingHorizontal: 16, flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <Ionicons name="cloud-offline" size={22} color="#FCD34D" />
        <Txt color="#fff" bold style={{ flex: 1 }}>You're offline</Txt>
        <Txt variant="small" color="#D1D5DB">Waiting for internet…</Txt>
      </View>
    </Animated.View>
  );
}
