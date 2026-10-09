
import { createDb } from '../server/src/db.js';
import { migrate } from '../server/src/schema.js';
import { seed } from '../server/src/seed.js';
import { createApp } from '../server/src/app.js';

let appPromise;

async function init() {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error('JWT_SECRET must be set');
  const db = createDb();
  await migrate(db); // safe to repeat: only creates what is missing
  await seed(db);    // idempotent
  return createApp(db, { jwtSecret: secret, serveClient: false });
}

export default async function handler(req, res) {
  try {
    appPromise ??= init();
    const app = await appPromise;
    return app(req, res);
  } catch (err) {
    appPromise = undefined; // allow a retry on the next request
    console.error('Server initialisation failed:', err);
    res.statusCode = 500;
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ error: 'Server initialisation failed' }));
  }
}