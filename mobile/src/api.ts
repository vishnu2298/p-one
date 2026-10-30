import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

function defaultBase() {
  const env = process.env.EXPO_PUBLIC_API_URL;
  if (env) return env.replace(/\/$/, '');
  if (Platform.OS === 'web' && typeof window !== 'undefined') return `${window.location.protocol}//${window.location.hostname}:4000`;
  return Platform.OS === 'android' ? 'http://10.0.2.2:4000' : 'http://localhost:4000';
}
export const API_URL = defaultBase();

let token: string | null = null;
let onUnauthorized: (() => void) | null = null;
export const setToken = (t: string | null) => { token = t; };
export const setUnauthorizedHandler = (fn: () => void) => { onUnauthorized = fn; };

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) { super(message); this.status = status; }
}

export async function api<T = any>(path: string, opts: { method?: string; body?: unknown; signal?: AbortSignal } = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(API_URL + path, {
      method: opts.method || 'GET',
      headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      signal: opts.signal,
    });
  } catch (e: any) {
    if (e?.name === 'AbortError') throw e;
    throw new ApiError(0, 'Cannot reach the server. Please check your internet connection and try again.');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401 && token && onUnauthorized) onUnauthorized();
    throw new ApiError(res.status, data.error || 'Something went wrong. Please try again.');
  }
  return data as T;
}

export const imageUrl = (u?: string) => (!u ? undefined : u.startsWith('http') || u.startsWith('data:') || u.startsWith('file:') ? u : API_URL + u);

export const storage = {
  async get(key: string) { try { return await AsyncStorage.getItem(key); } catch { return null; } },
  async set(key: string, v: string) { try { await AsyncStorage.setItem(key, v); } catch { /* ignore */ } },
  async del(key: string) { try { await AsyncStorage.removeItem(key); } catch { /* ignore */ } },
};

export const money = (n: number) => '₹' + Math.round(n).toLocaleString('en-IN');

export function timeAgo(ts: string) {
  const t = new Date(ts.replace(' ', 'T') + 'Z').getTime();
  const s = Math.max(1, Math.floor((Date.now() - t) / 1000));
  if (s < 60) return 'Just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} hr ago`;
  if (s < 86400 * 30) return `${Math.floor(s / 86400)} d ago`;
  return new Date(t).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}
export const clock = (ts: string) => new Date(ts.replace(' ', 'T') + 'Z').toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' });
