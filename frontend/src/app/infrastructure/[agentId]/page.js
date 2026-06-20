"use client";
/**
 * app/infrastructure/[agentId]/page.js
 * Agent Detail Page — SelfHeal Phase 1
 *
 * Shows per-agent metrics, logs, incidents, and process report.
 */

import { useAgent } from '@/hooks/useAgents';
import { usePageTitle } from '@/hooks/usePageTitle';
import { useParams } from 'next/navigation';
import Link from 'next/link';

// ── Helpers ──────────────────────────────────────────────────────────────────

function timeAgo(ts) {
  if (!ts) return '—';
  const secs = Math.floor((Date.now() - new Date(ts).getTime()) / 1000);
  if (secs < 5)  return 'just now';
  if (secs < 60) return `${secs}s ago`;
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`;
  if (secs < 86400) return `${Math.floor(secs / 3600)}h ago`;
  return new Date(ts).toLocaleDateString();
}

function MetricBar({ label, value, unit = '%' }) {
  const num = parseFloat(value) || 0;
  const cls = num > 90 ? 'danger' : num > 70 ? 'warn' : '';
  const color = num > 90 ? 'var(--danger)' : num > 70 ? 'var(--warning)' : 'var(--success)';
  return (
    <div className="metric-bar-wrap">
      <div className="metric-bar-header">
        <span className="metric-bar-label">{label}</span>
        <span className="metric-bar-value" style={{ color }}>{typeof num === 'number' ? num.toFixed(1) : num}{unit}</span>
      </div>
      <div className="metric-bar-track">
        <div className={`metric-bar-fill ${cls}`} style={{ width: `${Math.min(num, 100)}%` }} />
      </div>
    </div>
  );
}

function HealthRing({ score }) {
  const s = Math.max(0, Math.min(100, score ?? 0));
  const color = s >= 80 ? 'var(--success)' : s >= 50 ? 'var(--warning)' : 'var(--danger)';
  const r = 38;
  const circ = 2 * Math.PI * r;
  const dash = (s / 100) * circ;
  return (
    <svg width="90" height="90" viewBox="0 0 90 90">
      <circle cx="45" cy="45" r={r} fill="none" stroke="var(--surface-elevated)" strokeWidth="6" />
      <circle
        cx="45" cy="45" r={r} fill="none"
        stroke={color} strokeWidth="6"
        strokeDasharray={`${dash} ${circ - dash}`}
        strokeLinecap="round"
        transform="rotate(-90 45 45)"
        style={{ transition: 'stroke-dasharray 1.2s cubic-bezier(0.16,1,0.3,1)' }}
      />
      <text x="45" y="49" textAnchor="middle" fill={color}
        style={{ fontSize: '18px', fontWeight: 700, fontFamily: 'var(--font-mono)' }}>
        {s}
      </text>
      <text x="45" y="64" textAnchor="middle" fill="var(--ash)"
        style={{ fontSize: '9px', fontWeight: 600, fontFamily: 'var(--font-mono)', textTransform: 'uppercase', letterSpacing: '0.1em' }}>
        Health
      </text>
    </svg>
  );
}

function SeverityBadge({ severity }) {
  const map = {
    critical: 'badge-critical',
    warning:  'badge-warning',
    info:     'badge-info',
  };
  return <span className={`badge ${map[severity?.toLowerCase()] || 'badge-info'}`}>{severity || '—'}</span>;
}

// ── Sparkline (mini SVG chart for telemetry history) ─────────────────────────

function Sparkline({ data, field, color = 'var(--accent-blue)' }) {
  if (!data?.length) return null;
  const vals = data.map(d => parseFloat(d[field]) || 0).reverse();
  const max = Math.max(...vals, 1);
  const W = 200, H = 36;
  const pts = vals.map((v, i) => {
    const x = (i / (vals.length - 1)) * W;
    const y = H - (v / max) * H;
    return `${x},${y}`;
  }).join(' ');
  return (
    <svg width={W} height={H} style={{ display: 'block' }}>
      <polyline
        points={pts}
        fill="none"
        stroke={color}
        strokeWidth="1.5"
        strokeLinejoin="round"
        strokeLinecap="round"
        opacity="0.8"
      />
    </svg>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function AgentDetailPage() {
  const { agentId } = useParams();
  const { agent, loading, error } = useAgent(agentId, 15_000);
  usePageTitle(agent?.hostname ? `Agent — ${agent.hostname}` : 'Agent Detail');

  if (loading) {
    return (
      <div className="fade-in">
        <Link href="/infrastructure" className="btn btn-ghost btn-sm" style={{ marginBottom: 'var(--sp-xl)' }}>
          ← Infrastructure
        </Link>
        <div className="empty-state"><div className="loading-text">Loading agent…</div></div>
      </div>
    );
  }

  if (error || !agent) {
    return (
      <div className="fade-in">
        <Link href="/infrastructure" className="btn btn-ghost btn-sm" style={{ marginBottom: 'var(--sp-xl)' }}>
          ← Infrastructure
        </Link>
        <div className="card card-danger">
          <div style={{ color: 'var(--danger)', fontWeight: 600 }}>Agent not found</div>
          <div style={{ color: 'var(--ash)', fontSize: 13, marginTop: 4 }}>{error || 'No data returned'}</div>
        </div>
      </div>
    );
  }

  const latestTelemetry = agent.telemetry?.[0] || {};
  const statusColor = agent.status === 'healthy' || agent.status === 'online'
    ? 'var(--success)'
    : agent.status === 'critical' ? 'var(--danger)' : 'var(--warning)';

  const openIncidents = (agent.incidents || []).filter(i => {
    const s = (i.status || '').toLowerCase();
    return s === 'open' || s === 'investigating' || s === 'triggered';
  });

  return (
    <div className="fade-in">
      {/* ── Back ── */}
      <Link href="/infrastructure" className="btn btn-ghost btn-sm" style={{ marginBottom: 'var(--sp-xl)', display: 'inline-flex' }}>
        ← Infrastructure
      </Link>

      {/* ── Agent Header ── */}
      <div className="card slide-up" style={{ marginBottom: 'var(--sp-lg)', display: 'flex', gap: 'var(--sp-xl)', alignItems: 'flex-start', flexWrap: 'wrap' }}>
        <HealthRing score={latestTelemetry.health_score ?? agent.health_score} />

        <div style={{ flex: 1, minWidth: 200 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-md)', marginBottom: 6 }}>
            <h1 style={{ fontSize: '1.25rem', fontWeight: 700, letterSpacing: '-0.02em', color: 'var(--ink)' }}>
              {agent.hostname}
            </h1>
            <span className={`badge ${agent.status === 'healthy' || agent.status === 'online' ? 'badge-healthy' : agent.status === 'critical' ? 'badge-critical' : 'badge-warning'}`}>
              {agent.status}
            </span>
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--sp-md)', marginBottom: 'var(--sp-md)' }}>
            <span className="stat-chip">🌐 {agent.ip || '—'}</span>
            <span className="stat-chip">🖥 {agent.os || '—'}</span>
            <span className="stat-chip">🏷 {agent.environment || 'production'}</span>
            <span className="stat-chip">v{agent.version || '1.0.0'}</span>
          </div>
          <div style={{ fontSize: 12, color: 'var(--ash)' }}>
            Last seen: <span style={{ color: 'var(--charcoal)', fontFamily: 'var(--font-mono)' }}>{timeAgo(agent.last_seen)}</span>
            &nbsp;&middot;&nbsp;
            Agent ID: <span style={{ color: 'var(--charcoal)', fontFamily: 'var(--font-mono)' }}>{agent.agent_id}</span>
          </div>
        </div>
      </div>

      {/* ── Metrics Grid ── */}
      <div className="grid-2" style={{ marginBottom: 'var(--sp-lg)' }}>
        <div className="card slide-up delay-1">
          <div className="card-header">Live Metrics</div>
          <MetricBar label="CPU"    value={latestTelemetry.cpu    ?? 0} />
          <MetricBar label="Memory" value={latestTelemetry.memory ?? 0} />
          <MetricBar label="Disk"   value={latestTelemetry.disk   ?? 0} />
          {latestTelemetry.load_avg !== undefined && (
            <div className="stat-row">
              <span className="stat-row-label">Load Avg (1m)</span>
              <span className="stat-row-value">{parseFloat(latestTelemetry.load_avg || 0).toFixed(2)}</span>
            </div>
          )}
          {latestTelemetry.uptime !== undefined && (
            <div className="stat-row">
              <span className="stat-row-label">Uptime</span>
              <span className="stat-row-value">{Math.floor((latestTelemetry.uptime || 0) / 3600)}h {Math.floor(((latestTelemetry.uptime || 0) % 3600) / 60)}m</span>
            </div>
          )}
        </div>

        <div className="card slide-up delay-2">
          <div className="card-header">Telemetry History</div>
          {agent.telemetry?.length > 1 ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-md)' }}>
              <div>
                <div style={{ fontSize: 11, color: 'var(--ash)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 6 }}>CPU %</div>
                <Sparkline data={agent.telemetry} field="cpu" color="var(--accent-blue)" />
              </div>
              <div>
                <div style={{ fontSize: 11, color: 'var(--ash)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 6 }}>Memory %</div>
                <Sparkline data={agent.telemetry} field="memory" color="var(--healing)" />
              </div>
              <div>
                <div style={{ fontSize: 11, color: 'var(--ash)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 6 }}>Health Score</div>
                <Sparkline data={agent.telemetry} field="health_score" color="var(--success)" />
              </div>
            </div>
          ) : (
            <div className="empty-state" style={{ padding: 'var(--sp-xl)' }}>
              <div style={{ color: 'var(--ash)', fontSize: 13 }}>Not enough data points yet.</div>
            </div>
          )}
        </div>
      </div>

      {/* ── Log Summary ── */}
      {latestTelemetry.log_summary && (
        <div className="card slide-up delay-2" style={{ marginBottom: 'var(--sp-lg)' }}>
          <div className="card-header">Latest Log Summary</div>
          <div className="log-console">
            <div className={`log-line ${latestTelemetry.log_severity === 'CRITICAL' ? 'crit' : latestTelemetry.log_severity === 'ERROR' ? 'error' : latestTelemetry.log_severity === 'WARNING' ? 'warn' : ''}`}>
              [{latestTelemetry.log_severity || 'INFO'}] {latestTelemetry.log_summary}
            </div>
          </div>
        </div>
      )}

      {/* ── Open Incidents ── */}
      <div className="card slide-up delay-3" style={{ marginBottom: 'var(--sp-lg)' }}>
        <div className="card-header">
          Open Incidents
          {openIncidents.length > 0 && (
            <span className="badge badge-critical" style={{ marginLeft: 8 }}>
              {openIncidents.length}
            </span>
          )}
        </div>
        {openIncidents.length === 0 ? (
          <div className="empty-state" style={{ padding: 'var(--sp-xl)' }}>
            <div className="empty-icon">✓</div>
            <div style={{ fontSize: 13, color: 'var(--ash)' }}>No open incidents</div>
          </div>
        ) : (
          <div className="data-table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Severity</th>
                  <th>Type</th>
                  <th>Summary</th>
                  <th>Status</th>
                  <th>Created</th>
                </tr>
              </thead>
              <tbody>
                {openIncidents.map((inc) => (
                  <tr key={inc.id || inc.incident_id} className={inc.severity === 'critical' ? 'row-critical' : ''}>
                    <td><SeverityBadge severity={inc.severity} /></td>
                    <td><span className="text-mono" style={{ fontSize: 12 }}>{inc.type}</span></td>
                    <td style={{ maxWidth: 300, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{inc.summary || '—'}</td>
                    <td><span className="badge badge-warning">Open</span></td>
                    <td style={{ color: 'var(--ash)', fontSize: 12 }}>{timeAgo(inc.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ── Process Report ── */}
      {latestTelemetry.process_report && (
        <div className="card slide-up delay-4" style={{ marginBottom: 'var(--sp-lg)' }}>
          <div className="card-header">Process Report</div>
          <div className="log-console" style={{ maxHeight: 160 }}>
            <pre style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontSize: 12, color: 'var(--body)' }}>
              {typeof latestTelemetry.process_report === 'object'
                ? JSON.stringify(latestTelemetry.process_report, null, 2)
                : latestTelemetry.process_report}
            </pre>
          </div>
        </div>
      )}
    </div>
  );
}
