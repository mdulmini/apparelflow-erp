import request from 'supertest';
import { createDb } from '../src/db.js';
import { migrate } from '../src/schema.js';
import { seed, DEMO_USERS } from '../src/seed.js';
import { createApp } from '../src/app.js';

export async function setup() {
  const db = createDb({ memory: true });
  await migrate(db);
  await seed(db);
  const app = createApp(db, { jwtSecret: 'test-secret' });
  const api = request(app);
  const tokens = {};
  for (const u of DEMO_USERS) {
    const res = await api.post('/api/auth/login').send({ email: u.email, password: u.password });
    tokens[u.role] = res.body.token;
  }
  const as = (role) => (method, url) => api[method](url).set('Authorization', `Bearer ${tokens[role]}`);
  return { db, api, tokens, sup: as('cutting_supervisor'), ver: as('cutting_verifier'), sew: as('sewing_supervisor') };
}

/** Create a submitted Casual Blouse order (qty 50 => 50/50/100/50/100). */
export async function makeOrder(ctx, overrides = {}) {
  const recipes = await ctx.sup('get', '/api/recipes');
  const blouse = recipes.body.find((r) => r.recipe_code === 'REC-BL01');
  const res = await ctx.sup('post', '/api/orders').send({
    recipe_id: blouse.id, target_qty: 50, fabric_roll_id: 'FAB-ROLL-882', actual_fabric_yds: 94.5, ...overrides,
  });
  return res.body;
}

export const countAll = (order, mapper = (i) => i.expected_qty) => ({
  counts: order.items.map((i) => ({ component_id: i.component_id, actual_qty: mapper(i) })),
});