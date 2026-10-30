import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';

export const Pill = ({ children, tone }: { children: React.ReactNode; tone?: 'good' | 'bad' | 'warn' }) => <span className={`pill ${tone || ''}`}>{children}</span>;
export const Card = ({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) => <div className="card" style={style}>{children}</div>;
export const Btn = ({ children, p, d, s, ...r }: React.ButtonHTMLAttributes<HTMLButtonElement> & { p?: boolean; d?: boolean; s?: boolean }) => <button {...r} className={`btn ${p ? 'p' : ''} ${d ? 'd' : ''} ${s ? 's' : ''} ${r.className || ''}`}>{children}</button>;
export const Kpi = ({ label, value, tone }: { label: string; value: string; tone?: 'good' | 'bad' }) => <div className="card kpi"><div className="l">{label}</div><div className="v" style={{ color: tone === 'bad' ? 'var(--bad)' : tone === 'good' ? 'var(--good)' : undefined }}>{value}</div></div>;
export const Empty = ({ title, text, action }: { title: string; text?: string; action?: React.ReactNode }) => <div className="empty"><b>{title}</b>{text}<div style={{ marginTop: 12 }}>{action}</div></div>;
export const Skeleton = ({ rows = 4 }: { rows?: number }) => <div>{Array.from({ length: rows }, (_, i) => <div key={i} className="skel" style={{ width: `${95 - i * 9}%` }} />)}</div>;
export const ErrorBox = ({ message, retry }: { message: string; retry?: () => void }) => <div className="err">{message} {retry ? <button className="btn s" onClick={retry} style={{ marginLeft: 8 }}>Try again</button> : null}</div>;
export const Line = ({ label, value, bold, color }: { label: string; value: string; bold?: boolean; color?: string }) => <div className="row" style={{ justifyContent: 'space-between', padding: '5px 0' }}><span className={bold ? 'bold' : ''}>{label}</span><span className={bold ? 'bold' : ''} style={{ color }}>{value}</span></div>;
export const Head = ({ title, sub, right }: { title: string; sub?: string; right?: React.ReactNode }) => <div className="head"><div><h1>{title}</h1>{sub ? <div className="sub">{sub}</div> : null}</div><div className="row no-print">{right}</div></div>;
export const Field = ({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) => {
  const id = React.useId();
  const single = React.isValidElement(children) && ['input', 'select', 'textarea'].includes(children.type as string);
  return <div className="field"><label htmlFor={single ? id : undefined}>{label}</label>{single ? React.cloneElement(children as React.ReactElement<any>, { id }) : children}{hint ? <span className="small sub">{hint}</span> : null}</div>;
};
export const Chips = <T extends string>({ options, value, onChange }: { options: [T, string][]; value: T | ''; onChange: (v: T) => void }) => <div className="chips">{options.map(([id, l]) => <button key={id} className={`chip ${value === id ? 'on' : ''}`} onClick={() => onChange(id)}>{l}</button>)}</div>;

export function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  useEffect(() => { const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose(); window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k); }, [onClose]);
  return <div className="modal-bg" onMouseDown={(e) => e.target === e.currentTarget && onClose()}><div className="modal" role="dialog" aria-label={title}><div className="row" style={{ justifyContent: 'space-between', marginBottom: 10 }}><h2 style={{ margin: 0 }}>{title}</h2><button className="btn s" onClick={onClose} aria-label="Close">✕</button></div>{children}</div></div>;
}

const ToastCtx = createContext<(m: string) => void>(() => {});
export const useToast = () => useContext(ToastCtx);
export function ToastHost({ children }: { children: React.ReactNode }) {
  const [msg, setMsg] = useState(''); const t = useRef<number>();
  const show = useCallback((m: string) => { setMsg(m); window.clearTimeout(t.current); t.current = window.setTimeout(() => setMsg(''), 2600); }, []);
  return <ToastCtx.Provider value={show}>{children}{msg ? <div className="toast" role="status">{msg}</div> : null}</ToastCtx.Provider>;
}

/** Loads on mount and whenever deps change; keeps showing old data while refreshing. */
export function useLoad<T>(fn: () => Promise<T>, deps: unknown[]) {
  const [data, setData] = useState<T | null>(null); const [error, setError] = useState<string | null>(null); const [loading, setLoading] = useState(true);
  const seq = useRef(0);
  const run = useCallback(async () => {
    const id = ++seq.current; setLoading(true);
    try { const d = await fn(); if (id === seq.current) { setData(d); setError(null); } } catch (e: any) { if (id === seq.current) setError(e.message); } finally { if (id === seq.current) setLoading(false); }
  }, deps); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { void run(); }, [run]);
  return { data, error, loading, reload: run, setData };
}
export function useDebounced<T>(v: T, ms = 300) { const [d, setD] = useState(v); useEffect(() => { const t = setTimeout(() => setD(v), ms); return () => clearTimeout(t); }, [v, ms]); return d; }

export function Async<T>({ res, children, emptyText }: { res: { data: T | null; error: string | null; loading: boolean; reload: () => void }; children: (d: T) => React.ReactNode; emptyText?: string }) {
  if (res.error && !res.data) return <ErrorBox message={res.error} retry={res.reload} />;
  if (!res.data) return <Skeleton />;
  return <>{children(res.data)}</>;
}
