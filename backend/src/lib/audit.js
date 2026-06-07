'use strict';

const { supabase, isSupabaseReady } = require('./supabase');

async function logAuditEvent({ actorId = null, action, metadata = {} }) {
  if (!action) return null;
  if (!isSupabaseReady()) {
    console.log('[Audit]', action, JSON.stringify({ actorId, ...metadata }));
    return null;
  }

  const { data, error } = await supabase
    .from('audit_logs')
    .insert([{
      actor_id: actorId,
      action,
      metadata,
    }])
    .select()
    .single();

  if (error) {
    console.warn('[Audit] insert failed:', error.message);
    return null;
  }
  return data;
}

module.exports = { logAuditEvent };
