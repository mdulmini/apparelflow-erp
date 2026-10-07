import { createDb } from './db.js';
import { migrate } from './schema.js';
import { seed } from './seed.js';
import { createApp } from './app.js';

const secret = process.env.JWT_SECRET;
if (process.env.NODE_ENV === 'production' && !secret) throw new Error('JWT_SECRET must be set in production');

const db = createDb();
await migrate(db);
await seed(db);

const app = createApp(db, { jwtSecret: secret || 'dev-only-secret-change-me', serveClient: true });
const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`ApparelFlow listening on :${port}`));