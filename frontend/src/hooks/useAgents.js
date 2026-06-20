'use client';
/**
 * hooks/useAgents.js
 * Polling hook for fetching agent data from /api/agents.
 * Refreshes every 15 seconds.
 */

import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@clerk/nextjs';
import BACKEND_URL, { CLERK_JWT_TEMPLATE } from '@/lib/config';

export function useAgents(refreshMs = 15_000) {
  const { getToken, isSignedIn } = useAuth();
  const [agents, setAgents]     = useState([]);
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState(null);

  const fetchAgents = useCallback(async () => {
    if (!isSignedIn) return;
    try {
      const token = await getToken({ template: CLERK_JWT_TEMPLATE });
      const r = await fetch(`${BACKEND_URL}/api/agents`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const data = await r.json();
      setAgents(data);
      setError(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [isSignedIn, getToken]);

  useEffect(() => {
    fetchAgents();
    const id = setInterval(fetchAgents, refreshMs);
    return () => clearInterval(id);
  }, [fetchAgents, refreshMs]);

  return { agents, loading, error, refetch: fetchAgents };
}

export function useAgent(agentId, refreshMs = 15_000) {
  const { getToken, isSignedIn } = useAuth();
  const [agent, setAgent]       = useState(null);
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState(null);

  const fetchAgent = useCallback(async () => {
    if (!isSignedIn || !agentId) return;
    try {
      const token = await getToken({ template: CLERK_JWT_TEMPLATE });
      const r = await fetch(`${BACKEND_URL}/api/agents/${agentId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const data = await r.json();
      setAgent(data);
      setError(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [isSignedIn, getToken, agentId]);

  useEffect(() => {
    fetchAgent();
    const id = setInterval(fetchAgent, refreshMs);
    return () => clearInterval(id);
  }, [fetchAgent, refreshMs]);

  return { agent, loading, error, refetch: fetchAgent };
}
