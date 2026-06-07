'use strict';

const { createClerkClient, verifyToken: clerkVerifyToken } = require('@clerk/backend');
const config = require('../config/env');
const { supabase, isSupabaseReady } = require('./supabase');
const { normalizeEmail, roleForEmail } = require('./roles');
const { logAuditEvent } = require('./audit');

const clerkClient = createClerkClient({
  secretKey: config.clerkSecretKey || undefined,
  publishableKey: process.env.CLERK_PUBLISHABLE_KEY || undefined,
});

function assertAuthConfigured() {
  if (!config.clerkSecretKey && !config.clerkJwtKey) {
    throw Object.assign(new Error('Authentication is not configured'), { status: 503 });
  }
  if (!config.clerkIssuer) {
    throw Object.assign(new Error('CLERK_ISSUER is required'), { status: 503 });
  }
  if (!config.clerkAudience) {
    throw Object.assign(new Error('CLERK_AUDIENCE is required'), { status: 503 });
  }
}

function extractPrimaryEmail(clerkUser) {
  const primaryId = clerkUser.primaryEmailAddressId;
  const primary = clerkUser.emailAddresses?.find(e => e.id === primaryId) || clerkUser.emailAddresses?.[0];
  return normalizeEmail(primary?.emailAddress);
}

function validateClaims(payload) {
  if (payload.iss !== config.clerkIssuer) {
    throw Object.assign(new Error('Invalid token issuer'), { status: 401 });
  }
  if (!payload.sub || typeof payload.sub !== 'string') {
    throw Object.assign(new Error('Invalid token subject'), { status: 401 });
  }
  const now = Math.floor(Date.now() / 1000);
  if (!payload.exp || payload.exp <= now) {
    throw Object.assign(new Error('Token expired'), { status: 401 });
  }
  const audiences = Array.isArray(payload.aud) ? payload.aud : [payload.aud].filter(Boolean);
  if (!audiences.includes(config.clerkAudience)) {
    throw Object.assign(new Error('Invalid token audience'), { status: 401 });
  }
  return payload;
}

async function verifyToken(token) {
  assertAuthConfigured();
  if (!token) throw Object.assign(new Error('Missing auth token'), { status: 401 });

  const payload = await clerkVerifyToken(token, {
    secretKey: config.clerkSecretKey || undefined,
    jwtKey: config.clerkJwtKey || undefined,
    audience: config.clerkAudience,
    authorizedParties: config.clerkAuthorizedParties,
    clockSkewInMs: 5000,
  });

  return validateClaims(payload);
}

async function getCurrentUser(clerkId) {
  if (!clerkId) throw Object.assign(new Error('Missing Clerk user id'), { status: 401 });
  return clerkClient.users.getUser(clerkId);
}

async function syncUser(payload) {
  if (!isSupabaseReady()) {
    throw Object.assign(new Error('Database not configured'), { status: 503 });
  }

  const clerkUser = await getCurrentUser(payload.sub);
  const email = extractPrimaryEmail(clerkUser);
  if (!email) throw Object.assign(new Error('Clerk user has no email address'), { status: 403 });

  const desiredRole = roleForEmail(email);
  const now = new Date().toISOString();

  const { data: existing, error: lookupError } = await supabase
    .from('users')
    .select('*')
    .eq('clerk_id', payload.sub)
    .maybeSingle();

  if (lookupError) throw Object.assign(new Error(lookupError.message), { status: 502 });

  if (!existing) {
    const { data, error } = await supabase
      .from('users')
      .insert([{
        clerk_id: payload.sub,
        email,
        role: desiredRole,
        created_at: now,
        updated_at: now,
      }])
      .select()
      .single();
    if (error) throw Object.assign(new Error(error.message), { status: 502 });
    return data;
  }

  const patch = {};
  if (normalizeEmail(existing.email) !== email) patch.email = email;
  if (existing.role !== desiredRole) patch.role = desiredRole;
  if (Object.keys(patch).length === 0) return existing;

  patch.updated_at = now;
  const { data, error } = await supabase
    .from('users')
    .update(patch)
    .eq('id', existing.id)
    .select()
    .single();

  if (error) throw Object.assign(new Error(error.message), { status: 502 });
  if (existing.role !== desiredRole) {
    await logAuditEvent({
      actorId: data.id,
      action: 'user.role.sync',
      metadata: {
        clerk_id: payload.sub,
        email,
        previous_role: existing.role,
        new_role: desiredRole,
      },
    });
  }
  return data;
}

module.exports = { verifyToken, getCurrentUser, syncUser };
