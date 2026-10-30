import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { api, hasToken, onUnauthorized, setToken } from './api';
import { Btn, Card, Empty, Field, Skeleton, ToastHost, useToast } from './ui';
import { Dashboard } from './pages/Dashboard';
import { Pos } from './pages/Pos';
import { Sales } from './pages/Sales';
import { Products, Stock } from './pages/Catalog';
import { Customers, Purchases, Expenses } from './pages/People';
import { Reports } from './pages/Reports';
import { Team, Shop, Appointments } from './pages/Manage';
import { EntityPage, ModulesSettings } from './pages/Dynamic';
import { Onboarding } from './pages/Onboarding';

export type Business = { id: number; name: string; category: string; role: string; permissions: string[]; public_slug: string; gstin: string };
export type ModuleInfo = { key: string; label: string; icon: string; group: string; enabled: boolean; allowed: boolean };
export type Field = { key: string; label: string; type: string; required?: boolean; options?: string[] };
export type EntityDef = { id: number; key: string; label: string; plural: string; icon: string; titleField: string; statusField?: string; fields: Field[] };
type Ws = { biz: Business; list: Business[]; select: (id: number) => void; modules: ModuleInfo[]; entities: EntityDef[]; canWriteRecords: boolean; canManage: boolean; can: (p: string) => boolean; refresh: () => Promise<void>; user: any; logout: () => void };
const WsCtx = createContext<Ws>(null as any);
export const useWs = () => useContext(WsCtx);

const ROUTES: Record<string, string> = { pos: '/pos', sales: '/sales', storefront: '/shop', appointments: '/appointments', products: '/products', inventory: '/stock', purchases: '/purchases', customers: '/customers', team: '/team', reports: '/reports', expenses: '/expenses' };
const ICON: Record<string, string> = { calculator: '🧮', receipt: '🧾', storefront: '🏪', calendar: '📅', cube: '📦', layers: '🗂️', download: '📥', people: '👥', 'person-add': '🧑‍💼', 'stats-chart': '📊', wallet: '💳' };
const eIcon = (i: string) => ICON[i] || '🔹';

function useHash() {
  const [h, setH] = useState(() => location.hash.slice(1) || '/');
  useEffect(() => { const f = () => setH(location.hash.slice(1) || '/'); window.addEventListener('hashchange', f); return () => window.removeEventListener('hashchange', f); }, []);
  return h;
}
export const go = (p: string) => { location.hash = p; };

function Login({ onDone }: { onDone: () => void }) {
  const [mode, setMode] = useState<'login' | 'register'>('login'); const [f, setF] = useState({ name: '', email: '', password: '' }); const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setBusy(true); setErr('');
    try {
      const r = mode === 'login' ? await api('/auth/login', { method: 'POST', body: { email: f.email, password: f.password } }) : await api('/auth/register', { method: 'POST', body: { ...f, consent: true, city: 'Chennai' } });
      setToken(r.token); onDone();
    } catch (x: any) { setErr(x.message); } finally { setBusy(false); }
  };
  return (
    <div className="login"><Card>
      <div className="brand"><i />Connectly Business</div>
      <p className="sub" style={{ marginTop: 0 }}>Billing, stock, books, bookings and your online shop. One place, built around your kind of business.</p>
      <form onSubmit={submit}>
        {mode === 'register' ? <Field label="Your name"><input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required /></Field> : null}
        <Field label="Email"><input type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} required autoFocus /></Field>
        <Field label="Password"><input type="password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} required minLength={8} /></Field>
        {err ? <div className="err" style={{ marginBottom: 12 }}>{err}</div> : null}
        <Btn p type="submit" disabled={busy} style={{ width: '100%' }}>{mode === 'login' ? 'Log in' : 'Create account'}</Btn>
      </form>
      <p className="small sub" style={{ textAlign: 'center' }}>{mode === 'login' ? 'New here? ' : 'Have an account? '}<a href="#/" onClick={(e) => { e.preventDefault(); setMode(mode === 'login' ? 'register' : 'login'); }}>{mode === 'login' ? 'Create an account' : 'Log in'}</a></p>
      {mode === 'login' ? <p className="small sub" style={{ textAlign: 'center' }}>Demo: demo@connectly.app / demo1234</p> : null}
    </Card></div>
  );
}

function Shell() {
  const [user, setUser] = useState<any>(null); const [list, setList] = useState<Business[] | null>(null); const [curId, setCurId] = useState<number | null>(Number(localStorage.getItem('cb.biz')) || null);
  const [mods, setMods] = useState<{ modules: ModuleInfo[]; entities: EntityDef[]; canWriteRecords: boolean; canManage: boolean } | null>(null);
  const [online, setOnline] = useState(navigator.onLine); const [menu, setMenu] = useState(false); const hash = useHash(); const toast = useToast();
  useEffect(() => { const a = () => setOnline(true), b = () => setOnline(false); window.addEventListener('online', a); window.addEventListener('offline', b); return () => { window.removeEventListener('online', a); window.removeEventListener('offline', b); }; }, []);

  const loadBiz = useCallback(async () => { const r = await api('/api/v1/me/businesses'); setList(r.businesses); }, []);
  useEffect(() => { api('/auth/me').then((r) => setUser(r.user)).catch(() => {}); void loadBiz().catch(() => setList([])); }, [loadBiz]);
  const biz = list?.find((b) => b.id === curId) || list?.[0] || null;
  const loadMods = useCallback(async () => { if (biz) setMods(await api(`/api/v1/businesses/${biz.id}/modules`)); }, [biz?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { setMods(null); void loadMods().catch((e) => toast(e.message)); }, [loadMods]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => setMenu(false), [hash]);

  if (list === null) return <div className="page"><Skeleton /></div>;
  if (!biz) return <Onboarding onCreated={async (id) => { localStorage.setItem('cb.biz', String(id)); setCurId(id); await loadBiz(); }} />;
  if (!mods) return <div className="page"><Skeleton /></div>;

  const can = (p: string) => biz.permissions.includes(p);
  const ws: Ws = { biz, list, select: (id) => { localStorage.setItem('cb.biz', String(id)); setCurId(id); go('/'); }, modules: mods.modules, entities: mods.entities, canWriteRecords: mods.canWriteRecords, canManage: mods.canManage, can, refresh: loadMods, user, logout: () => { setToken(null); location.reload(); } };
  const groups = ['Sell', 'Stock', 'People', 'Money'];
  const [path, ...rest] = hash.split('/').filter(Boolean);
  const nav = (p: string, label: string, icon: string) => <button key={p} className={`nav ${hash === p || (p !== '/' && hash.startsWith(p + '/')) ? 'on' : ''}`} onClick={() => go(p)}><span>{icon}</span>{label}</button>;

  let page: React.ReactNode;
  const on = (k: string) => mods.modules.find((m) => m.key === k && m.enabled && m.allowed);
  const gate = (k: string, el: React.ReactNode) => (on(k) ? el : <Card><Empty title="This module is off" text="Switch it on from Modules if you need it." action={mods.canManage ? <Btn p onClick={() => go('/modules')}>Open Modules</Btn> : null} /></Card>);
  switch (path || '') {
    case '': page = can('dashboard.read') ? <Dashboard /> : <Card><Empty title={`Welcome, ${user?.name || ''}`} text="Pick something from the menu." /></Card>; break;
    case 'pos': page = gate('pos', <Pos />); break;
    case 'sales': page = gate('sales', <Sales />); break;
    case 'products': page = gate('products', <Products />); break;
    case 'stock': page = gate('inventory', <Stock />); break;
    case 'purchases': page = gate('purchases', <Purchases />); break;
    case 'customers': page = gate('customers', <Customers />); break;
    case 'expenses': page = gate('expenses', <Expenses />); break;
    case 'reports': page = gate('reports', <Reports />); break;
    case 'team': page = gate('team', <Team />); break;
    case 'shop': page = gate('storefront', <Shop />); break;
    case 'appointments': page = gate('appointments', <Appointments />); break;
    case 'modules': page = <ModulesSettings />; break;
    case 'r': { const def = mods.entities.find((e) => e.key === rest[0]); page = def ? <EntityPage key={def.key} def={def} /> : <Card><Empty title="Not found" /></Card>; break; }
    default: page = <Card><Empty title="Page not found" /></Card>;
  }
  return (
    <WsCtx.Provider value={ws}>
      <div className="shell">
        <aside className={`side ${menu ? 'open' : ''}`}>
          <div className="brand"><i />Connectly Business</div>
          {nav('/', 'Home', '🏠')}
          {groups.map((g) => { const items = mods.modules.filter((m) => m.group === g && m.enabled && m.allowed); return items.length ? <div key={g}><div className="grp">{g}</div>{items.map((m) => nav(ROUTES[m.key], m.label, eIcon(m.icon)))}</div> : null; })}
          {mods.entities.length ? <div><div className="grp">Your records</div>{mods.entities.map((e) => nav(`/r/${e.key}`, e.plural, eIcon(e.icon)))}</div> : null}
          {mods.canManage ? <div><div className="grp">Set up</div>{nav('/modules', 'Modules', '🧩')}</div> : null}
        </aside>
        <div className="main">
          {!online ? <div className="banner">You are offline. Bills made in Billing are saved here and sent when you are back online.</div> : null}
          <div className="top no-print">
            <div className="row"><Btn className="menu-btn" onClick={() => setMenu(!menu)} aria-label="Menu">☰</Btn>
              <select value={biz.id} onChange={(e) => ws.select(Number(e.target.value))} aria-label="Business" style={{ width: 'auto', fontWeight: 650 }}>{list.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select>
              <Btn s onClick={() => go('/new')}>+ New business</Btn></div>
            <div className="row"><span className="pill">{biz.role}</span><span className="sub small">{user?.name}</span><Btn s onClick={ws.logout}>Log out</Btn></div>
          </div>
          <div className="page">{path === 'new' ? <Onboarding onCreated={async (id) => { localStorage.setItem('cb.biz', String(id)); setCurId(id); await loadBiz(); go('/'); }} embedded /> : page}</div>
        </div>
      </div>
    </WsCtx.Provider>
  );
}

export function App() {
  const [authed, setAuthed] = useState(hasToken());
  useEffect(() => onUnauthorized(() => { setToken(null); setAuthed(false); }), []);
  return <ToastHost>{authed ? <Shell /> : <Login onDone={() => setAuthed(true)} />}</ToastHost>;
}
