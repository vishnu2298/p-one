import { useState } from 'react';
import { useWs, EntityDef, Field as FieldDef } from '../App';
import { api, bp, rs, toPaise } from '../api';
import { Async, Btn, Card, Chips, Empty, Field, Head, Kpi, Modal, Pill, useDebounced, useLoad, useToast } from '../ui';

const show = (f: FieldDef, v: any) => (v === undefined || v === null || v === '' ? '—' : f.type === 'money' ? rs(v) : f.type === 'checkbox' ? (v ? 'Yes' : 'No') : String(v));

/** One generic page for every record type: table, search, status filter, summary and a form generated from the definition. */
export function EntityPage({ def }: { def: EntityDef }) {
  const { biz, canWriteRecords } = useWs(); const toast = useToast();
  const [q, setQ] = useState(''); const dq = useDebounced(q); const [status, setStatus] = useState(''); const [edit, setEdit] = useState<any | null>(null);
  const res = useLoad(() => api<any>(bp(biz.id, `/entities/${def.key}/records?q=${encodeURIComponent(dq)}&status=${encodeURIComponent(status)}`)), [biz.id, def.key, dq, status]);
  const sum = useLoad(() => api<any>(bp(biz.id, `/entities/${def.key}/summary`)), [biz.id, def.key, res.data]);
  const status_ = def.fields.find((f) => f.key === def.statusField);
  const cols = def.fields.slice(0, 6);
  const remove = async (r: any) => { if (!confirm(`Delete this ${def.label.toLowerCase()}?`)) return; try { await api(bp(biz.id, `/entities/${def.key}/records/${r.id}`), { method: 'DELETE' }); toast('Deleted'); res.reload(); } catch (e: any) { toast(e.message); } };
  return (
    <>
      <Head title={def.plural} sub={sum.data ? `${sum.data.count} in total` : undefined} right={canWriteRecords ? <Btn p onClick={() => setEdit({})}>+ Add {def.label.toLowerCase()}</Btn> : null} />
      {sum.data ? <div className="grid kpis" style={{ marginBottom: 14 }}>
        {Object.entries(sum.data.byStatus as Record<string, number>).map(([k, n]) => <Kpi key={k} label={k} value={String(n)} />)}
        {def.fields.filter((f) => f.type === 'money' && sum.data.totals[f.key] !== undefined).slice(0, 2).map((f) => <Kpi key={f.key} label={`Total ${f.label.toLowerCase()}`} value={rs(sum.data.totals[f.key])} />)}
      </div> : null}
      <Card>
        <div className="row" style={{ marginBottom: 12 }}>
          <input className="grow" placeholder={`Search ${def.plural.toLowerCase()}`} value={q} onChange={(e) => setQ(e.target.value)} style={{ maxWidth: 320 }} />
          {status_ ? <Chips options={[['', 'All'], ...status_.options!.map((o) => [o, o] as [string, string])]} value={status} onChange={setStatus} /> : null}
        </div>
        <Async res={res}>{(d) => !d.records.length ? <Empty title={`No ${def.plural.toLowerCase()} yet`} text={canWriteRecords ? 'Add the first one to get started.' : undefined} action={canWriteRecords ? <Btn p onClick={() => setEdit({})}>Add {def.label.toLowerCase()}</Btn> : undefined} /> : (
          <div className="tablewrap"><table><thead><tr>{cols.map((f) => <th key={f.key}>{f.label}</th>)}<th /></tr></thead><tbody>
            {d.records.map((r: any) => <tr key={r.id} className={canWriteRecords ? 'click' : ''} onClick={() => canWriteRecords && setEdit(r)}>
              {cols.map((f) => <td key={f.key}>{f.key === def.statusField ? <Pill>{r[f.key]}</Pill> : show(f, r[f.key])}</td>)}
              <td className="right">{canWriteRecords ? <Btn s d onClick={(e) => { e.stopPropagation(); void remove(r); }}>Delete</Btn> : null}</td></tr>)}
          </tbody></table></div>
        )}</Async>
      </Card>
      {edit ? <RecordForm def={def} rec={edit} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); res.reload(); }} /> : null}
    </>
  );
}

function RecordForm({ def, rec, onClose, onSaved }: { def: EntityDef; rec: any; onClose: () => void; onSaved: () => void }) {
  const { biz } = useWs(); const toast = useToast();
  const init: Record<string, any> = {};
  for (const f of def.fields) init[f.key] = rec[f.key] === undefined ? (f.type === 'select' ? f.options![0] : f.type === 'checkbox' ? false : '') : f.type === 'money' ? String(rec[f.key] / 100) : rec[f.key];
  const [v, setV] = useState(init); const [busy, setBusy] = useState(false); const [err, setErr] = useState('');
  const save = async () => {
    setBusy(true); setErr('');
    const body: Record<string, any> = {};
    for (const f of def.fields) body[f.key] = f.type === 'money' ? (v[f.key] === '' ? '' : toPaise(String(v[f.key]))) : f.type === 'number' ? (v[f.key] === '' ? '' : Number(v[f.key])) : v[f.key];
    try { await api(bp(biz.id, `/entities/${def.key}/records${rec.id ? `/${rec.id}` : ''}`), { method: rec.id ? 'PATCH' : 'POST', body }); toast('Saved'); onSaved(); } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  };
  return (
    <Modal title={`${rec.id ? 'Edit' : 'New'} ${def.label.toLowerCase()}`} onClose={onClose}>
      {def.fields.map((f) => <Field key={f.key} label={`${f.label}${f.required ? ' *' : ''}${f.type === 'money' ? ' (₹)' : ''}`}>
        {f.type === 'select' ? <select value={v[f.key]} onChange={(e) => setV({ ...v, [f.key]: e.target.value })}>{f.options!.map((o) => <option key={o}>{o}</option>)}</select>
          : f.type === 'longtext' ? <textarea rows={3} value={v[f.key]} onChange={(e) => setV({ ...v, [f.key]: e.target.value })} />
          : f.type === 'checkbox' ? <input type="checkbox" checked={!!v[f.key]} onChange={(e) => setV({ ...v, [f.key]: e.target.checked })} style={{ width: 20 }} />
          : <input type={f.type === 'date' ? 'date' : f.type === 'number' || f.type === 'money' ? 'number' : f.type === 'email' ? 'email' : f.type === 'phone' ? 'tel' : 'text'} step={f.type === 'money' ? '0.01' : undefined} value={v[f.key]} onChange={(e) => setV({ ...v, [f.key]: e.target.value })} />}
      </Field>)}
      {err ? <div className="err" style={{ marginBottom: 10 }}>{err}</div> : null}
      <div className="row"><Btn p onClick={save} disabled={busy}>Save</Btn><Btn onClick={onClose}>Cancel</Btn></div>
    </Modal>
  );
}

const TYPE_OPTIONS: [string, string][] = [['text', 'Text'], ['longtext', 'Long text'], ['number', 'Number'], ['money', 'Amount (₹)'], ['date', 'Date'], ['select', 'Choice'], ['phone', 'Phone'], ['email', 'Email'], ['checkbox', 'Yes / no']];

/** Turn modules on and off, describe the business to get suggestions, or design a record type by hand. */
export function ModulesSettings() {
  const { biz, modules, entities, refresh } = useWs(); const toast = useToast();
  const [desc, setDesc] = useState(''); const [busy, setBusy] = useState(false); const [sugg, setSugg] = useState<any>(null); const [builder, setBuilder] = useState(false);
  const toggle = async (key: string, enabled: boolean) => { try { await api(bp(biz.id, `/modules/${key}`), { method: 'PUT', body: { enabled } }); await refresh(); } catch (e: any) { toast(e.message); } };
  const suggest = async () => { setBusy(true); try { setSugg(await api(bp(biz.id, '/modules/suggest'), { method: 'POST', body: { description: desc } })); } catch (e: any) { toast(e.message); } finally { setBusy(false); } };
  const apply = async () => {
    try {
      for (const k of sugg.modules || []) await api(bp(biz.id, `/modules/${k}`), { method: 'PUT', body: { enabled: true } });
      if (sugg.entities.length) await api(bp(biz.id, '/entities'), { method: 'POST', body: { entities: sugg.entities } });
      toast('Modules added'); setSugg(null); setDesc(''); await refresh();
    } catch (e: any) { toast(e.message); }
  };
  const archive = async (k: string) => { if (!confirm('Hide this record type? Its records are kept.')) return; try { await api(bp(biz.id, `/entities/${k}`), { method: 'DELETE' }); await refresh(); } catch (e: any) { toast(e.message); } };
  return (
    <>
      <Head title="Modules" sub="Your workspace is built from these. Switch things on or off, or add your own." />
      <Card>
        <h2>Describe your business</h2>
        <p className="sub small" style={{ marginTop: -6 }}>For example: "We run a tuition centre with monthly fees and batches". We suggest record types and modules. Nothing changes until you accept.</p>
        <div className="row"><input className="grow" value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="What does your business do?" /><Btn p onClick={suggest} disabled={busy || desc.trim().length < 4}>{busy ? 'Thinking…' : 'Suggest modules'}</Btn></div>
        {sugg ? <div style={{ marginTop: 14 }}>
          <div className="small sub">Suggested ({sugg.source === 'ai' ? 'designed by AI for your description' : 'from our templates'})</div>
          {sugg.entities.length ? sugg.entities.map((e: any) => <div key={e.key} className="card" style={{ marginTop: 8 }}><b>{e.plural}</b><div className="small sub">{e.fields.map((f: any) => f.label).join(' · ')}</div></div>) : <p className="sub">Everything in this suggestion is already set up.</p>}
          <div className="row" style={{ marginTop: 12 }}><Btn p onClick={apply}>Add these</Btn><Btn onClick={() => setSugg(null)}>Not now</Btn></div></div> : null}
      </Card>
      <Card>
        <h2>Built-in modules</h2>
        <div className="grid three">{modules.map((m) => <label key={m.key} className="card row" style={{ justifyContent: 'space-between', cursor: m.allowed ? 'pointer' : 'default', margin: 0 }}><span><b>{m.label}</b><div className="small sub">{m.group}</div></span>
          <input type="checkbox" style={{ width: 22 }} checked={m.enabled} disabled={m.key === 'team'} onChange={(e) => toggle(m.key, e.target.checked)} /></label>)}</div>
      </Card>
      <Card>
        <div className="row" style={{ justifyContent: 'space-between' }}><h2>Your record types</h2><Btn p onClick={() => setBuilder(true)}>+ New record type</Btn></div>
        {entities.length ? <div className="tablewrap"><table><thead><tr><th>Name</th><th>Fields</th><th /></tr></thead><tbody>{entities.map((e) => <tr key={e.key}><td><b>{e.plural}</b></td><td className="small sub">{e.fields.map((f) => f.label).join(', ')}</td><td className="right"><Btn s d onClick={() => archive(e.key)}>Hide</Btn></td></tr>)}</tbody></table></div> : <Empty title="No custom record types" text="Add one for anything you track that is not in the built-in modules." />}
      </Card>
      {builder ? <Builder onClose={() => setBuilder(false)} onSaved={async () => { setBuilder(false); await refresh(); }} /> : null}
    </>
  );
}

function Builder({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const { biz } = useWs(); const toast = useToast();
  const [label, setLabel] = useState(''); const [fields, setFields] = useState<{ label: string; type: string; options: string; required: boolean }[]>([{ label: '', type: 'text', options: '', required: true }]);
  const set = (i: number, p: any) => setFields(fields.map((f, n) => (n === i ? { ...f, ...p } : f)));
  const save = async () => {
    try {
      await api(bp(biz.id, '/entities'), { method: 'POST', body: { label, fields: fields.filter((f) => f.label.trim()).map((f) => ({ label: f.label, type: f.type, required: f.required, options: f.options.split(',').map((o) => o.trim()).filter(Boolean) })) } });
      toast('Record type added'); onSaved();
    } catch (e: any) { toast(e.message); }
  };
  return (
    <Modal title="New record type" onClose={onClose}>
      <Field label="What do you want to keep track of?" hint="One of them, for example: Vehicle, Booking, Batch, Warranty"><input value={label} onChange={(e) => setLabel(e.target.value)} /></Field>
      <h2>Fields</h2>
      {fields.map((f, i) => <div key={i} className="row" style={{ marginBottom: 8, alignItems: 'flex-start' }}>
        <input className="grow" placeholder="Field name" value={f.label} onChange={(e) => set(i, { label: e.target.value })} />
        <select style={{ width: 130 }} value={f.type} onChange={(e) => set(i, { type: e.target.value })}>{TYPE_OPTIONS.map(([id, l]) => <option key={id} value={id}>{l}</option>)}</select>
        {f.type === 'select' ? <input className="grow" placeholder="Choices, comma separated" value={f.options} onChange={(e) => set(i, { options: e.target.value })} /> : null}
        <Btn s onClick={() => setFields(fields.filter((_, n) => n !== i))} aria-label="Remove field">✕</Btn></div>)}
      <div className="row" style={{ margin: '10px 0 14px' }}><Btn s onClick={() => setFields([...fields, { label: '', type: 'text', options: '', required: false }])}>+ Add field</Btn></div>
      <p className="small sub">Tip: a Choice field named "Status" becomes the workflow, with filters and counts on the dashboard.</p>
      <div className="row"><Btn p onClick={save} disabled={label.trim().length < 2}>Create</Btn><Btn onClick={onClose}>Cancel</Btn></div>
    </Modal>
  );
}
