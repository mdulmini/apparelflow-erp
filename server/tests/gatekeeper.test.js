import { describe, it, expect, beforeEach } from 'vitest';
import { setup, makeOrder, countAll } from './helpers.js';

let ctx;
beforeEach(async () => { ctx = await setup(); });

describe('Required test 1 - all GREEN order can be approved by a Verifier', () => {
  it('approves, stamps verifier + timestamp + wastage', async () => {
    const order = await makeOrder(ctx);
    expect(order.status).toBe('PENDING_VERIFICATION');
    expect(order.items.map((i) => i.expected_qty)).toEqual([50, 50, 100, 50, 100]);

    const saved = await ctx.ver('put', `/api/orders/${order.id}/counts`).send(countAll(order));
    expect(saved.status).toBe(200);
    expect(saved.body.items.every((i) => i.status === 'GREEN')).toBe(true);

    const res = await ctx.ver('post', `/api/orders/${order.id}/approve`).send({ note: 'All bundles tallied' });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('VERIFIED');
    expect(res.body.verification.verifier_name).toContain('Kasun');
    expect(res.body.verification.timestamp).toBeTruthy();
    expect(res.body.verification.wastage_pct).toBe(5);
    expect(res.body.verification.variance_snapshot).toHaveLength(5);
  });

  it('YELLOW (excess) may still be approved', async () => {
    const order = await makeOrder(ctx);
    await ctx.ver('put', `/api/orders/${order.id}/counts`).send(countAll(order, (i) => i.expected_qty + 2));
    const res = await ctx.ver('post', `/api/orders/${order.id}/approve`).send({});
    expect(res.status).toBe(200);
  });
});

describe('Required test 2 - a RED (shortage) component blocks approval', () => {
  it('returns 422 and the order stays PENDING_VERIFICATION', async () => {
    const order = await makeOrder(ctx);
    const counts = countAll(order);
    counts.counts[2].actual_qty = 99;
    const saved = await ctx.ver('put', `/api/orders/${order.id}/counts`).send(counts);
    expect(saved.body.items[2].status).toBe('RED');

    const res = await ctx.ver('post', `/api/orders/${order.id}/approve`).send({});
    expect(res.status).toBe(422);
    expect(res.body.details.red[0]).toMatchObject({ expected: 100, actual: 99 });

    const after = await ctx.ver('get', `/api/orders/${order.id}`);
    expect(after.body.status).toBe('PENDING_VERIFICATION');
  });

  it('returns 422 when components are uncounted or only partly counted', async () => {
    const order = await makeOrder(ctx);
    expect((await ctx.ver('post', `/api/orders/${order.id}/approve`).send({})).status).toBe(422);
    await ctx.ver('put', `/api/orders/${order.id}/counts`).send({ counts: [{ component_id: order.items[0].component_id, actual_qty: 50 }] });
    expect((await ctx.ver('post', `/api/orders/${order.id}/approve`).send({})).status).toBe(422);
  });

  it('a client-supplied "status: GREEN" cannot override the server calculation', async () => {
    const order = await makeOrder(ctx);
    const body = { counts: order.items.map((i) => ({ component_id: i.component_id, actual_qty: 1, status: 'GREEN' })) };
    const saved = await ctx.ver('put', `/api/orders/${order.id}/counts`).send(body);
    expect(saved.body.items.every((i) => i.status === 'RED')).toBe(true);
  });
});

describe('Required test 3 - rejection requires a reason', () => {
  it('rejects empty / whitespace / missing reasons with 400', async () => {
    const order = await makeOrder(ctx);
    for (const body of [{}, { reason: '' }, { reason: '    ' }, { reason: 42 }]) {
      const res = await ctx.ver('post', `/api/orders/${order.id}/reject`).send(body);
      expect(res.status).toBe(400);
    }
    expect((await ctx.ver('get', `/api/orders/${order.id}`)).body.status).toBe('PENDING_VERIFICATION');
  });

  it('accepts a valid reason, returns to the supervisor, and allows re-submission', async () => {
    const order = await makeOrder(ctx);
    const res = await ctx.ver('post', `/api/orders/${order.id}/reject`).send({ reason: 'Collar shortage, re-cut required' });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('REJECTED');
    expect(res.body.verification.rejection_note).toMatch(/Collar/);

    const again = await ctx.sup('post', `/api/orders/${order.id}/submit`).send({ actual_fabric_yds: 96 });
    expect(again.status).toBe(200);
    expect(again.body.status).toBe('PENDING_VERIFICATION');
    expect(again.body.items.every((i) => i.actual_qty === null)).toBe(true);
    expect(again.body.rejection_count).toBe(1);
  });
});

describe('Required test 4 - non-verifier roles get 403', () => {
  it('supervisor and sewing supervisor cannot approve, reject or count', async () => {
    const order = await makeOrder(ctx);
    await ctx.ver('put', `/api/orders/${order.id}/counts`).send(countAll(order));
    for (const who of ['sup', 'sew']) {
      expect((await ctx[who]('post', `/api/orders/${order.id}/approve`).send({})).status).toBe(403);
      expect((await ctx[who]('post', `/api/orders/${order.id}/reject`).send({ reason: 'nope nope' })).status).toBe(403);
      expect((await ctx[who]('put', `/api/orders/${order.id}/counts`).send(countAll(order))).status).toBe(403);
    }
    expect((await ctx.ver('get', `/api/orders/${order.id}`)).body.status).toBe('PENDING_VERIFICATION');
  });

  it('unauthenticated and forged-token requests get 401', async () => {
    const order = await makeOrder(ctx);
    expect((await ctx.api.post(`/api/orders/${order.id}/approve`).send({})).status).toBe(401);
    expect((await ctx.api.post(`/api/orders/${order.id}/approve`).set('Authorization', 'Bearer abc.def.ghi').send({})).status).toBe(401);
  });

  it('verifier cannot create orders', async () => {
    expect((await ctx.ver('post', '/api/orders').send({ recipe_id: 1, target_qty: 5, fabric_roll_id: 'FAB-1', actual_fabric_yds: 9 })).status).toBe(403);
  });

  it('verifier identity comes from the token, not the request body', async () => {
    const order = await makeOrder(ctx);
    await ctx.ver('put', `/api/orders/${order.id}/counts`).send(countAll(order));
    const res = await ctx.ver('post', `/api/orders/${order.id}/approve`).send({ verifier_id: 1, timestamp: '1999-01-01T00:00:00Z' });
    expect(res.body.verification.verifier_name).toContain('Kasun');
    expect(res.body.verification.timestamp.startsWith('1999')).toBe(false);
  });
});

describe('Extra coverage - validation, state machine, immutability', () => {
  it('rejects negative, decimal, string and empty payloads on order creation', async () => {
    const ok = { recipe_id: 1, target_qty: 10, fabric_roll_id: 'FAB-ROLL-1', actual_fabric_yds: 20 };
    const bad = [{ target_qty: -5 }, { target_qty: 5.5 }, { target_qty: '50' }, { target_qty: 0 }, { actual_fabric_yds: -1 },
      { actual_fabric_yds: 'abc' }, { actual_fabric_yds: 1.234 }, { fabric_roll_id: '' }, { recipe_id: null }];
    for (const patch of bad) expect((await ctx.sup('post', '/api/orders').send({ ...ok, ...patch })).status).toBe(400);
    expect((await ctx.sup('post', '/api/orders').send({})).status).toBe(400);
    expect((await ctx.sup('post', '/api/orders').send(ok)).status).toBe(201);
  });

  it('rejects invalid counts (negative, decimal, string, foreign component)', async () => {
    const order = await makeOrder(ctx);
    const cid = order.items[0].component_id;
    for (const actual_qty of [-1, 2.5, '10', null]) {
      expect((await ctx.ver('put', `/api/orders/${order.id}/counts`).send({ counts: [{ component_id: cid, actual_qty }] })).status).toBe(400);
    }
    expect((await ctx.ver('put', `/api/orders/${order.id}/counts`).send({ counts: [{ component_id: 9999, actual_qty: 1 }] })).status).toBe(400);
    expect((await ctx.ver('put', `/api/orders/${order.id}/counts`).send({})).status).toBe(400);
  });

  it('a zero count is a RED shortage, not "missing"', async () => {
    const order = await makeOrder(ctx);
    const saved = await ctx.ver('put', `/api/orders/${order.id}/counts`).send({ counts: [{ component_id: order.items[0].component_id, actual_qty: 0 }] });
    expect(saved.body.items[0].status).toBe('RED');
  });

  it('cannot approve twice, cannot recount after approval, cannot skip states', async () => {
    const order = await makeOrder(ctx);
    await ctx.ver('put', `/api/orders/${order.id}/counts`).send(countAll(order));
    expect((await ctx.ver('post', `/api/orders/${order.id}/approve`).send({})).status).toBe(200);
    expect((await ctx.ver('post', `/api/orders/${order.id}/approve`).send({})).status).toBe(409);
    expect((await ctx.ver('post', `/api/orders/${order.id}/reject`).send({ reason: 'changed my mind' })).status).toBe(409);
    expect((await ctx.ver('put', `/api/orders/${order.id}/counts`).send(countAll(order, () => 0))).status).toBe(409);
    expect((await ctx.sup('post', `/api/orders/${order.id}/submit`).send({})).status).toBe(409);
  });

  it('database triggers make audit logs and verified counts immutable', async () => {
    const order = await makeOrder(ctx);
    await ctx.ver('put', `/api/orders/${order.id}/counts`).send(countAll(order));
    await ctx.ver('post', `/api/orders/${order.id}/approve`).send({});
    await expect(ctx.db('verification_logs').where({ order_id: order.id }).update({ wastage_pct: 0 })).rejects.toThrow(/append-only/);
    await expect(ctx.db('verification_logs').where({ order_id: order.id }).del()).rejects.toThrow(/append-only/);
    await expect(ctx.db('verification_items').where({ order_id: order.id }).update({ actual_qty: 0 })).rejects.toThrow(/immutable/);
  });

  it('data persists in the database (survives a new app instance on the same DB)', async () => {
    const order = await makeOrder(ctx);
    const { createApp } = await import('../src/app.js');
    const request = (await import('supertest')).default;
    const app2 = request(createApp(ctx.db, { jwtSecret: 'test-secret' }));
    const res = await app2.get(`/api/orders/${order.id}`).set('Authorization', `Bearer ${ctx.tokens.cutting_verifier}`);
    expect(res.body.order_no).toBe(order.order_no);
  });
});