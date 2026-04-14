"use client";
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

import BACKEND_URL from '@/lib/config';

function MetricBar({ label, value, maxVal = 100 }) {
  const num = parseFloat(value) || 0;
  const pct = Math.min((num / maxVal) * 100, 100);
  const cls = num > 90 ? 'danger' : num > 70 ? 'warn' : '';
  const color = num > 90 ? 'var(--danger)' : num > 70 ? 'var(--warning)' : 'var(--success)';
  return (
    <div className="metric-bar-wrap" style={{ marginBottom: '1.25rem' }}>
      <div className="metric-bar-header" style={{ marginBottom: '0.5rem' }}>
        <span className="metric-bar-label" style={{ fontSize: '0.72rem' }}>{label}</span>
        <span className="metric-bar-value" style={{ color, fontSize: '1.1rem', fontFamily: 'var(--font-mono)', fontWeight: 800 }}>{value || '—'}</span>
      </div>
      <div className="metric-bar-track" style={{ height: 10, borderRadius: 5 }}>
        <div className={`metric-bar-fill ${cls}`} style={{ width: `${pct}%`, borderRadius: 5 }} />
      </div>
    </div>
  );
}

export default function ServerDetail({ params }) {
  const router = useRouter();
  const [server, setServer]   = useState(null);
  const [metrics, setMetrics] = useState([]);
  const [loading, setLoading] = useState(true);
  const [actionStatus, setActionStatus] = useState(null);
  const [dispatchingAction, setDispatchingAction] = useState(null);
  const [logs, setLogs] = useState([]);
  const [serverId, setServerId] = useState(null);

  // Next.js 15+ params is a Promise — unwrap it
  useEffect(() => {
    Promise.resolve(params).then(p => setServerId(p?.id));
  }, [params]);

  useEffect(() => {
    if (!serverId) return;
    const fetchAll = async () => {
      try {
        const [sr, mr] = await Promise.all([
          fetch(`${BACKEND_URL}/api/servers/${serverId}`),
          fetch(`${BACKEND_URL}/api/metrics/${serverId}?limit=10`),
        ]);
        if (sr.ok) { const data = await sr.json(); setServer(data); }
        if (mr.ok) {
          const mData = await mr.json();
          setMetrics(mData);
          // Collect non-null logs
          const logLines = mData.filter(m => m.logs).flatMap(m => m.logs.split('\n')).slice(0, 15);
          setLogs(logLines);
        }
      } catch (_) {
      } finally {
        setLoading(false);
      }
    };
    fetchAll();
    const id = setInterval(fetchAll, 5000);
    return () => clearInterval(id);
  }, [serverId]);

  const dispatchCommand = async (command) => {
    setDispatchingAction(command);
    setActionStatus(null);
    try {
      const r = await fetch(`${BACKEND_URL}/api/commands/${serverId}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ command, dispatched_by: 'dashboard' }),
      });
      if (r.ok) {
        setActionStatus({ type: 'success', msg: `✅ "${command}" dispatched — agent will execute on next poll.` });
      } else {
        setActionStatus({ type: 'error', msg: '⚠ Command dispatch failed.' });
      }
    } catch {
      setActionStatus({ type: 'error', msg: '⚠ Cannot reach backend.' });
    }
    setDispatchingAction(null);
  };

  const ACTIONS = [
    { key: 'restart_service', cls: 'restart', icon: '🔄', label: 'Restart Service', sub: 'Graceful restart' },
    { key: 'scale_up',        cls: 'scale',   icon: '📈', label: 'Scale Up',        sub: '+2 replicas'     },
    { key: 'kill_process',    cls: 'kill',    icon: '🔪', label: 'Kill Process',    sub: 'Top CPU consumer' },
  ];

  if (loading) return <div style={{ textAlign: 'center', paddingTop: '4rem' }}><p className="loading-text">Loading server details...</p></div>;
  if (!server)  return <div style={{ textAlign: 'center', paddingTop: '4rem' }}><p style={{ color: 'var(--danger)' }}>Server not found.</p></div>;

  const isCritical = server.status === 'critical';

  return (
    <div className="fade-in">
      {/* ── Back + Header ── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '1.5rem' }}>
        <button onClick={() => router.back()} className="btn btn-outline btn-sm">← Back</button>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <span className={`status-dot ${isCritical ? 'dot-danger' : 'dot-success'}`} style={{ width: 10, height: 10 }}></span>
            <span style={{ fontSize: '1.1rem', fontWeight: 800 }}>{server.name}</span>
            <span className={`badge ${isCritical ? 'badge-critical' : 'badge-healthy'}`}>{server.status}</span>
          </div>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.75rem', color: 'var(--text-tertiary)', marginTop: '2px' }}>
            {server.ip_address} · {server.region || 'unknown region'} · ID: {server.id}
          </div>
        </div>
      </div>

      <div className="grid-2">
        {/* ── Left: Metrics + Actions ── */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          {/* Metric Bars */}
          <div className={`card ${isCritical ? 'card-danger' : ''}`}>
            <div className="card-header">Live Metrics</div>
            <MetricBar label="CPU Usage"    value={server.cpu}    />
            <MetricBar label="Memory Usage" value={server.memory} />
            <div className="stat-row"><span className="stat-row-label">Uptime</span><span className="stat-row-value">{server.uptime || '—'}</span></div>
            <div className="stat-row"><span className="stat-row-label">Last Seen</span><span className="stat-row-value text-mono" style={{ fontSize: '0.72rem' }}>{new Date(server.last_seen).toLocaleString()}</span></div>
          </div>

          {/* Metric History Sparkline (simple bar chart) */}
          {metrics.length > 1 && (
            <div className="card">
              <div className="card-header">CPU History (last {metrics.length} readings)</div>
              <div style={{ display: 'flex', alignItems: 'flex-end', gap: '3px', height: '60px', paddingTop: '4px' }}>
                {[...metrics].reverse().map((m, i) => {
                  const h = Math.max(4, ((m.cpu || 0) / 100) * 60);
                  const color = m.cpu > 90 ? 'var(--danger)' : m.cpu > 70 ? 'var(--warning)' : 'var(--success)';
                  return (
                    <div key={i} title={`${m.cpu}% @ ${new Date(m.timestamp).toLocaleTimeString()}`}
                      style={{ flex: 1, height: `${h}px`, background: color, borderRadius: '2px 2px 0 0', opacity: 0.8, transition: 'height 0.5s ease' }} />
                  );
                })}
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.65rem', color: 'var(--text-tertiary)', marginTop: '6px' }}>
                <span>Oldest</span><span>↔</span><span>Latest</span>
              </div>
            </div>
          )}

          {/* Action Buttons */}
          <div className="card">
            <div className="card-header">Remediation Actions</div>
            <p style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', marginBottom: '0.875rem' }}>
              Commands are dispatched to the running agent on this server.
            </p>
            <div className="action-grid">
              {ACTIONS.map(({ key, cls, icon, label, sub }) => (
                <button key={key} className={`action-btn ${cls}`}
                  onClick={() => dispatchCommand(key)} disabled={!!dispatchingAction}>
                  <span className="action-icon">{dispatchingAction === key ? '⏳' : icon}</span>
                  <span className="action-label">{label}</span>
                  <span className="action-sub">{sub}</span>
                </button>
              ))}
            </div>
            {actionStatus && (
              <div style={{
                marginTop: '0.875rem', padding: '0.625rem 0.875rem', borderRadius: 'var(--radius-sm)',
                background: actionStatus.type === 'success' ? 'var(--success-bg)' : 'var(--danger-bg)',
                border: `1px solid ${actionStatus.type === 'success' ? 'var(--success-border)' : 'var(--danger-border)'}`,
                fontSize: '0.8rem', color: actionStatus.type === 'success' ? 'var(--success)' : 'var(--danger)',
              }}>{actionStatus.msg}</div>
            )}
          </div>
        </div>

        {/* ── Right: Server Info + Logs ── */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <div className="card">
            <div className="card-header">Server Info</div>
            {[
              ['ID',         server.id],
              ['Name',       server.name],
              ['IP Address', server.ip_address],
              ['Region',     server.region || '—'],
              ['Status',     server.status],
              ['CPU',        server.cpu    || '—'],
              ['Memory',     server.memory || '—'],
              ['Uptime',     server.uptime || '—'],
            ].map(([k, v]) => (
              <div className="stat-row" key={k}>
                <span className="stat-row-label">{k}</span>
                <span className="stat-row-value text-mono">{v}</span>
              </div>
            ))}
          </div>

          {/* Logs */}
          <div className="card" style={{ flex: 1 }}>
            <div className="card-header">
              Recent Logs
              {logs.length === 0 && <span style={{ color: 'var(--success)', fontWeight: 400, textTransform: 'none', letterSpacing: 0 }}>Clean</span>}
            </div>
            <div className="log-console" style={{ maxHeight: '280px' }}>
              {logs.length === 0
                ? <span style={{ color: 'var(--text-tertiary)' }}>No error logs detected. System is clean.</span>
                : logs.map((line, i) => {
                    const cls = line.toLowerCase().includes('crit') ? 'log-line crit' : line.toLowerCase().includes('error') ? 'log-line error' : 'log-line warn';
                    return <div key={i} className={cls} style={{ animationDelay: `${i * 0.05}s` }}>{line}</div>;
                  })}
            </div>
          </div>

          {/* Metric history table */}
          {metrics.length > 0 && (
            <div className="card">
              <div className="card-header">Metric History</div>
              <div className="data-table-wrap" style={{ maxHeight: 220 }}>
                <table className="data-table">
                  <thead><tr><th>Time</th><th>CPU</th><th>Memory</th><th>Uptime</th></tr></thead>
                  <tbody>
                    {metrics.map((m, i) => (
                      <tr key={i}>
                        <td style={{ color: 'var(--text-tertiary)', fontFamily: 'var(--font-mono)', fontSize: '0.72rem' }}>{new Date(m.timestamp).toLocaleTimeString()}</td>
                        <td style={{ color: m.cpu > 90 ? 'var(--danger)' : m.cpu > 70 ? 'var(--warning)' : 'var(--success)', fontFamily: 'var(--font-mono)', fontWeight: 700 }}>{m.cpu != null ? `${m.cpu}%` : '—'}</td>
                        <td style={{ fontFamily: 'var(--font-mono)' }}>{m.memory != null ? `${m.memory}%` : '—'}</td>
                        <td style={{ color: 'var(--text-tertiary)', fontFamily: 'var(--font-mono)' }}>{m.uptime ? `${m.uptime}s` : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
