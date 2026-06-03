'use strict';

/**
 * lib/liveState.js
 * Tiny in-memory store for the latest AI diagnosis row.
 * Used as a fallback when Supabase is not configured.
 */

let _latestDiagnosis = null;

function setMemLatestDiagnosis(row) {
  _latestDiagnosis = row;
}

function getMemLatestDiagnosis() {
  return _latestDiagnosis;
}

module.exports = { setMemLatestDiagnosis, getMemLatestDiagnosis };
