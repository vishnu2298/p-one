// Design tokens. Choices follow accessibility guidance for older users:
// high contrast (WCAG AA+), large text, 56px tap targets, generous spacing, labelled icons.
export const colors = {
  bg: '#F7F5F1', // warm off-white: friendlier than cold grey
  card: '#FFFFFF',
  text: '#0B1B2B',
  sub: '#475467',
  line: '#D9E0E8',
  primary: '#1747C6',
  primaryDark: '#0F2F8A',
  primarySoft: '#E6EDFC',
  buy: '#12794A',
  buySoft: '#E3F5EC',
  sell: '#C2410C',
  sellSoft: '#FDEBDD',
  connect: '#1747C6',
  connectSoft: '#E6EDFC',
  danger: '#B42318',
  dangerSoft: '#FDECEA',
  warnSoft: '#FFF4D6',
  warn: '#8A5A00',
  white: '#FFFFFF',
  star: '#F5A623',
};

export const radius = { sm: 12, md: 18, lg: 24, pill: 999 };
export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 };
export const TAP = 56;

export const shadow = { boxShadow: '0px 3px 14px rgba(60, 40, 10, 0.08)' } as const;

export type TextSize = 'normal' | 'large' | 'xlarge';
export const TEXT_SCALE: Record<TextSize, number> = { normal: 1, large: 1.15, xlarge: 1.3 };
