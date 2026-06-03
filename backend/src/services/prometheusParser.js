'use strict';

/**
 * services/prometheusParser.js
 *
 * Lightweight zero-dependency Prometheus text format parser.
 * Parses the /metrics endpoint output from node_exporter.
 *
 * Format reference:
 *   # HELP metric_name Description
 *   # TYPE metric_name counter|gauge|histogram|summary
 *   metric_name{label="value"} 1234.56
 *   metric_name{label="value"} 1234.56 1609459200000  ← optional timestamp
 */

/**
 * Parse a Prometheus text body into a Map.
 *
 * @param   {string} text  Raw response body from /metrics
 * @returns {Map<string, Array<{labels: Record<string,string>, value: number}>>}
 */
function parse(text) {
  const result = new Map();

  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;

    // Split off the value (and optional timestamp) at the last space
    const lastSpace = line.lastIndexOf(' ');
    if (lastSpace === -1) continue;

    const valueStr = line.slice(lastSpace + 1);
    const value = parseFloat(valueStr);
    if (Number.isNaN(value)) continue;

    const nameAndLabels = line.slice(0, lastSpace);

    let name;
    let labels = {};
    const braceOpen = nameAndLabels.indexOf('{');

    if (braceOpen === -1) {
      name = nameAndLabels;
    } else {
      name = nameAndLabels.slice(0, braceOpen);
      // Parse label string: key="value",key2="value2"
      const labelBody = nameAndLabels.slice(braceOpen + 1, -1);
      for (const pair of splitLabels(labelBody)) {
        const eq = pair.indexOf('=');
        if (eq === -1) continue;
        const k = pair.slice(0, eq).trim();
        // strip surrounding quotes from value
        const v = pair.slice(eq + 1).replace(/^"|"$/g, '');
        labels[k] = v;
      }
    }

    if (!result.has(name)) result.set(name, []);
    result.get(name).push({ labels, value });
  }

  return result;
}

/** Split "a="b",c="d,e"" correctly (commas inside quotes are part of a value). */
function splitLabels(str) {
  const parts = [];
  let current = '';
  let inQuote = false;
  for (let i = 0; i < str.length; i++) {
    const ch = str[i];
    if (ch === '"') { inQuote = !inQuote; current += ch; }
    else if (ch === ',' && !inQuote) { parts.push(current); current = ''; }
    else { current += ch; }
  }
  if (current) parts.push(current);
  return parts;
}

/** Get the first value for a metric (useful for gauges like node_load1). */
function getValue(metrics, name) {
  return metrics.get(name)?.[0]?.value ?? null;
}

/** Get all entries for a metric (useful for counters with many label combinations). */
function getEntries(metrics, name) {
  return metrics.get(name) || [];
}

module.exports = { parse, getValue, getEntries };
