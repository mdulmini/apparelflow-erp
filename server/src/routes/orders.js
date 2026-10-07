import { Router } from 'express';
import { HttpError, wrap } from '../errors.js';
import { STATUS, isPositiveInt, isYards, isRollId } from '../domain.js';
import { hydrate, assertTransition, buildItems } from '../orders.js';

const num = (v) => Number(v);

function parseId(req) {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) throw new HttpError(400, 'Invalid order id');
  return id;
}

export function ordersRouter(db, { authenticate, requireRole }) {
  const r = Router();
  r.use(authenticate);

  // ---- Recipes (read-only for both cutting roles; sewing has no business here) ----
  r.get('/recipes', requireRole('cutting_supervisor', 'cutting_verifier'), wrap(async (_req, res) => {
    const recipes = await db('recipes').orderBy('id');
    const comps = await db('recipe_components').orderBy('id');
    res.json(recipes.map((x) => ({
      id: x.id, recipe_code: x.recipe_code, name: x.name, category: x.category,
      std_fabric_yards: num(x.std_fabric_yards), wastage_cap: num(x.wastage_cap),
      components: comps.filter((c) => c.recipe_id === x.id).map((c) => ({ id: c.id, component_name: c.component_name, pieces_per_garment: c.pieces_per_garment, image_url: c.image_url })),
    })));
  }));

  // ---- List ----
  r.get('/orders', requireRole('cutting_supervisor', 'cutting_verifier'), wrap(async (req, res) => {
    let q = db('cutting_orders').orderBy('id', 'desc').limit(200);
    // Verifier never sees drafts still on the cutting table.
    if (req.user.role === 'cutting_verifier') q = q.whereNot('status', STATUS.CUTTING_IN_PROGRESS);
    res.json(await hydrate(db, await q));
  }));

  r.get('/orders/:id', requireRole('cutting_supervisor', 'cutting_verifier'), wrap(async (req, res) => {
    const row = await db('cutting_orders').where({ id: parseId(req) }).first();
    if (!row || (req.user.role === 'cutting_verifier' && row.status === STATUS.CUTTING_IN_PROGRESS)) throw new HttpError(404, 'Order not found');
    res.json((await hydrate(db, [row]))[0]);
  }));

  // ---- Supervisor: create order (multiplier engine) ----
  r.post('/orders', requireRole('cutting_supervisor'), wrap(async (req, res) => {
    const { recipe_id, target_qty, fabric_roll_id, actual_fabric_yds, submit = true } = req.body || {};
    const errors = {};
    if (!isPositiveInt(recipe_id)) errors.recipe_id = 'Select a recipe';
    if (!isPositiveInt(target_qty, 100000)) errors.target_qty = 'Target quantity must be a whole number between 1 and 100000';
    if (!isRollId(fabric_roll_id)) errors.fabric_roll_id = 'Fabric roll ID must be 3-40 letters, digits or hyphens (e.g. FAB-ROLL-882)';
    if (!isYards(actual_fabric_yds)) errors.actual_fabric_yds = 'Fabric used must be a positive number with at most 2 decimals';
    if (typeof submit !== 'boolean') errors.submit = 'submit must be true or false';
    if (Object.keys(errors).length) throw new HttpError(400, 'Validation failed', errors);

    const recipe = await db('recipes').where({ id: recipe_id }).first();
    if (!recipe) throw new HttpError(400, 'Validation failed', { recipe_id: 'Unknown recipe' });

    const id = await db.transaction(async (trx) => {
      const [ins] = await trx('cutting_orders').insert({
        order_no: `TMP-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        recipe_id, target_qty, fabric_roll_id, actual_fabric_yds,
        status: submit ? STATUS.PENDING_VERIFICATION : STATUS.CUTTING_IN_PROGRESS,
        created_by: req.user.id, // from JWT, never from body
        created_at: new Date(), updated_at: new Date(),
      }).returning('id');
      const newId = typeof ins === 'object' ? ins.id : ins;
      await trx('cutting_orders').where({ id: newId }).update({ order_no: `CO-${new Date().getFullYear()}-${String(newId).padStart(4, '0')}` });
      await buildItems(trx, newId, recipe_id, target_qty);
      return newId;
    });
    res.status(201).json((await hydrate(db, [await db('cutting_orders').where({ id }).first()]))[0]);
  }));

  // ---- Supervisor: submit a draft / resubmit a rejected order ----
  r.post('/orders/:id/submit', requireRole('cutting_supervisor'), wrap(async (req, res) => {
    const id = parseId(req);
    const order = await db('cutting_orders').where({ id }).first();
    if (!order) throw new HttpError(404, 'Order not found');
    assertTransition(order.status, STATUS.PENDING_VERIFICATION);

    const patch = { status: STATUS.PENDING_VERIFICATION, updated_at: new Date() };
    if (req.body?.actual_fabric_yds !== undefined) {
      if (!isYards(req.body.actual_fabric_yds)) throw new HttpError(400, 'Validation failed', { actual_fabric_yds: 'Fabric used must be a positive number with at most 2 decimals' });
      patch.actual_fabric_yds = req.body.actual_fabric_yds;
    }
    await db.transaction(async (trx) => {
      const n = await trx('cutting_orders').where({ id, status: order.status }).update(patch);
      if (n !== 1) throw new HttpError(409, 'Order state changed, please refresh');
      // Re-cut batch must be re-counted from scratch.
      await trx('verification_items').where({ order_id: id }).update({ actual_qty: null, status: null });
    });
    res.json((await hydrate(db, [await db('cutting_orders').where({ id }).first()]))[0]);
  }));

  // Day 3 adds here: PUT /orders/:id/counts, POST /orders/:id/approve, POST /orders/:id/reject

  return r;
} 