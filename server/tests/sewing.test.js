import { describe, it, expect, beforeEach } from 'vitest';
import { setup, makeOrder, countAll } from './helpers.js';

let ctx;
beforeEach(async () => { ctx = await setup(); });

describe('Required test 5 - unapproved orders never appear in the Sewing Queue', () => {
  it('only VERIFIED orders are visible, regardless of query params', async () => {
    const pending = await makeOrder(ctx);
    const rejected = await makeOrder(ctx);
    const draft = (await ctx.sup('post', '/api/orders').send({ recipe_id: pending.recipe.id, target_qty: 5, fabric_roll_id: 'FAB-DRAFT', actual_fabric_yds: 10, submit: false })).body;
    expect(draft.status).toBe('CUTTING_IN_PROGRESS');
    await ctx.ver('post', `/api/orders/${rejected.id}/reject`).send({ reason: 'Fabric defect found' });
    const good = await makeOrder(ctx);
    await ctx.ver('put', `/api/orders/${good.id}/counts`).send(countAll(good));
    await ctx.ver('post', `/api/orders/${good.id}/approve`).send({});

    const queue = await ctx.sew('get', '/api/sewing/queue?status=PENDING_VERIFICATION&all=true');
    expect(queue.status).toBe(200);
    expect(queue.body.map((o) => o.id)).toEqual([good.id]);

    for (const o of [pending, rejected, draft]) {
      expect((await ctx.sew('get', `/api/sewing/queue/${o.id}`)).status).toBe(404);
      expect((await ctx.sew('post', `/api/sewing/${o.id}/start`)).status).toBe(404);
    }
    expect((await ctx.sew('get', '/api/orders')).status).toBe(403);
    expect((await ctx.sew('get', `/api/orders/${pending.id}`)).status).toBe(403);
  });

  it('supervisor and verifier cannot access the sewing queue', async () => {
    expect((await ctx.sup('get', '/api/sewing/queue')).status).toBe(403);
    expect((await ctx.ver('get', '/api/sewing/queue')).status).toBe(403);
  });

  it('sewing supervisor sees audit data and can start sewing once', async () => {
    const order = await makeOrder(ctx);
    await ctx.ver('put', `/api/orders/${order.id}/counts`).send(countAll(order));
    await ctx.ver('post', `/api/orders/${order.id}/approve`).send({ note: 'Looks good' });
    const detail = await ctx.sew('get', `/api/sewing/queue/${order.id}`);
    expect(detail.body.verification.audit_note).toBe('Looks good');
    const start = await ctx.sew('post', `/api/sewing/${order.id}/start`);
    expect(start.body.status).toBe('IN_SEWING');
    expect((await ctx.sew('post', `/api/sewing/${order.id}/start`)).status).toBe(409);
    expect((await ctx.sew('get', '/api/sewing/queue')).body).toHaveLength(0);
    expect((await ctx.sew('get', '/api/sewing/in-progress')).body).toHaveLength(1);
  });
});