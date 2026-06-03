-- ═══════════════════════════════════════════════════════════════════
--  SelfHeal — Node Exporter Migration
--  Run this in Supabase SQL Editor AFTER the initial schema SQL.
--  Adds exporter_port to servers table for multi-provider support.
-- ═══════════════════════════════════════════════════════════════════

-- Add exporter_port column (default 9100 — standard node_exporter port)
ALTER TABLE public.servers
  ADD COLUMN IF NOT EXISTS exporter_port INTEGER NOT NULL DEFAULT 9100;

-- Add maintenance_mode flag (free feature — suppress alerts during planned work)
ALTER TABLE public.servers
  ADD COLUMN IF NOT EXISTS maintenance_mode BOOLEAN NOT NULL DEFAULT false;

-- Auto-prune metrics older than 7 days to keep free tier healthy.
-- Call this function from a Supabase scheduled job or pg_cron.
-- (Or the backend calls it manually on each scrape cycle.)
CREATE OR REPLACE FUNCTION prune_old_metrics()
RETURNS void LANGUAGE sql AS $$
  DELETE FROM public.metrics
  WHERE timestamp < NOW() - INTERVAL '7 days';
$$;

-- Optional: verify the columns were added
SELECT column_name, data_type, column_default
FROM information_schema.columns
WHERE table_name = 'servers'
  AND column_name IN ('exporter_port', 'maintenance_mode')
ORDER BY column_name;
