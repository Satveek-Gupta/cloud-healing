'use strict';

/**
 * middleware/validate.js
 * Lightweight schema-based body validation middleware factory.
 *
 * Usage:
 *   router.post('/foo', validateBody({ name: 'string', count: 'number?' }), handler)
 *
 * Supported type tokens:
 *   'string'          → required non-empty string
 *   'string?'         → optional string
 *   'number'          → required number (NaN-safe)
 *   'number?'         → optional number
 *   'boolean?'        → optional boolean
 *   'uuid'            → required UUID-like string
 *
 * Pipe extra constraints with |:
 *   'string|in:a,b,c' → must be one of the listed values
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function validateBody(schema) {
  const entries = Object.entries(schema);

  return (req, res, next) => {
    const errors = [];
    const body   = req.body || {};

    for (const [field, spec] of entries) {
      const parts    = spec.split('|');
      const typeSpec = parts[0];
      const optional = typeSpec.endsWith('?');
      const baseType = typeSpec.replace('?', '');
      const value    = body[field];
      const missing  = value === undefined || value === null || value === '';

      if (missing) {
        if (!optional) errors.push(`"${field}" is required`);
        continue;
      }

      // Type checks
      if (baseType === 'string' && typeof value !== 'string') {
        errors.push(`"${field}" must be a string`);
        continue;
      }
      if (baseType === 'number' && isNaN(Number(value))) {
        errors.push(`"${field}" must be a number`);
        continue;
      }
      if (baseType === 'boolean' && typeof value !== 'boolean') {
        errors.push(`"${field}" must be a boolean`);
        continue;
      }
      if (baseType === 'uuid' && !UUID_RE.test(String(value))) {
        errors.push(`"${field}" must be a valid UUID`);
        continue;
      }

      // Pipe constraints
      for (const constraint of parts.slice(1)) {
        if (constraint.startsWith('in:')) {
          const allowed = constraint.slice(3).split(',');
          if (!allowed.includes(String(value))) {
            errors.push(`"${field}" must be one of: ${allowed.join(', ')}`);
          }
        }
        if (constraint.startsWith('min:')) {
          const min = Number(constraint.slice(4));
          if (Number(value) < min) errors.push(`"${field}" must be ≥ ${min}`);
        }
        if (constraint.startsWith('max:')) {
          const max = Number(constraint.slice(4));
          if (Number(value) > max) errors.push(`"${field}" must be ≤ ${max}`);
        }
      }
    }

    if (errors.length) {
      return res.status(400).json({ error: 'Validation failed', details: errors });
    }
    next();
  };
}

module.exports = { validateBody };
