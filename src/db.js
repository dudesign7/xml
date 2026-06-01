require('dotenv').config();
const BetterSQLite3 = require('better-sqlite3');
const path = require('path');
const fs   = require('fs');

// ─── Database file path ────────────────────────────────────────────────────────
const dbPath = path.resolve(process.env.DB_PATH || './data/zapxml.db');

// Ensure the data directory exists
const dataDir = path.dirname(dbPath);
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

// ─── Open database ─────────────────────────────────────────────────────────────
const db = new BetterSQLite3(dbPath);

// Performance & integrity pragmas
db.pragma('journal_mode = WAL');        // Write-Ahead Logging – faster concurrent reads
db.pragma('foreign_keys = ON');         // Enforce FK constraints
db.pragma('synchronous = NORMAL');      // Safe + fast compromise
db.pragma('cache_size = -8192');        // 8 MB in-memory cache

// ─── Schema (SQLite-compatible) ────────────────────────────────────────────────
const SCHEMA = `
  CREATE TABLE IF NOT EXISTS users (
    id         TEXT PRIMARY KEY,
    name       TEXT,
    email      TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS properties (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
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
    bathrooms      INTEGER NOT NULL DEFAULT 0,
    parking        INTEGER NOT NULL DEFAULT 0,
    street         TEXT    NOT NULL DEFAULT '',
    neighborhood   TEXT    NOT NULL DEFAULT '',
    city           TEXT    NOT NULL DEFAULT '',
    state          TEXT    NOT NULL DEFAULT '',
    country        TEXT    NOT NULL DEFAULT 'BR',
    created_at     TEXT    NOT NULL DEFAULT (datetime('now')),
    updated_at     TEXT    NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_props_user      ON properties(user_id);
  CREATE INDEX IF NOT EXISTS idx_props_ext_id    ON properties(user_id, external_id);

  CREATE TABLE IF NOT EXISTS images (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    property_id   INTEGER NOT NULL,
    url           TEXT    NOT NULL,
    is_main       INTEGER NOT NULL DEFAULT 0,
    display_order INTEGER NOT NULL DEFAULT 0,
    created_at    TEXT    NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (property_id) REFERENCES properties(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_images_prop ON images(property_id);

  CREATE TRIGGER IF NOT EXISTS trg_props_updated_at
    AFTER UPDATE ON properties
    BEGIN
      UPDATE properties SET updated_at = datetime('now') WHERE id = NEW.id;
    END;

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
    created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
    updated_at  TEXT    NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );


  CREATE INDEX IF NOT EXISTS idx_jobs_user ON jobs(user_id, created_at);
`;

// ─── Auto-migrate ──────────────────────────────────────────────────────────────
function runMigrations() {
  db.exec(SCHEMA);

  // Migration: Add limit_total if not present
  const info = db.pragma('table_info(jobs)');
  if (!info.some(c => c.name === 'limit_total')) {
    db.exec('ALTER TABLE jobs ADD COLUMN limit_total INTEGER NOT NULL DEFAULT 1');
  }

  // Reset jobs that were interrupted by a server restart
  db.prepare(
    `UPDATE jobs SET status = 'failed', error_msg = 'Servidor reiniciado'
     WHERE status IN ('pending', 'collecting', 'running')`
  ).run();
  console.log(`[DB] SQLite schema aplicado → ${dbPath}`);

}

// ─── Parameter converter: $1,$2,$3 → ?,?,? ───────────────────────────────────
function pgToSqlite(sql) {
  return sql
    .replace(/\$(\d+)/g, '?')           // positional params
    .replace(/::int\b/g, '')             // remove pg casts
    .replace(/TIMESTAMPTZ/gi, 'TEXT')    // type aliases
    .replace(/gen_random_uuid\(\)/gi, "lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))),2) || '-' || substr('89ab',abs(random()) % 4 + 1, 1) || substr(lower(hex(randomblob(2))),2) || '-' || lower(hex(randomblob(6)))");
}

// ─── Async query wrapper (pg-compatible interface) ─────────────────────────────
/**
 * query(sql, params)
 *   - Converts $N → ?
 *   - SELECT / WITH → returns { rows: [...], rowCount }
 *   - INSERT / UPDATE / DELETE → returns { rows: [], rowCount, lastID }
 */
function query(sql, params = []) {
  return new Promise((resolve, reject) => {
    try {
      const converted = pgToSqlite(sql.trim());
      const upper = converted.trimStart().toUpperCase();
      const stmt  = db.prepare(converted);

      if (upper.startsWith('SELECT') || upper.startsWith('WITH') || upper.startsWith('PRAGMA')) {
        const rows = stmt.all(...params);
        resolve({ rows, rowCount: rows.length });
      } else {
        const info = stmt.run(...params);
        resolve({ rows: [], rowCount: info.changes, lastID: info.lastInsertRowid });
      }
    } catch (err) {
      console.error('[DB] Query error:', err.message, '\nSQL:', sql.slice(0, 120));
      reject(err);
    }
  });
}

// ─── Convenience: single row ──────────────────────────────────────────────────
function queryOne(sql, params = []) {
  return new Promise((resolve, reject) => {
    try {
      const converted = pgToSqlite(sql.trim());
      const row = db.prepare(converted).get(...params);
      resolve(row || null);
    } catch (err) {
      console.error('[DB] queryOne error:', err.message);
      reject(err);
    }
  });
}

// ─── IN-clause helper: WHERE col IN (array) ────────────────────────────────────
/**
 * queryIn(sql, ids, beforeParams?, afterParams?)
 * Replaces the first occurrence of `ANY(?)` or `__IN__` with the expanded IN list.
 * `ids` are appended at the placeholder position.
 *
 * Usage:
 *   queryIn(`SELECT * FROM images WHERE property_id IN __IN__ ORDER BY display_order`, ids)
 */
function queryIn(sql, ids = [], beforeParams = [], afterParams = []) {
  return new Promise((resolve, reject) => {
    try {
      if (ids.length === 0) return resolve({ rows: [], rowCount: 0 });
      const placeholders = ids.map(() => '?').join(', ');
      const converted    = pgToSqlite(sql.replace('__IN__', `(${placeholders})`));
      const rows         = db.prepare(converted).all(...beforeParams, ...ids, ...afterParams);
      resolve({ rows, rowCount: rows.length });
    } catch (err) {
      console.error('[DB] queryIn error:', err.message);
      reject(err);
    }
  });
}

// ─── Health check ──────────────────────────────────────────────────────────────
function ping() {
  return Promise.resolve(db.prepare("SELECT datetime('now') as ts").get()?.ts || new Date());
}

module.exports = { query, queryOne, queryIn, ping, db, runMigrations };
