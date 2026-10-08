import { Router } from 'express';
import { HttpError, wrap } from '../errors.js';
import { STATUS } from '../domain.js';
import { hydrate, assertTransition } from '../orders.js';

export function sewingRouter(db, { authenticate, requireRole }) {
  const r = Router();
  r.use(authenticate, requireRole('sewing_supervisor'));

  // Query isolation: the status filter is hard-coded in SQL. No request parameter can widen it.
  r.get('/queue', wrap(async (_req, res) => {
    const rows = await db('cutting_orders').where('status', STATUS.VERIFIED).orderBy('updated_at', 'asc');
    res.json(await hydrate(db, rows));
  }));

  r.get('/in-progress', wrap(async (_req, res) => {
    const rows = await db('cutting_orders').where('status', STATUS.IN_SEWING).orderBy('sewing_started_at', 'desc');
    res.json(await hydrate(db, rows));
  }));

  r.get('/queue/:id', wrap(async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) throw new HttpError(400, 'Invalid order id');
    const row = await db('cutting_orders').where({ id }).whereIn('status', [STATUS.VERIFIED, STATUS.IN_SEWING]).first();
    if (!row) throw new HttpError(404, 'Order not found in sewing queue'); // same answer for "missing" and "not verified"
    res.json((await hydrate(db, [row]))[0]);
  }));

  r.post('/:id/start', wrap(async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) throw new HttpError(400, 'Invalid order id');
    const order = await db('cutting_orders').where({ id }).whereIn('status', [STATUS.VERIFIED, STATUS.IN_SEWING]).first();
    if (!order) throw new HttpError(404, 'Order not found in sewing queue');
    assertTransition(order.status, STATUS.IN_SEWING);
    const n = await db('cutting_orders').where({ id, status: STATUS.VERIFIED })
      .update({ status: STATUS.IN_SEWING, sewing_started_by: req.user.id, sewing_started_at: new Date(), updated_at: new Date() });
    if (n !== 1) throw new HttpError(409, 'Order state changed, please refresh');
    res.json((await hydrate(db, [await db('cutting_orders').where({ id }).first()]))[0]);
  }));

  return r;
}