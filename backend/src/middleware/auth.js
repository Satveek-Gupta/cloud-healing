'use strict';

const { verifyToken, syncUser } = require('../lib/clerk');

function getCookie(req, name) {
  const raw = req.headers.cookie || '';
  return raw.split(';').map(s => s.trim()).find(s => s.startsWith(`${name}=`))?.slice(name.length + 1);
}

function extractToken(req) {
  const auth = req.headers.authorization || '';
  if (auth.toLowerCase().startsWith('bearer ')) return auth.slice(7).trim();
  if (req.query?.token) return String(req.query.token);
  return getCookie(req, '__session');
}

async function requireAuth(req, res, next) {
  try {
    const payload = await verifyToken(extractToken(req));
    const user = await syncUser(payload);
    req.auth = payload;
    req.user = user;
    next();
  } catch (err) {
    const status = err.status || err.statusCode || 401;
    res.status(status === 503 ? 503 : 401).json({ error: status === 503 ? err.message : 'Unauthorized' });
  }
}

module.exports = { requireAuth, extractToken };
