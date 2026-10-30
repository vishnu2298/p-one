// Lightweight translation hook. The app ships English only; Hindi and Tamil dictionaries live in src/locales
// and can be switched on later (see the notes there). All UI text already flows through translate().
export type Lang = 'en' | 'hi' | 'ta';
export const LANGUAGES: { id: Lang; label: string; english: string }[] = [
  { id: 'en', label: 'English', english: 'English' },
  // { id: 'hi', label: 'हिन्दी', english: 'Hindi' },   // enable with: import { HI } from './locales/hi' and DICTS.hi = HI
  // { id: 'ta', label: 'தமிழ்', english: 'Tamil' },
];

type Dict = Record<string, string>;
// Format per line: 'English': 'Translation',


const DICTS: Record<Lang, Dict> = { en: {}, hi: {}, ta: {} }; // English only for now
let current: Lang = 'en';
export const setCurrentLang = (l: Lang) => { current = l; };

/** Translate an English phrase. Unknown phrases are returned unchanged. */
export function translate(s: string, lang: Lang = current): string {
  if (lang === 'en' || !s) return s;
  const d = DICTS[lang];
  const hit = d[s] ?? d[s.trim()];
  return hit ?? s;
}
export const t = translate;
