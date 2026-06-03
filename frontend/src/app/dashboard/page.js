"use client";
import { useEffect, useState } from 'react';
import { useRealtime }  from '@/context/RealtimeContext';
import { usePageTitle } from '@/hooks/usePageTitle';
import BACKEND_URL from '@/lib/config';

import ServerFleetCard from '@/components/ServerFleetCard';

function MetricBar({ label, value, unit = '%' }) {
  const num = parseFloat(value) || 0;
  const cls = num > 90 ? 'danger' : num > 70 ? 'warn' : '';
  const color = num > 90 ? 'var(--danger)' : num > 70 ? 'var(--warning)' : 'var(--success)';
  return (
    <div className="metric-bar-wrap">
      <div className="metric-bar-header">
        <span className="metric-bar-label">{label}</span>
        <span className="metric-bar-value" style={{ color }}>
          {value}{unit}
        </span>
      </div>
      <div className="metric-bar-track">
        <div className={`metric-bar-fill ${cls}`} style={{ width: `${Math.min(num, 100)}%` }} />
      </div>
    </div>
  );
}

function StatusBadge({ status }) {
  const map = {
    resolved:     { cls: 'badge-healthy',  label: 'Resolved' },
    investigating:{ cls: 'badge-critical', label: 'Investigating' },
    healing:      { cls: 'badge-healing',  label: 'Healing' },
    active:       { cls: 'badge-critical', label: 'Active' },
  };
  const { cls, label } = map[status?.toLowerCase()] || { cls: '', label: status ?? '—' };
  return <span className={`badge ${cls}`}>{label}</span>;
}

export default function Dashboard() {
  usePageTitle('Dashboard');
  const {
    servers,
    stats,
    latestDiagnosis,
    timeline,
    wsConnected,
  } = useRealtime() || {};

  const [incidents, setIncidents] = useState([]);
  const [incidentsLoading, setIncidentsLoading] = useState(true);

  // Fetch real incident history
  useEffect(() => {
    const fetchIncidents = async () => {
      try {
        const r = await fetch(`${BACKEND_URL}/api/history`);
        if (r.ok) setIncidents(await r.json());
      } catch { /* silent */ } finally {
        setIncidentsLoading(false);
      }
    };
    fetchIncidents();
    const id = setInterval(fetchIncidents, 15_000);
    return () => clearInterval(id);
  }, []);

  const healthyCount    = servers?.filter((s) => s.status === 'healthy').length ?? 0;
  const criticalCount   = servers?.filter((s) => s.status === 'critical').length ?? 0;
  const recoveringCount = servers?.filter((s) => s.status === 'recovering').length ?? 0;
  const offlineCount    = servers?.filter((s) => s.status === 'offline').length ?? 0;
  const avgCpu = servers?.length
    ? Math.round(servers.reduce((acc, srv) => acc + (parseFloat(srv.cpu) || 0), 0) / servers.length)
    : null;

  const anyFleetCritical   = (servers || []).some((s) => s.status === 'critical');
  const anyFleetRecovering = (servers || []).some((s) => s.status === 'recovering');

  const banner = anyFleetCritical
    ? { cls: 'failing',   icon: '🔴', title: 'Fleet alert — critical node(s)', sub: `${criticalCount} server(s) require attention` }
    : anyFleetRecovering
    ? { cls: 'recovering', icon: '🧠', title: 'Autonomous recovery in progress', sub: 'LLM diagnosis and healing pipeline running' }
    : { cls: 'healthy',   icon: '✅', title: 'All systems operational', sub: `${servers?.length ?? 0} registered node(s)` };

  const latencySec = latestDiagnosis?.latency_ms != null
    ? (latestDiagnosis.latency_ms / 1000).toFixed(2)
    : null;

  return (
    <div className="fade-in">
      {/* ── Status Banner ── */}
      <div className={`status-banner ${banner.cls}`}>
        <span className="banner-icon">{banner.icon}</span>
        <div>
          <div className="banner-title">{banner.title}</div>
          <div className="banner-sub">{banner.sub}</div>
        </div>
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <span className="live-indicator" title={wsConnected === false ? 'WebSocket disconnected' : 'Live telemetry'}>
            <span className="live-dot" style={{ background: wsConnected === false ? 'var(--danger)' : undefined }} />
            LIVE
          </span>
          <span className={`badge ${anyFleetCritical ? 'badge-critical' : anyFleetRecovering ? 'badge-healing' : 'badge-healthy'}`}>
            {anyFleetCritical ? 'Critical' : anyFleetRecovering ? 'Recovering' : 'Healthy'}
          </span>
        </div>
      </div>

      {/* ── Fleet Summary ── */}
      <p className="section-label slide-up">
        Fleet summary{' '}
        <span className="live-indicator" style={{ fontSize: '0.58rem' }}>
          <span className="live-dot" /> WS
        </span>
      </p>
      <div className="grid-4 slide-up delay-1">
        {[
          { label: 'Total servers',       value: servers?.length ?? 0,                           cls: 'stat-card-accent',  color: 'var(--accent)'         },
          { label: 'Healthy',             value: healthyCount,                                   cls: 'stat-card-success', color: 'var(--success)'        },
          { label: recoveringCount ? 'Critical / recovering' : 'Critical',
            value: recoveringCount ? `${criticalCount} / ${recoveringCount}` : criticalCount,
            cls: criticalCount > 0 || recoveringCount > 0 ? 'stat-card-danger' : '',
            color: criticalCount > 0 || recoveringCount > 0 ? 'var(--danger)' : 'var(--text-secondary)' },
          { label: 'Avg CPU',
            value: avgCpu !== null ? `${avgCpu}%` : stats?.cpuUsage ?? '—',
            cls: avgCpu > 80 ? 'stat-card-warning' : 'stat-card-success',
            color: avgCpu > 80 ? 'var(--warning)' : 'var(--success)' },
        ].map(({ label, value, cls, color }) => (
          <div key={label} className={`card stat-card ${cls}`}>
            <div className="stat-label">{label}</div>
            <div className="stat-value" style={{ color }}>{value}</div>
          </div>
        ))}
      </div>

      {/* ── Live Metrics + AI Diagnosis ── */}
      <div className="grid-2 slide-up delay-2" style={{ marginTop: '1.25rem', marginBottom: '1.25rem' }}>
        <div className="card">
          <div className="card-header">Live cluster metrics</div>
          <MetricBar label="CPU usage"    value={parseFloat(stats?.cpuUsage) || avgCpu || 0} />
          <MetricBar label="Memory usage" value={parseFloat(stats?.memoryUsage) || 0} />
          <div className="card-divider" />
          <div className="stat-row">
            <span className="stat-row-label">Uptime</span>
            <span className="stat-row-value">{stats?.uptime ?? '—'}</span>
          </div>
          <div className="stat-row">
            <span className="stat-row-label">Heal events</span>
            <span className="stat-row-value text-heal">{stats?.healingEvents ?? (incidents.filter(i => i.status === 'resolved').length || '—')}</span>
          </div>
          {offlineCount > 0 && (
            <div className="stat-row">
              <span className="stat-row-label">Offline</span>
              <span className="stat-row-value" style={{ color: 'var(--text-tertiary)' }}>{offlineCount}</span>
            </div>
          )}
        </div>

        <div className="card">
          <div className="card-header">
            AI diagnosis (live) <span className="badge badge-info">Real-time</span>
          </div>
          {latestDiagnosis ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              <p style={{ color: 'var(--text-secondary)', fontSize: '0.78rem' }}>
                Model: <span style={{ color: 'var(--accent)' }}>{latestDiagnosis.model}</span>
                {latencySec != null && <> · Generated in <strong>{latencySec}s</strong></>}
              </p>
              <div>
                <span className="section-label" style={{ marginBottom: '0.25rem', display: 'block' }}>Root cause</span>
                <p style={{ lineHeight: 1.65 }}>{latestDiagnosis.root_cause}</p>
              </div>
              <div>
                <span className="section-label" style={{ marginBottom: '0.25rem', display: 'block' }}>Action taken</span>
                <p style={{ color: 'var(--success)', lineHeight: 1.65 }}>
                  {latestDiagnosis.action_label || latestDiagnosis.action}
                  {latestDiagnosis.action_detail ? ` — ${latestDiagnosis.action_detail}` : ''}
                </p>
              </div>
              <div>
                <span className="section-label" style={{ marginBottom: '0.25rem', display: 'block' }}>Confidence</span>
                <div className="confidence-wrap">
                  <div className="confidence-meta">
                    <span className="confidence-label">Model confidence</span>
                    <span className="confidence-value">{latestDiagnosis.confidence}%</span>
                  </div>
                  <div className="confidence-track">
                    <div className="confidence-fill" style={{ width: `${latestDiagnosis.confidence}%` }} />
                  </div>
                </div>
              </div>
              <div className="explanation-block">
                <strong>Explanation</strong>
                <p style={{ marginTop: '0.35rem', lineHeight: 1.7 }}>{latestDiagnosis.explanation}</p>
              </div>
            </div>
          ) : (
            <p style={{ color: 'var(--text-tertiary)', fontSize: '0.85rem', lineHeight: 1.65 }}>
              When a node crosses CPU&nbsp;&gt;&nbsp;85% or emits error logs, the backend runs the AI diagnosis
              pipeline and streams the result here in real-time.
            </p>
          )}
        </div>
      </div>

      {/* ── Incident Timeline (real) ── */}
      {timeline?.length > 0 && (
        <>
          <p className="section-label slide-up">Incident timeline</p>
          <div className="card slide-up" style={{ marginBottom: '1.25rem' }}>
            <div className="timeline-steps">
              {timeline.map((step, i) => (
                <div key={step.key} className="timeline-step">
                  <div className="timeline-dot-wrap">
                    <span className={`timeline-dot ${step.done ? 'done' : ''}`} />
                    {i < timeline.length - 1 && <span className="timeline-line" />}
                  </div>
                  <div>
                    <div className="timeline-label">{step.label}</div>
                    <div className="timeline-time text-mono">
                      {step.at ? new Date(step.at).toLocaleTimeString() : '—'}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </>
      )}

      {/* ── Registered Servers ── */}
      <p className="section-label slide-up">Registered servers</p>
      {!servers?.length ? (
        <div className="empty-state" style={{ marginBottom: '1.5rem' }}>
          <div className="empty-icon">🖥️</div>
          <p>No servers registered yet. Run the agent on your instance to connect it.</p>
        </div>
      ) : (
        <div className="grid-server-cards slide-up delay-1" style={{ marginBottom: '1.5rem' }}>
          {servers.map((s, i) => (
            <ServerFleetCard key={s.id} s={s} index={i} linkToDetail />
          ))}
        </div>
      )}

      {/* ── Real Incident History ── */}
      <p className="section-label slide-up">Incident history</p>
      <div className="card slide-up" style={{ marginBottom: '1.5rem' }}>
        {incidentsLoading ? (
          <p className="loading-text">Loading incidents…</p>
        ) : incidents.length === 0 ? (
          <p style={{ color: 'var(--text-tertiary)', fontSize: '0.85rem' }}>
            ✅ No incidents recorded. Your fleet is clean.
          </p>
        ) : (
          <div className="data-table-wrap" style={{ maxHeight: 360 }}>
            <table className="data-table">
              <thead>
                <tr>
                  <th>Time</th>
                  <th>Node</th>
                  <th>Root Cause</th>
                  <th>Action</th>
                  <th>Confidence</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {incidents.map((inc, i) => (
                  <tr key={inc.id || i}>
                    <td style={{ color: 'var(--text-tertiary)', fontFamily: 'var(--font-mono)', fontSize: '0.72rem', whiteSpace: 'nowrap' }}>
                      {inc.timestamp ? new Date(inc.timestamp).toLocaleString() : '—'}
                    </td>
                    <td style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, fontSize: '0.78rem' }}>
                      {inc.node ?? '—'}
                    </td>
                    <td style={{ fontSize: '0.78rem', maxWidth: 280, color: 'var(--text-secondary)' }}>
                      {inc.root_cause ?? '—'}
                    </td>
                    <td style={{ fontSize: '0.78rem', color: 'var(--success)', maxWidth: 200 }}>
                      {inc.action ?? '—'}
                    </td>
                    <td style={{ fontFamily: 'var(--font-mono)', fontSize: '0.78rem' }}>
                      {inc.confidence != null ? `${inc.confidence}%` : '—'}
                    </td>
                    <td><StatusBadge status={inc.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
