import { useState } from 'react';
import { api } from '../api';
import { Btn, Card, Chips, Field, Head, useLoad, useToast } from '../ui';

export function Onboarding({ onCreated, embedded }: { onCreated: (id: number) => void; embedded?: boolean }) {
  const cats = useLoad(() => api<{ categories: { id: string; name: string }[] }>('/api/v1/business-categories'), []);
  const [f, setF] = useState({ name: '', category: '', gstin: '', address: '' }); const [busy, setBusy] = useState(false); const toast = useToast();
  const submit = async () => {
    setBusy(true);
    try { const r = await api('/api/v1/businesses', { method: 'POST', body: f }); toast('Your workspace is ready'); onCreated(r.business.id); } catch (e: any) { toast(e.message); } finally { setBusy(false); }
  };
  const body = (
    <Card style={{ maxWidth: 640 }}>
      <Head title="Set up your business" sub="Pick what you do. We switch on the modules that fit, and you can change them any time." />
      <Field label="Business name"><input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="e.g. Iron Works Gym" /></Field>
      <Field label="What kind of business is it?"><Chips options={(cats.data?.categories || []).map((c) => [c.id, c.name] as [string, string])} value={f.category} onChange={(v) => setF({ ...f, category: v })} /></Field>
      <Field label="Address (optional)"><input value={f.address} onChange={(e) => setF({ ...f, address: e.target.value })} /></Field>
      <Field label="GSTIN (optional)" hint="15 characters, like 33ABCDE1234F1Z5"><input value={f.gstin} onChange={(e) => setF({ ...f, gstin: e.target.value.toUpperCase() })} maxLength={15} /></Field>
      <Btn p onClick={submit} disabled={busy || f.name.trim().length < 2 || !f.category}>Create business</Btn>
    </Card>
  );
  return embedded ? body : <div className="login">{body}</div>;
}
