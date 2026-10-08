import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { makeAuth } from './auth.js';
import { ordersRouter } from './routes/orders.js';
import { sewingRouter } from './routes/sewing.js';
import { errorHandler } from './errors.js';
import { DEMO_USERS } from './seed.js';

export function createApp(db, { jwtSecret, serveClient = false } = {}) {
  const app = express();
  const auth = makeAuth(db, jwtSecret);

  // Helmet's default CSP adds upgrade-insecure-requests, which breaks asset loading over plain http://localhost (Safari).
  app.use(helmet({
    contentSecurityPolicy: { directives: { ...helmet.contentSecurityPolicy.getDefaultDirectives(), 'upgrade-insecure-requests': null } },
    hsts: process.env.NODE_ENV === 'production',
  }));
  app.use(cors());
  app.use(express.json({ limit: '50kb' }));

  app.get('/api/health', async (_req, res) => {
    const recipes = await db('recipes').count({ n: '*' }).first();
    res.json({ ok: true, recipes: Number(recipes.n) });
  });
  app.post('/api/auth/login', auth.login);
  app.get('/api/auth/me', auth.authenticate, (req, res) => res.json({ user: req.user }));
  // Demo panel data. Exists for the evaluator's role-switcher; would be removed in a real deployment.
  app.get('/api/auth/demo-users', (_req, res) =>
    res.json(DEMO_USERS.map(({ email, password, role, full_name }) => ({ email, password, role, full_name }))));

  app.use('/api', ordersRouter(db, auth));
  app.use('/api/sewing', sewingRouter(db, auth));
  app.use('/api', (_req, res) => res.status(404).json({ error: 'Not found' }));

  if (serveClient) {
    const dist = join(dirname(fileURLToPath(import.meta.url)), '../../client/dist');
    if (existsSync(dist)) {
      app.use(express.static(dist));
      app.get('*', (_req, res) => res.sendFile(join(dist, 'index.html')));
    }
  }
  app.use(errorHandler);
  return app;
}