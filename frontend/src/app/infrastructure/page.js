"use client";
/**
 * app/infrastructure/page.js
 * Infrastructure Overview — SelfHeal Phase 1
 *
 * Displays:
 *  - Fleet summary stat cards (total / healthy / critical / avg health)
 *  - Agent grid with per-agent status, CPU, memory, health score, last seen
 *  - Links to per-agent detail page
 */

import { useAgents } from '@/hooks/useAgents';
import { usePageTitle } from '@/hooks/usePageTitle';
import Link from 'next/link';

// ── Helpers ──────────────────────────────────────────────────────────────────

function timeAgo(ts) {
  if (!ts) return '—';
  const secs = Math.floor((Date.now() - new Date(ts).getTime()) / 1000);
  if (secs < 5)  return 'just now';
  if (secs < 60) return `${secs}s ago`;
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`;
  if (secs < 86400) return `${Math.floor(secs / 3600)}h ago`;
  return `${Math.floor(secs / 86400)}d ago`;
}

function statusClass(status) {
  switch ((status || '').toLowerCase()) {
    case 'healthy':  return 'badge-healthy';
    case 'critical': return 'badge-critical';
    case 'degraded': return 'badge-warning';
    case 'online':   return 'badge-healthy';
    case 'offline':  return 'badge-offline';
    default:         return 'badge-offline';
  }
}

function cardClass(status) {
  switch ((status || '').toLowerCase()) {
    case 'critical': return 'card-critical';
    case 'degraded': return 'card-warning';
    case 'offline':  return 'card-offline';
    default:         return '';
  }
}

function HealthRing({ score }) {
  const s = Math.max(0, Math.min(100, score ?? 0));
  const color = s >= 80 ? 'var(--success)' : s >= 50 ? 'var(--warning)' : 'var(--danger)';
  const r = 22;
  const circ = 2 * Math.PI * r;
  const dash = (s / 100) * circ;
  return (
    <svg width="54" height="54" viewBox="0 0 54 54" style={{ flexShrink: 0 }}>
      <circle cx="27" cy="27" r={r} fill="none" stroke="var(--surface-elevated)" strokeWidth="4" />
      <circle
        cx="27" cy="27" r={r} fill="none"
        stroke={color} strokeWidth="4"
        strokeDasharray={`${dash} ${circ - dash}`}
        strokeLinecap="round"
        transform="rotate(-90 27 27)"
        style={{ transition: 'stroke-dasharray 1.2s cubic-bezier(0.16,1,0.3,1)' }}
      />
      <text x="27" y="31" textAnchor="middle" fill={color}
        style={{ fontSize: '12px', fontWeight: 700, fontFamily: 'var(--font-mono)' }}>
        {s}
      </text>
    </svg>
  );
}

function MetricBar({ label, value }) {
  const num = parseFloat(value) || 0;
  const cls = num > 90 ? 'danger' : num > 70 ? 'warn' : '';
  const color = num > 90 ? 'var(--danger)' : num > 70 ? 'var(--warning)' : 'var(--success)';
  return (
    <div className="metric-bar-wrap">
      <div className="metric-bar-header">
        <span className="metric-bar-label">{label}</span>
        <span className="metric-bar-value" style={{ color }}>{num.toFixed(1)}%</span>
      </div>
      <div className="metric-bar-track">
        <div className={`metric-bar-fill ${cls}`} style={{ width: `${Math.min(num, 100)}%` }} />
      </div>
    </div>
  );
}

function AgentCard({ agent }) {
  const cc = cardClass(agent.status);
  return (
    <Link href={`/infrastructure/${agent.agent_id}`} style={{ textDecoration: 'none' }}>
      <div className={`card server-card card-clickable ${cc} fade-in`} style={{ position: 'relative', overflow: 'hidden' }}>
        {agent.status === 'critical' && <div className="critical-glow-ring" />}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 'var(--sp-lg)' }}>
          <div style={{ minWidth: 0 }}>
            <div className="server-card-name">
              <span className={`status-dot dot-${agent.status === 'healthy' || agent.status === 'online' ? 'success' : agent.status === 'critical' ? 'danger' : agent.status === 'degraded' ? 'warning' : 'offline'}`}
                style={{ width: 8, height: 8 }} />
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {agent.hostname}
              </span>
            </div>
            <div className="server-card-ip" style={{ marginBottom: 4 }}>
              {agent.ip || '—'} &middot; {agent.environment || 'production'}
            </div>
            <span className={`badge ${statusClass(agent.status)}`}>{agent.status || 'unknown'}</span>
          </div>
          <HealthRing score={agent.health_score} />
        </div>

        <MetricBar label="CPU" value={agent.cpu} />
        <MetricBar label="Memory" value={agent.memory} />

        <div className="server-card-footer">
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11 }}>{agent.os ? agent.os.slice(0, 22) : '—'}</span>
          <span>Last seen {timeAgo(agent.last_seen)}</span>
        </div>
      </div>
    </Link>
  );
}

// ── Summary stat card ──────────────────────────────────────────────────────

function StatCard({ label, value, variant, delta }) {
  return (
    <div className={`card stat-card ${variant ? `stat-card-${variant}` : ''} fade-in`}>
      <div className="stat-label">{label}</div>
      <div className="stat-value">{value ?? '—'}</div>
      {delta && <div className="stat-delta">{delta}</div>}
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function InfrastructurePage() {
  usePageTitle('Infrastructure');
  const { agents, loading, error } = useAgents(15_000);

  const total    = agents.length;
  const healthy  = agents.filter(a => a.status === 'healthy' || a.status === 'online').length;
  const critical = agents.filter(a => a.status === 'critical').length;
  const degraded = agents.filter(a => a.status === 'degraded').length;
  const offline  = agents.filter(a => a.status === 'offline').length;
  const avgHealth = total
    ? Math.round(agents.reduce((s, a) => s + (a.health_score ?? 0), 0) / total)
    : null;

  const anyFleetCritical = critical > 0;

  return (
    <div className="fade-in">
      {/* ── Header ── */}
      <div style={{ marginBottom: 'var(--sp-xxl)' }}>
        <h1 style={{ fontSize: '1.5rem', fontWeight: 700, letterSpacing: '-0.03em', color: 'var(--ink)', marginBottom: 4 }}>
          Infrastructure
        </h1>
        <p style={{ color: 'var(--ash)', fontSize: 13 }}>
          Live telemetry from all registered SelfHeal agents.
        </p>
      </div>

      {/* ── Status Banner ── */}
      {anyFleetCritical && (
        <div className="status-banner failing" style={{ marginBottom: 'var(--sp-xl)' }}>
          <span className="banner-icon">⚠</span>
          <div>
            <div className="banner-title">{critical} agent{critical !== 1 ? 's' : ''} in critical state</div>
            <div className="banner-sub">Review agent cards below for details.</div>
          </div>
        </div>
      )}
      {!anyFleetCritical && !loading && total > 0 && (
        <div className="status-banner healthy" style={{ marginBottom: 'var(--sp-xl)' }}>
          <span className="banner-icon">✓</span>
          <div>
            <div className="banner-title">All systems nominal</div>
            <div className="banner-sub">{healthy} of {total} agents reporting healthy.</div>
          </div>
        </div>
      )}

      {/* ── Fleet Stats ── */}
      <div className="grid-4" style={{ marginBottom: 'var(--sp-xl)' }}>
        <StatCard label="Total Agents"     value={loading ? '…' : total}    />
        <StatCard label="Healthy"          value={loading ? '…' : healthy}   variant="success" delta={`${total > 0 ? Math.round((healthy / total) * 100) : 0}% of fleet`} />
        <StatCard label="Critical"         value={loading ? '…' : critical}  variant={critical > 0 ? 'danger' : undefined} />
        <StatCard label="Avg Health Score" value={loading ? '…' : (avgHealth !== null ? `${avgHealth}` : '—')} variant={avgHealth !== null && avgHealth < 60 ? 'danger' : avgHealth !== null && avgHealth < 80 ? 'warning' : 'success'} delta="/100" />
      </div>

      {/* ── Secondary Stats Row ── */}
      {(degraded > 0 || offline > 0) && (
        <div style={{ display: 'flex', gap: 'var(--sp-md)', marginBottom: 'var(--sp-xl)', flexWrap: 'wrap' }}>
          {degraded > 0 && (
            <span className="badge badge-warning">{degraded} degraded</span>
          )}
          {offline > 0 && (
            <span className="badge badge-offline">{offline} offline</span>
          )}
        </div>
      )}

      {/* ── Agent Grid ── */}
      <div className="section-label" style={{ marginBottom: 'var(--sp-lg)' }}>
        Agents
      </div>

      {loading && (
        <div className="empty-state">
          <div className="loading-text">Loading agents…</div>
        </div>
      )}

      {error && !loading && (
        <div className="card card-danger" style={{ textAlign: 'center', padding: 'var(--sp-xxl)' }}>
          <div style={{ color: 'var(--danger)', fontWeight: 600, marginBottom: 8 }}>Failed to load agents</div>
          <div style={{ color: 'var(--ash)', fontSize: 13 }}>{error}</div>
        </div>
      )}

      {!loading && !error && total === 0 && (
        <div className="empty-state">
          <div className="empty-icon">🖥️</div>
          <div style={{ fontWeight: 600, marginBottom: 4 }}>No agents registered</div>
          <div style={{ fontSize: 13 }}>Deploy the SelfHeal Agent to your servers to start collecting telemetry.</div>
        </div>
      )}

      {!loading && !error && total > 0 && (
        <div className="grid-server-cards">
          {agents.map((agent) => (
            <AgentCard key={agent.agent_id || agent.id} agent={agent} />
          ))}
        </div>
      )}
    </div>
  );
}
