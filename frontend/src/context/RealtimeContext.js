'use client';

/**
 * context/RealtimeContext.js
 *
 * Data strategy — zero polling, zero redundant calls:
 *
 *  1. Mount  → 2 parallel fetches (initial load only):
 *               GET /api/latest   → servers + latest AI diagnosis
 *               GET /api/history  → incident list
 *
 *  2. Live   → EventSource to GET /api/events (SSE):
 *               server:updated  → patch ONE server row in state (per heartbeat)
 *               servers:update  → replace full list (healing pipeline status changes)
 *               diagnosis:new   → update AI diagnosis card + timeline
 *               incident:new    → prepend to incident list
 *               connected       → mark status as 'live'
 *
 *  3. Local  → 30s interval, pure timestamp math, zero network I/O:
 *               Marks servers offline if last_seen is stale.
 *
 * Browser EventSource reconnects automatically on any drop — no retry logic needed.
 * No Supabase account or paid plan required.
 */

import {
  createContext, useCallback, useContext,
  useEffect, useRef, useState,
} from 'react';
import BACKEND_URL from '@/lib/config';

const Ctx = createContext(null);

// Mirrors backend STALE_THRESHOLD_MS
const STALE_MS = 60_000;

function applyOnlineStatus(server) {
  if (!server?.last_seen) return server;
  const age = Date.now() - new Date(server.last_seen).getTime();
  if (age > STALE_MS && server.status !== 'critical') {
    return { ...server, status: 'offline' };
  }
  return server;
}

/** Surgically patch one server row into the list by id. Adds it if not found. */
function patchServer(list, row) {
  const withStatus = applyOnlineStatus(row);
  const idx = list.findIndex(s => s.id === row.id);
  if (idx === -1) return [withStatus, ...list];
  const next = [...list];
  next[idx] = { ...list[idx], ...withStatus };
  return next;
}

/** Prepend incident, deduped by id. */
function prependIncident(list, incident) {
  if (list.some(e => e.id === incident.id)) return list;
  return [incident, ...list];
}

export function RealtimeProvider({ children }) {
  const [servers,         setServers]         = useState([]);
  const [events,          setEvents]          = useState([]);
  const [latestDiagnosis, setLatestDiagnosis] = useState(null);
  const [timeline,        setTimeline]        = useState([]);
  const [notifications,   setNotifications]   = useState([]);
  const [realtimeStatus,  setRealtimeStatus]  = useState('connecting');

  const mountedRef    = useRef(true);
  const notifId       = useRef(0);
  const prevStatusRef = useRef({});   // id → last known status (for notifications)
  const esRef         = useRef(null); // EventSource ref

  // ── Notifications ─────────────────────────────────────────────────────────
  const pushNotification = useCallback((msg, type = 'info') => {
    const id = ++notifId.current;
    setNotifications(prev => [...prev.slice(-4), { id, msg, type }]);
    setTimeout(() => {
      if (mountedRef.current) setNotifications(prev => prev.filter(n => n.id !== id));
    }, 5500);
  }, []);

  // ── Status-change notifications ───────────────────────────────────────────
  const notifyStatusChange = useCallback((server) => {
    const prev = prevStatusRef.current[server.id];
    if (!prev || prev === server.status) return;
    if (server.status === 'critical')   pushNotification(`⚠ Alert — ${server.name}`, 'danger');
    if (server.status === 'recovering') pushNotification(`🧠 AI analyzing — ${server.name}`, 'info');
    if (server.status === 'healthy' && (prev === 'critical' || prev === 'recovering')) {
      pushNotification(`✅ Recovered — ${server.name}`, 'success');
    }
    prevStatusRef.current[server.id] = server.status;
  }, [pushNotification]);

  // ── Timeline builder ──────────────────────────────────────────────────────
  const buildTimeline = useCallback((diag) => {
    const now = new Date().toISOString();
    setTimeline([
      { key: 'detected', label: 'Issue detected',   done: true, at: diag.created_at  || now },
      { key: 'ai',       label: 'AI analyzed',      done: true, at: diag.created_at  || now },
      { key: 'action',   label: 'Action executed',  done: true, at: diag.resolved_at || now },
      { key: 'recovery', label: 'Recovery complete', done: true, at: diag.resolved_at || now },
    ]);
  }, []);

  // ── 1. Initial load (two parallel fetches, once on mount) ─────────────────
  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const [latestRes, historyRes] = await Promise.all([
          fetch(`${BACKEND_URL}/api/latest`),
          fetch(`${BACKEND_URL}/api/history?limit=100`),
        ]);
        if (cancelled) return;

        if (latestRes.ok) {
          const { servers: srvs, latest_diagnosis: dx } = await latestRes.json();
          if (srvs?.length) {
            const withStatus = srvs.map(applyOnlineStatus);
            setServers(withStatus);
            withStatus.forEach(s => { prevStatusRef.current[s.id] = s.status; });
          }
          if (dx) { setLatestDiagnosis(dx); buildTimeline(dx); }
        }

        if (historyRes.ok) {
          const incidents = await historyRes.json();
          if (Array.isArray(incidents)) setEvents(incidents);
        }
      } catch (err) {
        console.warn('[Realtime] Initial fetch failed:', err.message);
      }
    }
    load();
    return () => { cancelled = true; };
  }, [buildTimeline]);

  // ── 2. SSE subscription (EventSource — auto-reconnects natively) ───────────
  useEffect(() => {
    mountedRef.current = true;

    function connect() {
      if (!mountedRef.current) return;

      const es = new EventSource(`${BACKEND_URL}/api/events`);
      esRef.current = es;

      // ── Connected ──
      es.addEventListener('connected', () => {
        if (!mountedRef.current) return;
        setRealtimeStatus('live');
        console.log('[SSE] ✅ Connected to event stream');
      });

      // ── Single server updated (most frequent — every heartbeat) ──
      es.addEventListener('server:updated', (e) => {
        if (!mountedRef.current) return;
        try {
          const row = JSON.parse(e.data);
          setServers(prev => {
            const next = patchServer(prev, row);
            notifyStatusChange(row);
            prevStatusRef.current[row.id] = row.status;
            return next;
          });
        } catch { /* ignore */ }
      });

      // ── Full server list (healing pipeline status changes) ──
      es.addEventListener('servers:update', (e) => {
        if (!mountedRef.current) return;
        try {
          const rows = JSON.parse(e.data);
          if (Array.isArray(rows)) {
            const withStatus = rows.map(applyOnlineStatus);
            withStatus.forEach(s => notifyStatusChange(s));
            setServers(withStatus);
          }
        } catch { /* ignore */ }
      });

      // ── New incident ──
      es.addEventListener('incident:new', (e) => {
        if (!mountedRef.current) return;
        try {
          const incident = JSON.parse(e.data);
          setEvents(prev => prependIncident(prev, incident));
        } catch { /* ignore */ }
      });

      // ── AI diagnosis complete ──
      es.addEventListener('diagnosis:new', (e) => {
        if (!mountedRef.current) return;
        try {
          const diag = JSON.parse(e.data);
          setLatestDiagnosis(diag);
          buildTimeline(diag);
          pushNotification('🔄 Healing pipeline completed', 'success');
        } catch { /* ignore */ }
      });

      // ── EventSource error (network drop) ──
      // EventSource auto-reconnects — just show degraded status while disconnected
      es.onerror = () => {
        if (!mountedRef.current) return;
        setRealtimeStatus('connecting');
        console.warn('[SSE] Connection lost — browser will retry automatically');
      };
    }

    connect();

    return () => {
      mountedRef.current = false;
      esRef.current?.close();
      esRef.current = null;
    };
  }, [buildTimeline, pushNotification, notifyStatusChange]);

  // ── 3. Offline sweep — local timestamp math, zero network calls ───────────
  useEffect(() => {
    const id = setInterval(() => {
      if (!mountedRef.current) return;
      setServers(prev => {
        const next = prev.map(applyOnlineStatus);
        const changed = next.some((s, i) => s.status !== prev[i]?.status);
        return changed ? next : prev; // bail early if nothing changed
      });
    }, 30_000);
    return () => clearInterval(id);
  }, []);

  // ── Derived stats (computed from state — zero fetches) ────────────────────
  const stats = {
    totalServers:    servers.length,
    healthyCount:    servers.filter(s => s.status === 'healthy').length,
    criticalCount:   servers.filter(s => s.status === 'critical').length,
    offlineCount:    servers.filter(s => s.status === 'offline').length,
    recoveringCount: servers.filter(s => s.status === 'recovering').length,
    totalIncidents:  events.length,
    avgCpu: servers.length
      ? Math.round(servers.reduce((a, s) => a + (parseFloat(s.cpu) || 0), 0) / servers.length)
      : null,
    // Legacy field — some pages read stats.cpuUsage as a string
    get cpuUsage() { return this.avgCpu != null ? `${this.avgCpu}%` : '—'; },
    healingEvents: events.filter(e => e.status === 'resolved').length,
  };

  const removeServer = useCallback(id =>
    setServers(prev => prev.filter(s => s.id !== id)), []);

  return (
    <Ctx.Provider value={{
      servers,
      events,
      stats,
      latestDiagnosis,
      timeline,
      notifications,
      wsConnected:    realtimeStatus === 'live',
      realtimeStatus,
      pushNotification,
      setServers,
      removeServer,
    }}>
      {children}
    </Ctx.Provider>
  );
}

export const useRealtime = () => useContext(Ctx);
