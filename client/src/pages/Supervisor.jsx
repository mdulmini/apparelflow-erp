import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { api, describeError } from '../api.js';
import { Banner, Field, Modal, StatusBadge, Light } from '../ui.jsx';
import { validateInt, validateYards, validateRoll, fmt } from '../validators.js';

export default function Supervisor() {
  const [orders, setOrders] = useState([]);
  const [recipes, setRecipes] = useState([]);
  const [open, setOpen] = useState(false);
  const [detail, setDetail] = useState(null);
  const [err, setErr] = useState('');
  const [ok, setOk] = useState('');

  const load = useCallback(async () => {
    try { setOrders(await api('/orders')); setErr(''); } catch (e) { setErr(describeError(e)); }
  }, []);
  useEffect(() => { load(); api('/recipes').then(setRecipes).catch((e) => setErr(describeError(e))); }, [load]);

  const act = async (fn, msg) => {
    try { await fn(); setOk(msg); setErr(''); await load(); } catch (e) { setErr(describeError(e)); setOk(''); }
  };

  return (
    <section>
      <div className="page-head">
        <div><h1>Cutting Orders</h1><p className="muted">Create batches from recipes. A verifier must sign off before sewing.</p></div>
        <button className="btn btn-primary" onClick={() => setOpen(true)}>+ New Cutting Order</button>
      </div>
      <Banner>{err}</Banner><Banner kind="ok">{ok}</Banner>
      <div className="card table-wrap">
        <table>
          <thead><tr><th>Order</th><th>Recipe</th><th>Qty</th><th>Fabric roll</th><th>Yards</th><th>Status</th><th>Updated</th><th /></tr></thead>
          <tbody>
            {orders.length === 0 && <tr><td colSpan="8" className="empty">No cutting orders yet.</td></tr>}
            {orders.map((o) => (
              <tr key={o.id}>
                <td><strong>{o.order_no}</strong></td>
                <td>{o.recipe.name} <small className="muted">{o.recipe.recipe_code}</small></td>
                <td>{o.target_qty}</td><td>{o.fabric_roll_id}</td><td>{o.actual_fabric_yds}</td>
                <td>
                  <StatusBadge status={o.status} />
                  {o.status === 'REJECTED' && <div className="reject-note"><strong>Reason:</strong> {o.verification?.rejection_note}</div>}
                </td>
                <td>{fmt(o.updated_at)}</td>
                <td className="actions">
                  <button className="btn btn-ghost" onClick={() => setDetail(o)}>View</button>
                  {o.status === 'CUTTING_IN_PROGRESS' && <button className="btn btn-secondary" onClick={() => act(() => api(`/orders/${o.id}/submit`, { method: 'POST', body: {} }), `${o.order_no} submitted for verification`)}>Submit</button>}
                  {o.status === 'REJECTED' && <ResubmitButton order={o} act={act} />}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {open && <NewOrderModal recipes={recipes} onClose={() => setOpen(false)} onCreated={(o) => { setOpen(false); setOk(`${o.order_no} created`); load(); }} />}
      {detail && (
        <Modal title={`${detail.order_no} - ${detail.recipe.name}`} onClose={() => setDetail(null)}>
          <p className="muted">Target {detail.target_qty} garments · expected fabric {detail.expected_fabric_yds} yds · used {detail.actual_fabric_yds} yds</p>
          <table><thead><tr><th>Component</th><th>Expected</th><th>Counted</th><th>Flag</th></tr></thead>
            <tbody>{detail.items.map((i) => <tr key={i.component_id}><td>{i.component_name}</td><td>{i.expected_qty}</td><td>{i.actual_qty ?? '-'}</td><td><Light status={i.status} /></td></tr>)}</tbody></table>
        </Modal>
      )}
    </section>
  );
}

function ResubmitButton({ order, act }) {
  const [show, setShow] = useState(false);
  const [yds, setYds] = useState(String(order.actual_fabric_yds));
  const err = validateYards(yds);
  return (
    <>
      <button className="btn btn-secondary" onClick={() => setShow(true)}>Re-submit</button>
      {show && (
        <Modal title={`Re-submit ${order.order_no}`} onClose={() => setShow(false)}>
          <p className="muted">After re-cutting, update the total fabric used and send the batch back to QC.</p>
          <Field label="Actual fabric used (yards)" id={`yds-${order.id}`} error={err}>
            <input id={`yds-${order.id}`} inputMode="decimal" value={yds} onChange={(e) => setYds(e.target.value)} />
          </Field>
          <button className="btn btn-primary" disabled={!!err} onClick={() => { setShow(false); act(() => api(`/orders/${order.id}/submit`, { method: 'POST', body: { actual_fabric_yds: Number(yds) } }), `${order.order_no} re-submitted`); }}>Re-submit for verification</button>
        </Modal>
      )}
    </>
  );
}

function NewOrderModal({ recipes, onClose, onCreated }) {
  const [f, setF] = useState({ recipe_id: '', target_qty: '', fabric_roll_id: '', actual_fabric_yds: '' });
  const [touched, setTouched] = useState({});
  const [serverErr, setServerErr] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF((p) => ({ ...p, [k]: e.target.value }));
  const blur = (k) => () => setTouched((t) => ({ ...t, [k]: true }));

  const errors = useMemo(() => ({
    recipe_id: f.recipe_id ? null : 'Select a recipe',
    target_qty: validateInt(f.target_qty, { min: 1, max: 100000, label: 'Target quantity' }),
    fabric_roll_id: validateRoll(f.fabric_roll_id),
    actual_fabric_yds: validateYards(f.actual_fabric_yds),
  }), [f]);
  const valid = Object.values(errors).every((e) => !e);
  const recipe = recipes.find((r) => String(r.id) === f.recipe_id);
  const qtyOk = !errors.target_qty;
  const show = (k) => (touched[k] ? errors[k] : null);

  const submit = async (submitNow) => {
    setTouched({ recipe_id: true, target_qty: true, fabric_roll_id: true, actual_fabric_yds: true });
    if (!valid) return;
    setBusy(true); setServerErr('');
    try {
      const o = await api('/orders', { method: 'POST', body: { recipe_id: Number(f.recipe_id), target_qty: Number(f.target_qty), fabric_roll_id: f.fabric_roll_id.trim(), actual_fabric_yds: Number(f.actual_fabric_yds), submit: submitNow } });
      onCreated(o);
    } catch (e) { setServerErr(describeError(e)); } finally { setBusy(false); }
  };

  return (
    <Modal title="New Cutting Order" onClose={onClose}>
      <Field label="Production recipe" id="recipe" error={show('recipe_id')}>
        <select id="recipe" value={f.recipe_id} onChange={set('recipe_id')} onBlur={blur('recipe_id')}>
          <option value="">Select a recipe...</option>
          {recipes.map((r) => <option key={r.id} value={r.id}>{r.recipe_code} - {r.name}</option>)}
        </select>
      </Field>
      <div className="grid2">
        <Field label="Target batch quantity (garments)" id="qty" error={show('target_qty')}>
          <input id="qty" inputMode="numeric" placeholder="e.g. 50" value={f.target_qty} onChange={set('target_qty')} onBlur={blur('target_qty')} />
        </Field>
        <Field label="Fabric roll ID" id="roll" error={show('fabric_roll_id')}>
          <input id="roll" placeholder="e.g. FAB-ROLL-882" value={f.fabric_roll_id} onChange={set('fabric_roll_id')} onBlur={blur('fabric_roll_id')} />
        </Field>
      </div>
      <Field label="Actual fabric used (yards)" id="yds" error={show('actual_fabric_yds')} hint={recipe && qtyOk ? `Expected: ${(recipe.std_fabric_yards * Number(f.target_qty)).toFixed(2)} yds (cap ${recipe.wastage_cap}% wastage)` : null}>
        <input id="yds" inputMode="decimal" placeholder="e.g. 94.5" value={f.actual_fabric_yds} onChange={set('actual_fabric_yds')} onBlur={blur('actual_fabric_yds')} />
      </Field>

      {recipe && (
        <div className="preview">
          <strong>Expected component counts</strong>
          <table><thead><tr><th>Component</th><th>Per garment</th><th>Expected cut pieces</th></tr></thead>
            <tbody>{recipe.components.map((c) => <tr key={c.id}><td>{c.component_name}</td><td>{c.pieces_per_garment}</td><td><strong>{qtyOk ? c.pieces_per_garment * Number(f.target_qty) : '-'}</strong></td></tr>)}</tbody></table>
        </div>
      )}
      <Banner>{serverErr}</Banner>
      <div className="modal-actions">
        <button className="btn btn-secondary" disabled={busy} onClick={() => submit(false)}>Save as draft</button>
        <button className="btn btn-primary" disabled={busy} onClick={() => submit(true)}>Submit for verification</button>
      </div>
    </Modal>
  );
}