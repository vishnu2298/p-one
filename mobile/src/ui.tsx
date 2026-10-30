import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator, Alert, Animated, Easing, Image, Platform, Pressable, RefreshControl, ScrollView, StyleProp, StyleSheet, Text, TextInput, TextInputProps, TextProps, TextStyle, View, ViewStyle,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { colors, radius, shadow, space, TAP } from './theme';
import { useSettings } from './context';
import { imageUrl } from './api';

export type IconName = React.ComponentProps<typeof Ionicons>['name'];

/* ---------- Text (all text goes through here so the text-size setting applies everywhere) ---------- */
const SIZES = { hero: 34, title: 28, h2: 22, body: 18, small: 16, tiny: 14 } as const;
type Variant = keyof typeof SIZES;
export function Txt({ variant = 'body', color = colors.text, bold, center, style, ...rest }: TextProps & { variant?: Variant; color?: string; bold?: boolean; center?: boolean }) {
  const { scale } = useSettings();
  const size = SIZES[variant] * scale;
  const weight: TextStyle['fontWeight'] = bold || variant === 'hero' || variant === 'title' || variant === 'h2' ? '700' : '400';
  return <Text maxFontSizeMultiplier={1.2} {...rest} style={[{ fontSize: size, lineHeight: Math.round(size * 1.3), color, fontWeight: weight, textAlign: center ? 'center' : undefined }, style]} />;
}

/* ---------- Buttons ---------- */
type BtnVariant = 'primary' | 'secondary' | 'buy' | 'sell' | 'danger' | 'ghost' | 'light';
const BTN: Record<BtnVariant, { bg: string; fg: string; border?: string }> = {
  primary: { bg: colors.primary, fg: '#fff' },
  secondary: { bg: '#fff', fg: colors.primary, border: colors.primary },
  buy: { bg: colors.buy, fg: '#fff' },
  sell: { bg: colors.sell, fg: '#fff' },
  danger: { bg: colors.danger, fg: '#fff' },
  ghost: { bg: 'transparent', fg: colors.primary },
  light: { bg: colors.primarySoft, fg: colors.primary },
};
export function Button({ title, onPress, variant = 'primary', icon, loading, disabled, style, compact }: {
  title: string; onPress: () => void; variant?: BtnVariant; icon?: IconName; loading?: boolean; disabled?: boolean; style?: StyleProp<ViewStyle>; compact?: boolean;
}) {
  const v = BTN[variant];
  const off = disabled || loading;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityState={{ disabled: !!off }}
      onPress={off ? undefined : onPress}
      style={({ pressed }) => [
        { minHeight: compact ? 48 : TAP, borderRadius: radius.md, backgroundColor: v.bg, borderWidth: v.border ? 2 : 0, borderColor: v.border, paddingHorizontal: space.lg, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 8, opacity: off ? 0.5 : pressed ? 0.9 : 1, transform: [{ scale: pressed && !off ? 0.97 : 1 }] },
        style,
      ]}
    >
      {loading ? <ActivityIndicator color={v.fg} /> : <>
        {icon ? <Ionicons name={icon} size={22} color={v.fg} /> : null}
        <Txt bold color={v.fg} style={{ fontSize: undefined }}>{title}</Txt>
      </>}
    </Pressable>
  );
}

export function Input({ label, error, hint, style, ...props }: TextInputProps & { label?: string; error?: string | null; hint?: string }) {
  const { scale } = useSettings();
  return (
    <View style={{ marginBottom: space.lg }}>
      {label ? <Txt bold style={{ marginBottom: 6 }}>{label}</Txt> : null}
      <TextInput
        accessibilityLabel={label}
        placeholderTextColor="#7A8794"
        {...props}
        style={[{ minHeight: TAP, borderWidth: 2, borderColor: error ? colors.danger : colors.line, borderRadius: radius.md, paddingHorizontal: space.lg, paddingVertical: 12, fontSize: 18 * scale, color: colors.text, backgroundColor: '#fff' }, props.multiline && { minHeight: 120, textAlignVertical: 'top' }, style]}
      />
      {hint && !error ? <Txt variant="small" color={colors.sub} style={{ marginTop: 4 }}>{hint}</Txt> : null}
      {error ? <Txt variant="small" color={colors.danger} style={{ marginTop: 4 }}>{error}</Txt> : null}
    </View>
  );
}

export function Chip({ label, selected, onPress, icon }: { label: string; selected?: boolean; onPress?: () => void; icon?: IconName }) {
  return (
    <Pressable accessibilityRole="button" accessibilityState={{ selected: !!selected }} onPress={onPress}
      style={{ minHeight: 48, paddingHorizontal: 16, borderRadius: radius.pill, backgroundColor: selected ? colors.primary : '#fff', borderWidth: 2, borderColor: selected ? colors.primary : colors.line, flexDirection: 'row', alignItems: 'center', gap: 6, marginRight: 8, marginBottom: 8 }}>
      {icon ? <Ionicons name={icon} size={18} color={selected ? '#fff' : colors.text} /> : null}
      <Txt variant="small" bold color={selected ? '#fff' : colors.text}>{label}</Txt>
    </Pressable>
  );
}

const AV_COLORS = ['#1747C6', '#12794A', '#C2410C', '#7E22CE', '#0E7490', '#BE185D'];
export function Avatar({ name, size = 52, uri }: { name: string; size?: number; uri?: string }) {
  const bg = AV_COLORS[(name.charCodeAt(0) + name.length) % AV_COLORS.length];
  if (uri) return <Image source={{ uri: imageUrl(uri) }} style={{ width: size, height: size, borderRadius: size / 2 }} />;
  return (
    <View accessibilityLabel={name} style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: bg, alignItems: 'center', justifyContent: 'center' }}>
      <Text style={{ color: '#fff', fontWeight: '700', fontSize: size * 0.42 }}>{name.trim().charAt(0).toUpperCase()}</Text>
    </View>
  );
}

export function Card({ children, style, onPress, accessibilityLabel }: { children: React.ReactNode; style?: StyleProp<ViewStyle>; onPress?: () => void; accessibilityLabel?: string }) {
  const base: ViewStyle = { backgroundColor: colors.card, borderRadius: radius.lg, padding: space.lg, ...shadow };
  if (!onPress) return <View style={[base, style]}>{children}</View>;
  return <Pressable accessibilityRole="button" accessibilityLabel={accessibilityLabel} onPress={onPress} style={({ pressed }) => [base, style, pressed && { opacity: 0.92, transform: [{ scale: 0.985 }] }]}>{children}</Pressable>;
}

export function Stars({ rating, size = 18 }: { rating: number; size?: number }) {
  return (
    <View style={{ flexDirection: 'row' }} accessibilityLabel={`${rating} out of 5 stars`}>
      {[1, 2, 3, 4, 5].map((i) => <Ionicons key={i} name={rating >= i - 0.25 ? 'star' : rating >= i - 0.75 ? 'star-half' : 'star-outline'} size={size} color={colors.star} />)}
    </View>
  );
}

export function Pill({ text, color = colors.primary, bg = colors.primarySoft, icon }: { text: string; color?: string; bg?: string; icon?: IconName }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: bg, borderRadius: radius.pill, paddingHorizontal: 10, paddingVertical: 4, alignSelf: 'flex-start' }}>
      {icon ? <Ionicons name={icon} size={14} color={color} /> : null}
      <Txt variant="tiny" bold color={color}>{text}</Txt>
    </View>
  );
}

export function Loading({ text }: { text?: string }) {
  return <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: space.xl, gap: 12 }}><ActivityIndicator size="large" color={colors.primary} />{text ? <Txt color={colors.sub}>{text}</Txt> : null}</View>;
}

export function Empty({ icon, title, text, action }: { icon: IconName; title: string; text?: string; action?: { title: string; onPress: () => void } }) {
  return (
    <View style={{ alignItems: 'center', padding: space.xxl, gap: 10 }}>
      <View style={{ width: 84, height: 84, borderRadius: 42, backgroundColor: colors.primarySoft, alignItems: 'center', justifyContent: 'center' }}><Ionicons name={icon} size={40} color={colors.primary} /></View>
      <Txt variant="h2" center>{title}</Txt>
      {text ? <Txt color={colors.sub} center>{text}</Txt> : null}
      {action ? <Button title={action.title} onPress={action.onPress} style={{ marginTop: 8, alignSelf: 'stretch' }} /> : null}
    </View>
  );
}

export function ErrorState({ message, retry }: { message: string; retry?: () => void }) {
  return <Empty icon="cloud-offline" title="Something went wrong" text={message} action={retry ? { title: 'Try again', onPress: retry } : undefined} />;
}

/* ---------- Screen chrome ---------- */
export function Header({ title, back = true, right, subtitle }: { title: string; back?: boolean; right?: React.ReactNode; subtitle?: string }) {
  const nav = useNavigation();
  const insets = useSafeAreaInsets();
  return (
    <View style={{ paddingTop: insets.top + 6, paddingBottom: 10, paddingHorizontal: space.md, backgroundColor: '#fff', borderBottomWidth: 1, borderBottomColor: colors.line, flexDirection: 'row', alignItems: 'center', minHeight: 64 + insets.top }}>
      {back && nav.canGoBack() ? (
        <Pressable accessibilityRole="button" accessibilityLabel="Go back" onPress={() => nav.goBack()} style={{ minHeight: 48, minWidth: 48, flexDirection: 'row', alignItems: 'center', paddingRight: 8 }}>
          <Ionicons name="chevron-back" size={30} color={colors.primary} />
        </Pressable>
      ) : <View style={{ width: 8 }} />}
      <View style={{ flex: 1 }}>
        <Txt variant="h2" numberOfLines={1} accessibilityRole="header">{title}</Txt>
        {subtitle ? <Txt variant="tiny" color={colors.sub} numberOfLines={1}>{subtitle}</Txt> : null}
      </View>
      {right}
    </View>
  );
}

export function Screen({ children, scroll = true, header, footer, refresh, contentStyle }: {
  children: React.ReactNode; scroll?: boolean; header?: React.ReactNode; footer?: React.ReactNode;
  refresh?: { refreshing: boolean; onRefresh: () => void }; contentStyle?: StyleProp<ViewStyle>;
}) {
  const insets = useSafeAreaInsets();
  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      {header}
      {scroll ? (
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={[{ padding: space.lg, paddingBottom: footer ? space.lg : insets.bottom + space.xxl }, contentStyle]}
          {...(refresh ? { refreshControl: <RefreshControl refreshing={refresh.refreshing} onRefresh={refresh.onRefresh} tintColor={colors.primary} /> } : {})}>
          {children}
        </ScrollView>
      ) : <View style={[{ flex: 1 }, contentStyle]}>{children}</View>}
      {footer ? <View style={{ padding: space.lg, paddingBottom: insets.bottom + space.md, backgroundColor: '#fff', borderTopWidth: 1, borderTopColor: colors.line }}>{footer}</View> : null}
    </View>
  );
}

export function SectionTitle({ title, action, onAction }: { title: string; action?: string; onAction?: () => void }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: space.xl, marginBottom: space.md }}>
      <Txt variant="h2">{title}</Txt>
      {action ? <Pressable accessibilityRole="button" onPress={onAction} hitSlop={10} style={{ minHeight: 44, justifyContent: 'center' }}><Txt bold color={colors.primary}>{action}</Txt></Pressable> : null}
    </View>
  );
}

export function Row({ icon, label, value, onPress, color, danger }: { icon: IconName; label: string; value?: string; onPress?: () => void; color?: string; danger?: boolean }) {
  const c = danger ? colors.danger : color || colors.primary;
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} style={({ pressed }) => ({ minHeight: 64, flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 10, opacity: pressed ? 0.7 : 1 })}>
      <View style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: danger ? colors.dangerSoft : colors.primarySoft, alignItems: 'center', justifyContent: 'center' }}><Ionicons name={icon} size={24} color={c} /></View>
      <View style={{ flex: 1 }}>
        <Txt bold color={danger ? colors.danger : colors.text}>{label}</Txt>
        {value ? <Txt variant="small" color={colors.sub}>{value}</Txt> : null}
      </View>
      {onPress ? <Ionicons name="chevron-forward" size={24} color={colors.sub} /> : null}
    </Pressable>
  );
}

/* ---------- Dialogs (Alert.alert is a no-op on web, so provide cross-platform helpers) ---------- */
export function notify(title: string, message?: string) {
  if (Platform.OS === 'web') { window.alert(message ? `${title}\n\n${message}` : title); return; }
  Alert.alert(title, message);
}
export function confirmDialog(title: string, message: string, okText = 'Yes', destructive = false): Promise<boolean> {
  if (Platform.OS === 'web') return Promise.resolve(window.confirm(`${title}\n\n${message}`));
  return new Promise((resolve) => Alert.alert(title, message, [
    { text: 'No', style: 'cancel', onPress: () => resolve(false) },
    { text: okText, style: destructive ? 'destructive' : 'default', onPress: () => resolve(true) },
  ], { cancelable: true, onDismiss: () => resolve(false) }));
}

export const styles = StyleSheet.create({ rowGap: { flexDirection: 'row', alignItems: 'center', gap: 8 } });


/* ---------- Smoothness: skeleton loaders, entrance animation, toasts ---------- */
// One shared pulse drives every skeleton on screen, so shimmer stays in sync and cheap.
const pulse = new Animated.Value(0);
let pulseUsers = 0;
let pulseLoop: Animated.CompositeAnimation | null = null;
function usePulse() {
  useEffect(() => {
    if (pulseUsers++ === 0) {
      pulseLoop = Animated.loop(Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 900, easing: Easing.inOut(Easing.ease), useNativeDriver: Platform.OS !== 'web' }),
        Animated.timing(pulse, { toValue: 0, duration: 900, easing: Easing.inOut(Easing.ease), useNativeDriver: Platform.OS !== 'web' }),
      ]));
      pulseLoop.start();
    }
    return () => { if (--pulseUsers === 0) { pulseLoop?.stop(); pulse.setValue(0); } };
  }, []);
  return pulse.interpolate({ inputRange: [0, 1], outputRange: [0.45, 1] });
}

/** A soft pulsing placeholder block. */
export function Skeleton({ width = '100%', height = 16, radius: r = 10, style }: { width?: number | string; height?: number; radius?: number; style?: StyleProp<ViewStyle> }) {
  const opacity = usePulse();
  return <Animated.View accessibilityElementsHidden importantForAccessibility="no" style={[{ width: width as any, height, borderRadius: r, backgroundColor: '#E6E1D8', opacity }, style]} />;
}

export function SkeletonCardGrid({ count = 4 }: { count?: number }) {
  return (
    <View accessibilityLabel="Loading" accessibilityLiveRegion="polite" style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12 }}>
      {Array.from({ length: count }, (_, i) => (
        <View key={i} style={{ width: '47.5%', flexGrow: 1, flexBasis: '45%', backgroundColor: '#fff', borderRadius: radius.lg, overflow: 'hidden' }}>
          <Skeleton height={130} radius={0} />
          <View style={{ padding: 12, gap: 8 }}><Skeleton height={16} /><Skeleton width="60%" height={20} /><Skeleton width="40%" height={12} /></View>
        </View>
      ))}
    </View>
  );
}

export function SkeletonRows({ count = 4, avatar = true }: { count?: number; avatar?: boolean }) {
  return (
    <View accessibilityLabel="Loading" accessibilityLiveRegion="polite" style={{ gap: 10 }}>
      {Array.from({ length: count }, (_, i) => (
        <View key={i} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: '#fff', borderRadius: radius.lg, padding: 14 }}>
          {avatar ? <Skeleton width={56} height={56} radius={28} /> : null}
          <View style={{ flex: 1, gap: 8 }}><Skeleton width="55%" height={16} /><Skeleton height={12} /></View>
        </View>
      ))}
    </View>
  );
}

/** Content eases in (fade + small rise). Use `index` to stagger lists. */
export function FadeIn({ children, index = 0, style }: { children: React.ReactNode; index?: number; style?: StyleProp<ViewStyle> }) {
  const v = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(v, { toValue: 1, duration: 320, delay: Math.min(index, 8) * 50, easing: Easing.out(Easing.cubic), useNativeDriver: Platform.OS !== 'web' }).start();
  }, [v, index]);
  return <Animated.View style={[{ opacity: v, transform: [{ translateY: v.interpolate({ inputRange: [0, 1], outputRange: [12, 0] }) }] }, style]}>{children}</Animated.View>;
}

type ToastMsg = { id: number; text: string; kind: 'ok' | 'info' };
let toastHost: ((m: ToastMsg) => void) | null = null;
let toastId = 0;
/** Friendly, non-blocking confirmation (replaces pop-up alerts for good news). */
export function toast(text: string, kind: 'ok' | 'info' = 'ok') {
  if (toastHost) toastHost({ id: ++toastId, text, kind });
  else notify(text);
}

export function ToastHost() {
  const [msg, setMsg] = useState<ToastMsg | null>(null);
  const v = useRef(new Animated.Value(0)).current;
  const insets = useSafeAreaInsets();
  useEffect(() => { toastHost = setMsg; return () => { toastHost = null; }; }, []);
  useEffect(() => {
    if (!msg) return;
    Animated.timing(v, { toValue: 1, duration: 220, useNativeDriver: Platform.OS !== 'web' }).start();
    const t = setTimeout(() => Animated.timing(v, { toValue: 0, duration: 220, useNativeDriver: Platform.OS !== 'web' }).start(() => setMsg((m) => (m?.id === msg.id ? null : m))), 3200);
    return () => clearTimeout(t);
  }, [msg, v]);
  if (!msg) return null;
  return (
    <Animated.View pointerEvents="none" accessibilityRole="alert" accessibilityLiveRegion="polite"
      style={{ position: 'absolute', left: 16, right: 16, bottom: insets.bottom + 96, alignItems: 'center', opacity: v, transform: [{ translateY: v.interpolate({ inputRange: [0, 1], outputRange: [20, 0] }) }] }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: '#1F2A37', borderRadius: radius.pill, paddingVertical: 14, paddingHorizontal: 20, maxWidth: 440, ...shadow }}>
        <Ionicons name={msg.kind === 'ok' ? 'checkmark-circle' : 'information-circle'} size={24} color={msg.kind === 'ok' ? '#6EE7A8' : '#9CC2FF'} />
        <Txt color="#fff" bold style={{ flexShrink: 1 }}>{msg.text}</Txt>
      </View>
    </Animated.View>
  );
}
