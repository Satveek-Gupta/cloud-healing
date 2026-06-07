// Central backend URL — change once here, applies everywhere
// Override with NEXT_PUBLIC_BACKEND_URL env var for deployment
export const BACKEND_URL =
  process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:8000';

export const CLERK_JWT_TEMPLATE =
  process.env.NEXT_PUBLIC_CLERK_JWT_TEMPLATE || undefined;

/** WebSocket origin derived from BACKEND_URL (ws / wss). */
export function getWsBaseUrl() {
  try {
    const u = new URL(BACKEND_URL);
    u.protocol = u.protocol === 'https:' ? 'wss:' : 'ws:';
    return u.origin;
  } catch {
    return 'ws://localhost:8000';
  }
}

export default BACKEND_URL;
