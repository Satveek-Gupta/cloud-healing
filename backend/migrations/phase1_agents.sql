-- ════════════════════════════════════════════════════════════
-- SelfHeal Phase 1 — Agent & Telemetry Schema
-- Run this in Supabase SQL editor
-- Safe to re-run (all statements use IF NOT EXISTS / IF EXISTS)
-- ════════════════════════════════════════════════════════════

-- ── agents table ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS agents (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id     TEXT        UNIQUE NOT NULL,
  hostname     TEXT        NOT NULL,
  os           TEXT,
  ip           TEXT,
  environment  TEXT        DEFAULT 'production',
  version      TEXT        DEFAULT '1.0.0',
  token        TEXT        NOT NULL,
  last_seen    TIMESTAMPTZ,
  status       TEXT        DEFAULT 'unknown'
                           CHECK (status IN ('online','offline','healthy','degraded','critical','unknown')),
  -- Cached latest metrics for fast dashboard display (no telemetry join needed)
  health_score SMALLINT,
  cpu          NUMERIC(5,2),
  memory       NUMERIC(5,2),
  disk         NUMERIC(5,2),
  created_at   TIMESTAMPTZ DEFAULT now()
);

-- Add cached metric columns to existing agents table (safe if already added)
ALTER TABLE agents ADD COLUMN IF NOT EXISTS health_score SMALLINT;
ALTER TABLE agents ADD COLUMN IF NOT EXISTS cpu          NUMERIC(5,2);
ALTER TABLE agents ADD COLUMN IF NOT EXISTS memory       NUMERIC(5,2);
ALTER TABLE agents ADD COLUMN IF NOT EXISTS disk         NUMERIC(5,2);

-- ── telemetry table ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS telemetry (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id       TEXT        REFERENCES agents(agent_id) ON DELETE CASCADE,
  cpu            NUMERIC(5,2),
  memory         NUMERIC(5,2),
  disk           NUMERIC(5,2),
  network_in     BIGINT      DEFAULT 0,
  network_out    BIGINT      DEFAULT 0,
  uptime         BIGINT,
  load_avg       NUMERIC(6,2),
  health_score   SMALLINT    CHECK (health_score BETWEEN 0 AND 100),
  log_summary    TEXT,
  process_report JSONB,
  timestamp      TIMESTAMPTZ DEFAULT now()
);

-- ── Indexes ───────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_telemetry_agent_time ON telemetry (agent_id, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_agents_last_seen     ON agents    (last_seen DESC);

-- ── Upgrade incidents table (additive only) ───────────────────
ALTER TABLE incidents ADD COLUMN IF NOT EXISTS agent_id    TEXT;
ALTER TABLE incidents ADD COLUMN IF NOT EXISTS incident_id TEXT UNIQUE;
ALTER TABLE incidents ADD COLUMN IF NOT EXISTS severity    TEXT;
ALTER TABLE incidents ADD COLUMN IF NOT EXISTS summary     TEXT;

CREATE INDEX IF NOT EXISTS idx_incidents_agent_id ON incidents (agent_id);
CREATE INDEX IF NOT EXISTS idx_incidents_status   ON incidents (status);
