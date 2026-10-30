const BASE = ((import.meta as any).env?.VITE_API_URL || '').replace(/\/$/, '');
let token: string | null = localStorage.getItem('cb.token');
export const setToken = (t: string | null) => { token = t; if (t) localStorage.setItem('cb.token', t); else localStorage.removeItem('cb.token'); };
export const hasToken = () => !!token;
export class ApiError extends Error { status: number; constructor(s: number, m: string) { super(m); this.status = s; } }
let onAuthLost: () => void = () => {};
export const onUnauthorized = (fn: () => void) => { onAuthLost = fn; };

export async function api<T = any>(path: string, opts: { method?: string; body?: unknown } = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(BASE + path, { method: opts.method || 'GET', headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined });
  } catch { throw new ApiError(0, 'Cannot reach the server. Check your internet connection.'); }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) { if (res.status === 401 && token) onAuthLost(); throw new ApiError(res.status, data.error || 'Something went wrong. Please try again.'); }
  return data as T;
}
export const API_BASE = BASE;

export const rs = (paise?: number | null) => {
  const v = (paise || 0) / 100;
  return '₹' + v.toLocaleString('en-IN', { minimumFractionDigits: Number.isInteger(v) ? 0 : 2, maximumFractionDigits: 2 });
};
export const toPaise = (s: string) => (String(s).trim() === '' ? NaN : Math.round(Number(String(s).replace(/,/g, '')) * 100));
export const newKey = (p: string) => `${p}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
export const bp = (id: number, p: string) => `/api/v1/businesses/${id}${p}`;
export const day = (s: string) => (s || '').slice(0, 10);
