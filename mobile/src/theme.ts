// Design tokens: minimal, premium, glass.
// A soft aurora backdrop sits behind translucent white "glass" surfaces; ink-dark text keeps contrast high
// (WCAG AA+), and sizes stay generous so older users can read and tap comfortably.
export const colors = {
  bg: '#EEF0FA', // fallback behind the aurora backdrop
  card: '#FFFFFF',
  text: '#10121F', // ink
  sub: '#585D73',
  line: 'rgba(16, 18, 31, 0.09)',

  glass: 'rgba(255, 255, 255, 0.64)', // cards, inputs, chips
  glassStrong: 'rgba(255, 255, 255, 0.86)', // popovers
  glassBorder: 'rgba(255, 255, 255, 0.95)',
  sheet: 'rgba(255, 255, 255, 0.97)', // modal sheets stay near-opaque over the dark scrim

  primary: '#4F46E5', // indigo
  primaryDark: '#3730A3',
  accent: '#7C3AED', // gradient partner
  primarySoft: 'rgba(79, 70, 229, 0.10)',
  buy: '#0E8A5F',
  buySoft: 'rgba(14, 138, 95, 0.11)',
  sell: '#D9480F',
  sellSoft: 'rgba(217, 72, 15, 0.11)',
  connect: '#4F46E5',
  connectSoft: 'rgba(79, 70, 229, 0.10)',
  danger: '#C0261B',
  dangerSoft: 'rgba(192, 38, 27, 0.10)',
  warnSoft: 'rgba(245, 166, 35, 0.18)',
  warn: '#8A5A00',
  white: '#FFFFFF',
  star: '#F5A623',
};

export const radius = { sm: 14, md: 20, lg: 28, pill: 999 };
export const space = { xs: 4, sm: 8, md: 12, lg: 18, xl: 26, xxl: 36 };
export const TAP = 56;

export const shadow = { boxShadow: '0px 10px 32px rgba(40, 44, 120, 0.10)' } as const;
export const glow = { boxShadow: '0px 10px 24px rgba(79, 70, 229, 0.35)' } as const;

export type TextSize = 'normal' | 'large' | 'xlarge';
export const TEXT_SCALE: Record<TextSize, number> = { normal: 1, large: 1.15, xlarge: 1.3 };
