'use strict';

/**
 * incidentManager.js
 * Responsible for deduplicating and persisting new incidents to Supabase.
 *
 * Deduplication strategy:
 *   Before inserting, query the `incidents` table for any row with:
 *     - same agent_id
 *     - same type
 *     - status = 'open'
 *   If one exists, the incoming incident is skipped (idempotent).
 */

const log = (level, msg) =>
  console.log(`[${new Date().toISOString()}] [${level}] [incidentManager] ${msg}`);

/**
 * Persist new incidents, skipping duplicates of open incidents.
 *
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @param {Array<Object>} incidents - Array of incident objects from anomalyDetector
 * @returns {Promise<number>} Number of incidents actually created
 */
async function createIncidents(supabase, incidents) {
  if (!incidents || incidents.length === 0) return 0;

  let created = 0;

  for (const incident of incidents) {
    try {
      // ── Deduplication check ──────────────────────────────────────────────
      const { data: existing, error: queryError } = await supabase
        .from('incidents')
        .select('incident_id')
        .eq('agent_id', incident.agent_id)
        .eq('type', incident.type)
        .eq('status', 'investigating')
        .limit(1);

      if (queryError) {
        log('ERROR', `Dedup query failed for ${incident.type}@${incident.agent_id}: ${queryError.message}`);
        continue; // Don't insert if we can't verify — safer to skip than duplicate.
      }

      if (existing && existing.length > 0) {
        log('DEBUG', `Skipping duplicate incident: ${incident.type} for agent ${incident.agent_id} (existing: ${existing[0].incident_id})`);
        continue;
      }

      // ── Insert new incident ──────────────────────────────────────────────
      const row = {
        incident_id: incident.incident_id,
        agent_id:    incident.agent_id,
        node:        incident.agent_id, // Default to agent_id
        type:        'ALERT', // Must be ALERT or HEALING to satisfy DB constraint
        status:      incident.status || 'investigating',
        root_cause:  `[${incident.type.toUpperCase()}] ${incident.summary}`,
        action:      null,
        confidence:  100,
        timestamp:   incident.created_at || new Date().toISOString(),
        severity:    incident.severity,
        summary:     incident.summary,
      };

      const { error: insertError } = await supabase
        .from('incidents')
        .insert(row);

      if (insertError) {
        // Fallback: if columns like 'severity' don't exist, retry with basic legacy columns
        const errorMsg = insertError.message.toLowerCase();
        if (errorMsg.includes('column') && (errorMsg.includes('does not exist') || errorMsg.includes('not found'))) {
          log('WARN', `New metadata columns missing on incidents table. Retrying with basic columns.`);
          const legacyRow = {
            node:       row.node,
            type:       row.type,
            status:     row.status,
            root_cause: row.root_cause,
            action:     row.action,
            confidence: row.confidence,
            timestamp:  row.timestamp,
          };
          const { error: retryError } = await supabase
            .from('incidents')
            .insert(legacyRow);

          if (retryError) {
            log('ERROR', `Failed fallback legacy incident insert: ${retryError.message}`);
            continue;
          }
        } else {
          log('ERROR', `Failed to insert incident ${incident.incident_id}: ${insertError.message}`);
          continue;
        }
      }

      created++;
      log('INFO', `🚨 New incident created [${incident.severity.toUpperCase()}] ${incident.type} — agent: ${incident.agent_id} — ${incident.summary}`);
    } catch (err) {
      // Individual incident failures must not crash the loop.
      log('ERROR', `Unexpected error processing incident ${incident.incident_id}: ${err.message}`);
    }
  }

  return created;
}

module.exports = { createIncidents };
