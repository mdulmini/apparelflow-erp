import React, { useCallback, useEffect, useState } from 'react';
import { api, describeError } from '../api.js';
import { Banner, Light } from '../ui.jsx';
import { fmt } from '../validators.js';

export default function Sewing() {
  const [queue, setQueue] = useState([]);
  const [active, setActive] = useState([]);
  const [err, setErr] = useState('');
  const [ok, setOk] = useState('');

  const load = useCallback(async () => {
    try {
      const [q, a] = await Promise.all([api('/sewing/queue'), api('/sewing/in-progress')]);
      setQueue(q); setActive(a); setErr('');
    } catch (e) { setErr(describeError(e)); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const start = async (o) => {
    try { await api(`/sewing/${o.id}/start`, { method: 'POST' }); setOk(`${o.order_no} sent to the assembly line`); await load(); }
    catch (e) { setErr(describeError(e)); setOk(''); }
  };

  return (
    <section>
      <div className="page-head"><div><h1>Sewing Queue</h1><p className="muted">Only batches verified by the Cutting Verifier appear here.</p></div></div>
      <Banner>{err}</Banner><Banner kind="ok">{ok}</Banner>
      {queue.length === 0 && <div className="card empty">No verified batches waiting.</div>}
      {queue.map((o) => <BatchCard key={o.id} o={o} action={<button className="btn btn-primary" onClick={() => start(o)}>Start Sewing Assembly</button>} />)}
      <h2 className="section">In sewing ({active.length})</h2>
      {active.map((o) => <BatchCard key={o.id} o={o} compact action={<span className="pill pill-in_sewing">Started {fmt(o.sewing_started_at)} by {o.sewing_started_by_name}</span>} />)}
    </section>
  );
}

function BatchCard({ o, action, compact }) {
  const v = o.verification;
  const overCap = v && v.wastage_pct > o.recipe.wastage_cap;
  return (
    <div className="card batch">
      <div className="terminal-head">
        <div><h2>{o.order_no} - {o.recipe.name}</h2><p className="muted">{o.target_qty} garments · roll {o.fabric_roll_id}</p></div>
        <div>{action}</div>
      </div>
      <div className="audit">
        <div><small>Verified by</small><strong>{v.verifier_name}</strong></div>
        <div><small>Verified at</small><strong>{fmt(v.timestamp)}</strong></div>
        <div><small>Fabric wastage</small><strong className={overCap ? 'over' : ''}>{v.wastage_pct}% <span className="muted">(cap {o.recipe.wastage_cap}%)</span></strong>{overCap && <em className="over"> Above cap</em>}</div>
        <div><small>Verifier note</small><strong>{v.audit_note || 'None'}</strong></div>
      </div>
      {!compact && (
        <table><thead><tr><th>Component</th><th>Expected</th><th>Counted</th><th>Variance</th><th>Flag</th></tr></thead>
          <tbody>{o.items.map((i) => <tr key={i.component_id}><td>{i.component_name}</td><td>{i.expected_qty}</td><td>{i.actual_qty}</td><td>{i.variance > 0 ? `+${i.variance}` : i.variance}</td><td><Light status={i.status} /></td></tr>)}</tbody></table>
      )}
    </div>
  );
}