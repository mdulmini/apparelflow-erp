import { Router } from 'express';
import { HttpError, wrap } from '../errors.js';
import { STATUS, itemStatus, wastagePct, expectedFabric, isPositiveInt, isNonNegInt, isYards, isRollId } from '../domain.js';
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

    // ---- Verifier: record physical counts (server computes the traffic light) ----
    r.put('/orders/:id/counts', requireRole('cutting_verifier'), wrap(async (req, res) => {
      const id = parseId(req);
      const counts = req.body?.counts;
      if (!Array.isArray(counts) || counts.length === 0) throw new HttpError(400, 'counts must be a non-empty array');
      const seen = new Set();
      const errors = {};
      for (const c of counts) {
        if (!c || !isPositiveInt(c.component_id)) { errors.component_id = 'Invalid component_id'; continue; }
        if (seen.has(c.component_id)) errors[`c${c.component_id}`] = 'Duplicate component';
        seen.add(c.component_id);
        if (!isNonNegInt(c.actual_qty)) errors[`c${c.component_id}`] = 'Count must be a whole number >= 0';
      }
      if (Object.keys(errors).length) throw new HttpError(400, 'Validation failed', errors);
  
      await db.transaction(async (trx) => {
        const order = await trx('cutting_orders').where({ id }).first();
        if (!order || order.status === STATUS.CUTTING_IN_PROGRESS) throw new HttpError(404, 'Order not found');
        if (order.status !== STATUS.PENDING_VERIFICATION) throw new HttpError(409, 'Counts can only be recorded while the order is PENDING_VERIFICATION');
        const items = await trx('verification_items').where({ order_id: id });
        for (const c of counts) {
          const item = items.find((i) => i.component_id === c.component_id);
          if (!item) throw new HttpError(400, `Component ${c.component_id} does not belong to this order`);
          await trx('verification_items').where({ id: item.id }).update({
            actual_qty: c.actual_qty,
            status: itemStatus(item.expected_qty, c.actual_qty), // computed here, client status ignored
          });
        }
      });
      res.json((await hydrate(db, [await db('cutting_orders').where({ id }).first()]))[0]);
    }));
  
    // ---- Verifier: APPROVE (hard stop) ----
    r.post('/orders/:id/approve', requireRole('cutting_verifier'), wrap(async (req, res) => {
      const id = parseId(req);
      const note = req.body?.note;
      if (note !== undefined && (typeof note !== 'string' || note.length > 500)) throw new HttpError(400, 'note must be a string up to 500 characters');
  
      await db.transaction(async (trx) => {
        const order = await trx('cutting_orders').where({ id }).first();
        if (!order || order.status === STATUS.CUTTING_IN_PROGRESS) throw new HttpError(404, 'Order not found');
        assertTransition(order.status, STATUS.VERIFIED);
  
        const items = await trx('verification_items as vi').join('recipe_components as rc', 'rc.id', 'vi.component_id')
          .where('vi.order_id', id).select('vi.*', 'rc.component_name');
        const uncounted = items.filter((i) => i.actual_qty === null || i.actual_qty === undefined);
        if (items.length === 0 || uncounted.length) {
          throw new HttpError(422, 'Approval blocked: every component must be counted', { uncounted: uncounted.map((i) => i.component_name) });
        }
        // Re-derive status from raw numbers; never trust the stored flag.
        const red = items.filter((i) => itemStatus(i.expected_qty, i.actual_qty) === 'RED');
        if (red.length) {
          throw new HttpError(422, 'Approval blocked: shortage detected (RED). Reject the batch for re-cutting.', {
            red: red.map((i) => ({ component: i.component_name, expected: i.expected_qty, actual: i.actual_qty })),
          });
        }
        const recipe = await trx('recipes').where({ id: order.recipe_id }).first();
        const wp = wastagePct(num(order.actual_fabric_yds), expectedFabric(num(recipe.std_fabric_yards), order.target_qty));
        const updated = await trx('cutting_orders').where({ id, status: STATUS.PENDING_VERIFICATION }).update({ status: STATUS.VERIFIED, updated_at: new Date() });
        if (updated !== 1) throw new HttpError(409, 'Order state changed, please refresh');
        await trx('verification_logs').insert({
          order_id: id,
          verifier_id: req.user.id, // from the login token, never from the request body
          decision: 'APPROVED',
          rejection_note: null,
          audit_note: note?.trim() || null,
          wastage_pct: wp,
          variance_snapshot: JSON.stringify(items.map((i) => ({ component_id: i.component_id, component_name: i.component_name, expected: i.expected_qty, actual: i.actual_qty, status: itemStatus(i.expected_qty, i.actual_qty), variance: i.actual_qty - i.expected_qty }))),
          timestamp: new Date(), // server clock
        });
      });
      res.json((await hydrate(db, [await db('cutting_orders').where({ id }).first()]))[0]);
    }));
  
    // ---- Verifier: REJECT (mandatory reason) ----
    r.post('/orders/:id/reject', requireRole('cutting_verifier'), wrap(async (req, res) => {
      const id = parseId(req);
      const reason = typeof req.body?.reason === 'string' ? req.body.reason.trim() : '';
      if (reason.length < 5 || reason.length > 500) throw new HttpError(400, 'Validation failed', { reason: 'A rejection reason of 5-500 characters is mandatory' });
  
      await db.transaction(async (trx) => {
        const order = await trx('cutting_orders').where({ id }).first();
        if (!order || order.status === STATUS.CUTTING_IN_PROGRESS) throw new HttpError(404, 'Order not found');
        assertTransition(order.status, STATUS.REJECTED);
        const items = await trx('verification_items as vi').join('recipe_components as rc', 'rc.id', 'vi.component_id')
          .where('vi.order_id', id).select('vi.*', 'rc.component_name');
        const recipe = await trx('recipes').where({ id: order.recipe_id }).first();
        const wp = wastagePct(num(order.actual_fabric_yds), expectedFabric(num(recipe.std_fabric_yards), order.target_qty));
        const updated = await trx('cutting_orders').where({ id, status: STATUS.PENDING_VERIFICATION }).update({ status: STATUS.REJECTED, updated_at: new Date() });
        if (updated !== 1) throw new HttpError(409, 'Order state changed, please refresh');
        await trx('verification_logs').insert({
          order_id: id, verifier_id: req.user.id, decision: 'REJECTED', rejection_note: reason, audit_note: null, wastage_pct: wp,
          variance_snapshot: JSON.stringify(items.map((i) => ({ component_id: i.component_id, component_name: i.component_name, expected: i.expected_qty, actual: i.actual_qty, status: itemStatus(i.expected_qty, i.actual_qty), variance: i.actual_qty == null ? null : i.actual_qty - i.expected_qty }))),
          timestamp: new Date(),
        });
      });
      res.json((await hydrate(db, [await db('cutting_orders').where({ id }).first()]))[0]);
    }));

  return r;
} 