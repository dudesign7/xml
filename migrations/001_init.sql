-- ═══════════════════════════════════════════════════════════
-- ZapXML – Database Schema v1
-- Run: psql -U postgres -d zapxml -f migrations/001_init.sql
-- ═══════════════════════════════════════════════════════════

-- Enable UUID generation
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ── Users ──────────────────────────────────────────────────────
-- Each browser session auto-generates a UUID (future: map to auth)
CREATE TABLE IF NOT EXISTS users (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        VARCHAR(255),
  email       VARCHAR(255),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── Properties ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS properties (
  id              SERIAL PRIMARY KEY,
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  external_id     VARCHAR(255),
  source_url      TEXT,
  title           VARCHAR(500)   NOT NULL DEFAULT '',
  description     TEXT           NOT NULL DEFAULT '',
  price           NUMERIC(15,2)  NOT NULL DEFAULT 0,
  operation_type  VARCHAR(50)    NOT NULL DEFAULT 'Venda',
  property_type   VARCHAR(100)   NOT NULL DEFAULT 'Apartamento',
  area            INTEGER        NOT NULL DEFAULT 0,
  bedrooms        INTEGER        NOT NULL DEFAULT 0,
  bathrooms       INTEGER        NOT NULL DEFAULT 0,
  parking         INTEGER        NOT NULL DEFAULT 0,
  street          VARCHAR(500)   NOT NULL DEFAULT '',
  neighborhood    VARCHAR(255)   NOT NULL DEFAULT '',
  city            VARCHAR(255)   NOT NULL DEFAULT '',
  state           VARCHAR(10)    NOT NULL DEFAULT '',
  country         VARCHAR(10)    NOT NULL DEFAULT 'BR',
  created_at      TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ    NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_properties_user_id ON properties(user_id);
CREATE INDEX IF NOT EXISTS idx_properties_external_id ON properties(external_id);

-- ── Images ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS images (
  id            SERIAL PRIMARY KEY,
  property_id   INTEGER NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  url           TEXT    NOT NULL,
  is_main       BOOLEAN NOT NULL DEFAULT FALSE,
  display_order INTEGER NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_images_property_id ON images(property_id);

-- ── Auto-update updated_at ──────────────────────────────────────
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_properties_updated_at ON properties;
CREATE TRIGGER trg_properties_updated_at
  BEFORE UPDATE ON properties
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
