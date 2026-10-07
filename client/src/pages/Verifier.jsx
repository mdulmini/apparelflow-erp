import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { api, describeError } from '../api.js';
import { Banner, Field, Light, StatusBadge } from '../ui.jsx';
import { validateInt, fmt } from '../validators.js';

const lightFor = (expected, raw) => {
  if (String(raw).trim() === '' || validateInt(raw)) return null;
  const n = Number(raw);
  return n === expected ? 'GREEN' : n > expected ? 'YELLOW' : 'RED';
};

export default function Verifier() {
  const [orders, setOrders] = useState([]);
  const [tab, setTab] = useState('PENDING');
  const [selected, setSelected] = useState(null);
  const [err, setErr] = useState('');
  const [ok, setOk] = useState('');

  const load = useCallback(async () => {
    try { setOrders(await api('/orders')); setErr(''); } catch (e) { setErr(describeError(e)); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const pending = orders.filter((o) => o.status === 'PENDING_VERIFICATION');
  const history = orders.filter((o) => o.status !== 'PENDING_VERIFICATION');
  const list = tab === 'PENDING' ? pending : history;
  const current = orders.find((o) => o.id === selected);

  return (
    <section>
      <div className="page-head"><div><h1>Verification Terminal</h1><p className="muted">Count every component. A single RED (shortage) blocks approval.</p></div></div>
      <Banner>{err}</Banner><Banner kind="ok">{ok}</Banner>
      <div className="tabs" role="tablist">
        <button role="tab" aria-selected={tab === 'PENDING'} className={tab === 'PENDING' ? 'tab on' : 'tab'} onClick={() => setTab('PENDING')}>At QC station ({pending.length})</button>
        <button role="tab" aria-selected={tab === 'HISTORY'} className={tab === 'HISTORY' ? 'tab on' : 'tab'} onClick={() => setTab('HISTORY')}>History ({history.length})</button>
      </div>
      <div className="split">
        <div className="card table-wrap">
          <table>
            <thead><tr><th>Order</th><th>Recipe</th><th>Qty</th><th>Status</th></tr></thead>
            <tbody>
              {list.length === 0 && <tr><td colSpan="4" className="empty">Nothing here.</td></tr>}
              {list.map((o) => (
                <tr key={o.id} className={o.id === selected ? 'row-on' : ''} onClick={() => { setSelected(o.id); setOk(''); }} tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && setSelected(o.id)}>
                  <td><strong>{o.order_no}</strong></td><td>{o.recipe.name}</td><td>{o.target_qty}</td><td><StatusBadge status={o.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div>
          {!current && <div className="card empty">Select an order to open the terminal.</div>}
          {current && <Terminal key={`${current.id}-${current.status}-${current.updated_at}`} order={current} onChanged={async (msg) => { setOk(msg); await load(); }} />}
        </div>
      </div>
    </section>
  );
}

function Terminal({ order, onChanged }) {
  const editable = order.status === 'PENDING_VERIFICATION';
  const [vals, setVals] = useState(() => Object.fromEntries(order.items.map((i) => [i.component_id, i.actual_qty ?? ''])));
  const [reason, setReason] = useState('');
  const [note, setNote] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [touched, setTouched] = useState({});

  const rows = useMemo(() => order.items.map((i) => {
    const raw = vals[i.component_id];
    const fieldErr = touched[i.component_id] || raw !== '' ? (String(raw).trim() === '' ? 'Count required' : validateInt(raw, { label: 'Count' })) : null;
    return { ...i, raw, fieldErr, light: lightFor(i.expected_qty, raw) };
  }), [order.items, vals, touched]);

  const anyRed = rows.some((r) => r.light === 'RED');
  const allCounted = rows.every((r) => r.light !== null);
  const canApprove = editable && allCounted && !anyRed && !busy;
  const canReject = editable && reason.trim().length >= 5 && !busy;

  const payload = () => ({ counts: rows.filter((r) => r.light).map((r) => ({ component_id: r.component_id, actual_qty: Number(r.raw) })) });
  const run = async (fn, msg) => {
    setBusy(true); setErr('');
    try { await fn(); await onChanged(msg); } catch (e) { setErr(describeError(e)); } finally { setBusy(false); }
  };

  return (
    <div className="card terminal">
      <div className="terminal-head">
        <div><h2>{order.order_no} - {order.recipe.name}</h2><p className="muted">{order.target_qty} garments · roll {order.fabric_roll_id} · {order.actual_fabric_yds} yds used (expected {order.expected_fabric_yds})</p></div>
        <StatusBadge status={order.status} />
      </div>
      {order.verification && order.status === 'REJECTED' && <Banner kind="error">Rejected: {order.verification.rejection_note}</Banner>}
      {order.verification && order.status !== 'REJECTED' && <Banner kind="ok">Verified by {order.verification.verifier_name} on {fmt(order.verification.timestamp)} · wastage {order.verification.wastage_pct}%</Banner>}

      <div className="table-wrap">
        <table>
          <thead><tr><th>Component</th><th>Expected</th><th>Actual count</th><th>Variance</th><th>Flag</th></tr></thead>
          <tbody>
            {rows.map((r) => {
              const v = r.light && r.raw !== '' ? Number(r.raw) - r.expected_qty : null;
              return (
                <tr key={r.component_id} className={r.light === 'RED' ? 'row-red' : ''}>
                  <td>{r.component_name}</td>
                  <td><strong>{r.expected_qty}</strong></td>
                  <td>
                    <input aria-label={`Actual count for ${r.component_name}`} className="count-input" inputMode="numeric" disabled={!editable}
                      value={r.raw} onChange={(e) => setVals((p) => ({ ...p, [r.component_id]: e.target.value }))} onBlur={() => setTouched((t) => ({ ...t, [r.component_id]: true }))} />
                    {r.fieldErr && <div className="error" role="alert">{r.fieldErr}</div>}
                  </td>
                  <td>{v === null ? '-' : v > 0 ? `+${v}` : v}</td>
                  <td><Light status={r.light} /></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {editable && (
        <>
          {anyRed && <Banner kind="error">Shortage detected - "Approve Batch" is disabled. Reject the batch with a reason so the Supervisor can re-cut.</Banner>}
          {!anyRed && !allCounted && <Banner kind="warn">Count every component to enable approval.</Banner>}
          <div className="grid2">
            <Field label="Approval note (optional, visible to Sewing)" id="note"><textarea id="note" rows="2" maxLength="500" value={note} onChange={(e) => setNote(e.target.value)} /></Field>
            <Field label="Rejection reason (mandatory to reject)" id="reason" error={reason.length > 0 && reason.trim().length < 5 ? 'Enter at least 5 characters' : null}>
              <textarea id="reason" rows="2" maxLength="500" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Collar shortage - re-cut 6 pieces" />
            </Field>
          </div>
          <Banner>{err}</Banner>
          <div className="modal-actions">
            <button className="btn btn-secondary" disabled={busy || !rows.some((r) => r.light)} onClick={() => run(() => api(`/orders/${order.id}/counts`, { method: 'PUT', body: payload() }), 'Counts saved')}>Save counts</button>
            <button className="btn btn-danger" disabled={!canReject} onClick={() => run(async () => {
              if (payload().counts.length) await api(`/orders/${order.id}/counts`, { method: 'PUT', body: payload() });
              await api(`/orders/${order.id}/reject`, { method: 'POST', body: { reason: reason.trim() } });
            }, `${order.order_no} rejected and returned to the Cutting Supervisor`)}>Reject Batch</button>
            <button className="btn btn-success" disabled={!canApprove} title={anyRed ? 'Blocked: shortage detected' : ''} onClick={() => run(async () => {
              await api(`/orders/${order.id}/counts`, { method: 'PUT', body: payload() });
              await api(`/orders/${order.id}/approve`, { method: 'POST', body: { note: note.trim() || undefined } });
            }, `${order.order_no} verified and released to the Sewing Queue`)}>Approve Batch</button>
          </div>
        </>
      )}
    </div>
  );
}