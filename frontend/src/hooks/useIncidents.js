'use client';
/**
 * hooks/useIncidents.js
 * Polling hook for fetching incidents from /api/history.
 * Refreshes every 20 seconds.
 */

import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@clerk/nextjs';
import BACKEND_URL, { CLERK_JWT_TEMPLATE } from '@/lib/config';

export function useIncidents(refreshMs = 20_000) {
  const { getToken, isSignedIn } = useAuth();
  const [incidents, setIncidents] = useState([]);
  const [loading, setLoading]     = useState(true);
  const [error, setError]         = useState(null);

  const fetchIncidents = useCallback(async () => {
    if (!isSignedIn) return;
    try {
      const token = await getToken({ template: CLERK_JWT_TEMPLATE });
      const r = await fetch(`${BACKEND_URL}/api/history`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const data = await r.json();
      setIncidents(data);
      setError(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [isSignedIn, getToken]);

  useEffect(() => {
    fetchIncidents();
    const id = setInterval(fetchIncidents, refreshMs);
    return () => clearInterval(id);
  }, [fetchIncidents, refreshMs]);

  return { incidents, loading, error, refetch: fetchIncidents };
}
