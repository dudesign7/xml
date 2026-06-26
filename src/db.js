require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS users (
    id         TEXT PRIMARY KEY,
    name       TEXT,
    email      TEXT,
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
  );

  CREATE TABLE IF NOT EXISTS properties (
    id             SERIAL PRIMARY KEY,
    user_id        TEXT    NOT NULL,
    external_id    TEXT,
    source_url     TEXT,
    title          TEXT    NOT NULL DEFAULT '',
    description    TEXT    NOT NULL DEFAULT '',
    price          REAL    NOT NULL DEFAULT 0,
    operation_type TEXT    NOT NULL DEFAULT 'Venda',
    property_type  TEXT    NOT NULL DEFAULT 'Apartamento',
    area           INTEGER NOT NULL DEFAULT 0,
    bedrooms       INTEGER NOT NULL DEFAULT 0,
    suites         INTEGER NOT NULL DEFAULT 0,
    bathrooms      INTEGER NOT NULL DEFAULT 0,
    parking        INTEGER NOT NULL DEFAULT 0,
    age            INTEGER NOT NULL DEFAULT 0,
    amenities      TEXT    NOT NULL DEFAULT '[]',
    street         TEXT    NOT NULL DEFAULT '',
    neighborhood   TEXT    NOT NULL DEFAULT '',
    city           TEXT    NOT NULL DEFAULT '',
    state          TEXT    NOT NULL DEFAULT '',
    country        TEXT    NOT NULL DEFAULT 'BR',
    created_at     TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at     TIMESTAMP NOT NULL DEFAULT NOW(),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_props_user      ON properties(user_id);
  CREATE INDEX IF NOT EXISTS idx_props_ext_id    ON properties(user_id, external_id);

  CREATE TABLE IF NOT EXISTS images (
    id            SERIAL PRIMARY KEY,
    property_id   INTEGER NOT NULL,
    url           TEXT    NOT NULL,
    is_main       INTEGER NOT NULL DEFAULT 0,
    display_order INTEGER NOT NULL DEFAULT 0,
    created_at    TIMESTAMP NOT NULL DEFAULT NOW(),
    FOREIGN KEY (property_id) REFERENCES properties(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_images_prop ON images(property_id);

  CREATE TABLE IF NOT EXISTS jobs (
    id          TEXT    PRIMARY KEY,
    user_id     TEXT    NOT NULL,
    status      TEXT    NOT NULL DEFAULT 'pending',
    mode        TEXT    NOT NULL DEFAULT 'single',
    source_url  TEXT    NOT NULL,
    limit_total INTEGER NOT NULL DEFAULT 1,
    total       INTEGER NOT NULL DEFAULT 0,
    imported    INTEGER NOT NULL DEFAULT 0,
    skipped     INTEGER NOT NULL DEFAULT 0,
    errors      INTEGER NOT NULL DEFAULT 0,
    error_msg   TEXT,
    created_at  TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMP NOT NULL DEFAULT NOW(),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_jobs_user ON jobs(user_id, created_at);
`;

const SCHEMA_TRIGGER = \`
  CREATE OR REPLACE FUNCTION update_updated_at_column()
  RETURNS TRIGGER AS $$
  BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
  END;
  $$ language 'plpgsql';

  DO $$
  BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_props_updated_at') THEN
      CREATE TRIGGER trg_props_updated_at
      BEFORE UPDATE ON properties
      FOR EACH ROW
      EXECUTE FUNCTION update_updated_at_column();
    END IF;
  END $$;
\`;

async function runMigrations() {
  if (!process.env.DATABASE_URL) {
    console.error('[DB] DATABASE_URL não configurado. Impossível migrar banco.');
    return;
  }
  const client = await pool.connect();
  try {
    await client.query(SCHEMA);
    await client.query(SCHEMA_TRIGGER);

    await client.query(
      \`UPDATE jobs SET status = 'failed', error_msg = 'Servidor reiniciado'
       WHERE status IN ('pending', 'collecting', 'running')\`
    );
    console.log(\`[DB] PostgreSQL schema aplicado com sucesso.\`);
  } catch (err) {
    console.error('[DB] Migration error:', err.message);
  } finally {
    client.release();
  }
}

async function ping() {
  if (!process.env.DATABASE_URL) return null;
  const { rows } = await pool.query('SELECT NOW() as ts');
  return rows[0].ts;
}

module.exports = { pool, runMigrations, ping };
