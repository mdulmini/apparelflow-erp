import { ROLES } from './domain.js';

const ts = (db, t, name) => t.timestamp(name, { useTz: true }).notNullable().defaultTo(db.fn.now());

export async function migrate(db) {
  const has = (n) => db.schema.hasTable(n);

  if (!(await has('users'))) {
    await db.schema.createTable('users', (t) => {
      t.increments('id');
      t.string('email').notNullable().unique();
      t.string('password_hash').notNullable();
      t.string('role').notNullable();
      t.string('full_name').notNullable();
      ts(db, t, 'created_at');
      t.check('?? in (' + ROLES.map(() => '?').join(',') + ')', ['role', ...ROLES]);
    });
  }

  if (!(await has('recipes'))) {
    await db.schema.createTable('recipes', (t) => {
      t.increments('id');
      t.string('recipe_code').notNullable().unique();
      t.string('name').notNullable();
      t.string('category').notNullable();
      t.decimal('std_fabric_yards', 8, 2).notNullable();
      t.decimal('wastage_cap', 5, 2).notNullable();
    });
  }

  if (!(await has('recipe_components'))) {
    await db.schema.createTable('recipe_components', (t) => {
      t.increments('id');
      t.integer('recipe_id').notNullable().references('id').inTable('recipes');
      t.string('component_name').notNullable();
      t.integer('pieces_per_garment').notNullable();
      t.string('image_url');
      t.unique(['recipe_id', 'component_name']);
    });
  }

  if (!(await has('cutting_orders'))) {
    await db.schema.createTable('cutting_orders', (t) => {
      t.increments('id');
      t.string('order_no').notNullable().unique();
      t.integer('recipe_id').notNullable().references('id').inTable('recipes');
      t.integer('target_qty').notNullable();
      t.string('fabric_roll_id').notNullable();
      t.decimal('actual_fabric_yds', 10, 2).notNullable();
      t.string('status').notNullable();
      t.integer('created_by').notNullable().references('id').inTable('users');
      t.integer('sewing_started_by').references('id').inTable('users');
      t.timestamp('sewing_started_at', { useTz: true });
      ts(db, t, 'created_at');
      ts(db, t, 'updated_at');
      t.index('status');
      t.check('target_qty > 0');
    });
  }

  if (!(await has('verification_items'))) {
    await db.schema.createTable('verification_items', (t) => {
      t.increments('id');
      t.integer('order_id').notNullable().references('id').inTable('cutting_orders');
      t.integer('component_id').notNullable().references('id').inTable('recipe_components');
      t.integer('expected_qty').notNullable();
      t.integer('actual_qty'); // NULL = not counted yet
      t.string('status'); // GREEN | YELLOW | RED | NULL(uncounted)
      t.unique(['order_id', 'component_id']);
      t.check('actual_qty is null or actual_qty >= 0');
    });
  }

  if (!(await has('verification_logs'))) {
    await db.schema.createTable('verification_logs', (t) => {
      t.increments('id');
      t.integer('order_id').notNullable().references('id').inTable('cutting_orders');
      t.integer('verifier_id').notNullable().references('id').inTable('users');
      t.string('decision').notNullable(); // APPROVED | REJECTED
      t.text('rejection_note');
      t.text('audit_note');
      t.decimal('wastage_pct', 8, 2).notNullable();
      t.text('variance_snapshot').notNullable(); // JSON of per-component counts at decision time
      t.timestamp('timestamp', { useTz: true }).notNullable();
      t.index('order_id');
      t.check('?? in (?, ?)', ['decision', 'APPROVED', 'REJECTED']);
    });
  }

  await installImmutabilityGuards(db);
}

/** Defence in depth: even a buggy query cannot rewrite audit history. */
async function installImmutabilityGuards(db) {
  const client = db.client.config.client;
  if (client === 'pg') {
    try {
      await db.raw(`CREATE OR REPLACE FUNCTION af_block_log_mutation() RETURNS trigger AS $$
        BEGIN RAISE EXCEPTION 'verification_logs is append-only'; END; $$ LANGUAGE plpgsql`);
      await db.raw('DROP TRIGGER IF EXISTS trg_vlogs_immutable ON verification_logs');
      await db.raw(`CREATE TRIGGER trg_vlogs_immutable BEFORE UPDATE OR DELETE ON verification_logs
        FOR EACH ROW EXECUTE FUNCTION af_block_log_mutation()`);
      await db.raw(`CREATE OR REPLACE FUNCTION af_lock_items() RETURNS trigger AS $$
        DECLARE s text;
        BEGIN
          SELECT status INTO s FROM cutting_orders WHERE id = OLD.order_id;
          IF s IN ('VERIFIED','IN_SEWING') THEN RAISE EXCEPTION 'verified counts are immutable'; END IF;
          IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
          RETURN NEW;
        END; $$ LANGUAGE plpgsql`);
      await db.raw('DROP TRIGGER IF EXISTS trg_items_locked ON verification_items');
      await db.raw(`CREATE TRIGGER trg_items_locked BEFORE UPDATE OR DELETE ON verification_items
        FOR EACH ROW EXECUTE FUNCTION af_lock_items()`);
    } catch (e) {
      console.warn('Could not install Postgres triggers (non-fatal):', e.message);
    }
    return;
  }
  await db.raw(`CREATE TRIGGER IF NOT EXISTS trg_vlogs_no_update BEFORE UPDATE ON verification_logs
    BEGIN SELECT RAISE(ABORT, 'verification_logs is append-only'); END`);
  await db.raw(`CREATE TRIGGER IF NOT EXISTS trg_vlogs_no_delete BEFORE DELETE ON verification_logs
    BEGIN SELECT RAISE(ABORT, 'verification_logs is append-only'); END`);
  await db.raw(`CREATE TRIGGER IF NOT EXISTS trg_items_locked_upd BEFORE UPDATE ON verification_items
    WHEN (SELECT status FROM cutting_orders WHERE id = OLD.order_id) IN ('VERIFIED','IN_SEWING')
    BEGIN SELECT RAISE(ABORT, 'verified counts are immutable'); END`);
  await db.raw(`CREATE TRIGGER IF NOT EXISTS trg_items_locked_del BEFORE DELETE ON verification_items
    WHEN (SELECT status FROM cutting_orders WHERE id = OLD.order_id) IN ('VERIFIED','IN_SEWING')
    BEGIN SELECT RAISE(ABORT, 'verified counts are immutable'); END`);
}