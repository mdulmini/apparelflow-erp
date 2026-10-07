import { HttpError } from './errors.js';
import { STATUS, canTransition, itemStatus, expectedQty, expectedFabric, wastagePct, round2 } from './domain.js';

export const iso = (v) => (v == null ? null : new Date(v).toISOString());
const num = (v) => (v == null ? v : Number(v)); // Postgres returns DECIMAL as a string

export function assertTransition(from, to) {
  if (!canTransition(from, to)) throw new HttpError(409, `Illegal state transition ${from} -> ${to}`);
}

/** Attach recipe, creator, items and the latest verification log to a list of order rows. */
export async function hydrate(db, orders) {
  if (!orders.length) return [];
  const ids = orders.map((o) => o.id);
  const recipes = await db('recipes').whereIn('id', [...new Set(orders.map((o) => o.recipe_id))]);
  const users = await db('users').whereIn('id', [...new Set(orders.flatMap((o) => [o.created_by, o.sewing_started_by].filter(Boolean)))]);
  const items = await db('verification_items as vi')
    .join('recipe_components as rc', 'rc.id', 'vi.component_id')
    .whereIn('vi.order_id', ids)
    .select('vi.order_id', 'vi.component_id', 'vi.expected_qty', 'vi.actual_qty', 'vi.status',
      'rc.component_name', 'rc.pieces_per_garment', 'rc.image_url')
    .orderBy('vi.id');
  const logs = await db('verification_logs as vl')
    .join('users as u', 'u.id', 'vl.verifier_id')
    .whereIn('vl.order_id', ids)
    .select('vl.*', 'u.full_name as verifier_name')
    .orderBy('vl.id', 'desc');

  return orders.map((o) => {
    const recipe = recipes.find((r) => r.id === o.recipe_id);
    const std = num(recipe.std_fabric_yards);
    const expFabric = expectedFabric(std, o.target_qty);
    const orderLogs = logs.filter((l) => l.order_id === o.id);
    const last = orderLogs[0];
    return {
      id: o.id,
      order_no: o.order_no,
      status: o.status,
      target_qty: o.target_qty,
      fabric_roll_id: o.fabric_roll_id,
      actual_fabric_yds: num(o.actual_fabric_yds),
      expected_fabric_yds: expFabric,
      live_wastage_pct: wastagePct(num(o.actual_fabric_yds), expFabric),
      recipe: { id: recipe.id, recipe_code: recipe.recipe_code, name: recipe.name, category: recipe.category, std_fabric_yards: std, wastage_cap: num(recipe.wastage_cap) },
      created_by_name: users.find((u) => u.id === o.created_by)?.full_name,
      created_at: iso(o.created_at),
      updated_at: iso(o.updated_at),
      sewing_started_at: iso(o.sewing_started_at),
      sewing_started_by_name: users.find((u) => u.id === o.sewing_started_by)?.full_name || null,
      items: items.filter((i) => i.order_id === o.id).map((i) => ({
        component_id: i.component_id,
        component_name: i.component_name,
        pieces_per_garment: i.pieces_per_garment,
        image_url: i.image_url,
        expected_qty: i.expected_qty,
        actual_qty: i.actual_qty,
        status: i.status,
        variance: i.actual_qty == null ? null : i.actual_qty - i.expected_qty,
      })),
      verification: last && {
        decision: last.decision,
        verifier_id: last.verifier_id,
        verifier_name: last.verifier_name,
        rejection_note: last.rejection_note,
        audit_note: last.audit_note,
        wastage_pct: num(last.wastage_pct),
        timestamp: iso(last.timestamp),
        variance_snapshot: JSON.parse(last.variance_snapshot),
      },
      rejection_count: orderLogs.filter((l) => l.decision === 'REJECTED').length,
    };
  });
}

/** Multiplier engine: one verification_items row per recipe component. expected = pieces_per_garment x target_qty */
export async function buildItems(trx, orderId, recipeId, targetQty) {
  const comps = await trx('recipe_components').where({ recipe_id: recipeId }).orderBy('id');
  if (!comps.length) throw new HttpError(422, 'Recipe has no components');
  await trx('verification_items').insert(
    comps.map((c) => ({ order_id: orderId, component_id: c.id, expected_qty: expectedQty(c.pieces_per_garment, targetQty), actual_qty: null, status: null })),
  );
}

export { STATUS, itemStatus, wastagePct, round2, expectedFabric };