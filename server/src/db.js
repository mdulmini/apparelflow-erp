import knex from 'knex';
import 'pg'; 
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export function createDb({ memory = false } = {}) {
  if (!memory && process.env.DATABASE_URL) {
    return knex({
      client: 'pg',
      connection: {
        connectionString: process.env.DATABASE_URL,
        ssl: process.env.PGSSL === 'disable' ? false : { rejectUnauthorized: false },
      },
      pool: { min: 0, max: 5 },
    });
  }
  const filename = memory ? ':memory:' : process.env.SQLITE_FILE || './data/apparelflow.sqlite';
  if (!memory) mkdirSync(dirname(filename), { recursive: true });
  return knex({
    client: 'better-sqlite3',
    connection: { filename },
    useNullAsDefault: true,
    pool: {
      min: 1,
      max: 1,
      afterCreate: (conn, done) => {
        conn.pragma('foreign_keys = ON');
        done();
      },
    },
  });
}