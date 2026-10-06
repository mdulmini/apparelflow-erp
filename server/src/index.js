import express from 'express';
import { createDb } from './db.js';
import { migrate } from './schema.js';
import { seed } from './seed.js';

const db = createDb();
await migrate(db);
await seed(db);

const app = express();
app.get('/api/health', async (_req, res) => {
  const recipes = await db('recipes').count({ n: '*' }).first();
  res.json({ ok: true, recipes: Number(recipes.n) });
});
app.get('/', (_req, res) => res.send('ApparelFlow API skeleton is running'));

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`Listening on :${port}`));