"use client";
/**
 * app/incidents/page.js
 * Incident Center — SelfHeal Phase 1
 *
 * Shows:
 *  - Summary stats (open / resolved / critical / warning)
 *  - Severity distribution visual
 *  - Filterable incident table
 */

import { useIncidents } from '@/hooks/useIncidents';
import { usePageTitle } from '@/hooks/usePageTitle';
import { useState, useMemo } from 'react';
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

function SeverityBadge({ severity }) {
  const map = {
    critical: 'badge-critical',
    warning:  'badge-warning',
    info:     'badge-info',
  };
  return <span className={`badge ${map[(severity || '').toLowerCase()] || 'badge-info'}`}>{severity || 'info'}</span>;
}

function StatusBadge({ status }) {
  const map = {
    open:     'badge-critical',
    resolved: 'badge-healthy',
    healing:  'badge-healing',
  };
  return <span className={`badge ${map[(status || '').toLowerCase()] || 'badge-info'}`}>{status || '—'}</span>;
}

// ── Severity Distribution Bar ────────────────────────────────────────────────

function SeverityBar({ incidents }) {
  const critical = incidents.filter(i => i.severity === 'critical').length;
  const warning  = incidents.filter(i => i.severity === 'warning').length;
  const info     = incidents.filter(i => i.severity === 'info').length;
  const total    = incidents.length || 1;

  const critPct = Math.round((critical / total) * 100);
  const warnPct = Math.round((warning  / total) * 100);
  const infoPct = 100 - critPct - warnPct;

  return (
    <div style={{ marginTop: 'var(--sp-md)' }}>
      <div style={{ display: 'flex', height: 8, borderRadius: 'var(--radius-full)', overflow: 'hidden', gap: 2 }}>
        {critPct > 0 && <div style={{ width: `${critPct}%`, background: 'var(--danger)', transition: 'width 0.8s ease', borderRadius: 'var(--radius-full)' }} />}
        {warnPct > 0 && <div style={{ width: `${warnPct}%`, background: 'var(--warning)', transition: 'width 0.8s ease', borderRadius: 'var(--radius-full)' }} />}
        {infoPct > 0 && <div style={{ width: `${infoPct}%`, background: 'var(--accent-blue)', opacity: 0.5, transition: 'width 0.8s ease', borderRadius: 'var(--radius-full)' }} />}
      </div>
      <div style={{ display: 'flex', gap: 'var(--sp-lg)', marginTop: 10, fontSize: 12, color: 'var(--ash)' }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--danger)', display: 'inline-block' }} />
          {critical} Critical
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--warning)', display: 'inline-block' }} />
          {warning} Warning
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--accent-blue)', opacity: 0.7, display: 'inline-block' }} />
          {info} Info
        </span>
      </div>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function IncidentsPage() {
  usePageTitle('Incident Center');
  const { incidents, loading, error } = useIncidents(20_000);

  const [statusFilter,   setStatusFilter]   = useState('all');
  const [severityFilter, setSeverityFilter] = useState('all');
  const [search, setSearch]                 = useState('');

  const open     = incidents.filter(i => {
    const s = (i.status || '').toLowerCase();
    return s === 'open' || s === 'investigating' || s === 'triggered';
  });
  const resolved = incidents.filter(i => (i.status || '').toLowerCase() === 'resolved');
  const critical = incidents.filter(i => (i.severity || '').toLowerCase() === 'critical');
  const warnings = incidents.filter(i => (i.severity || '').toLowerCase() === 'warning');

  const filtered = useMemo(() => {
    return incidents.filter(inc => {
      if (statusFilter !== 'all') {
        const s = (inc.status || '').toLowerCase();
        if (statusFilter === 'open' && s !== 'open' && s !== 'investigating' && s !== 'triggered') return false;
        if (statusFilter === 'resolved' && s !== 'resolved') return false;
      }
      if (severityFilter !== 'all' && (inc.severity || '').toLowerCase() !== severityFilter) return false;
      if (search) {
        const q = search.toLowerCase();
        return (
          (inc.summary || '').toLowerCase().includes(q) ||
          (inc.type    || '').toLowerCase().includes(q) ||
          (inc.agent_id || '').toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [incidents, statusFilter, severityFilter, search]);

  return (
    <div className="fade-in">
      {/* ── Header ── */}
      <div style={{ marginBottom: 'var(--sp-xxl)' }}>
        <h1 style={{ fontSize: '1.5rem', fontWeight: 700, letterSpacing: '-0.03em', color: 'var(--ink)', marginBottom: 4 }}>
          Incident Center
        </h1>
        <p style={{ color: 'var(--ash)', fontSize: 13 }}>
          Automatically detected anomalies and rule-triggered incidents.
        </p>
      </div>

      {/* ── Stat Cards ── */}
      <div className="grid-4" style={{ marginBottom: 'var(--sp-xl)' }}>
        <div className="card stat-card fade-in">
          <div className="stat-label">Total Incidents</div>
          <div className="stat-value">{loading ? '…' : incidents.length}</div>
        </div>
        <div className={`card stat-card ${open.length > 0 ? 'stat-card-danger' : ''} fade-in`}>
          <div className="stat-label">Open</div>
          <div className="stat-value">{loading ? '…' : open.length}</div>
        </div>
        <div className="card stat-card stat-card-success fade-in">
          <div className="stat-label">Resolved</div>
          <div className="stat-value">{loading ? '…' : resolved.length}</div>
        </div>
        <div className={`card stat-card ${critical.length > 0 ? 'stat-card-danger' : ''} fade-in`}>
          <div className="stat-label">Critical</div>
          <div className="stat-value">{loading ? '…' : critical.length}</div>
        </div>
      </div>

      {/* ── Severity Distribution ── */}
      {incidents.length > 0 && (
        <div className="card slide-up" style={{ marginBottom: 'var(--sp-xl)' }}>
          <div className="card-header">Severity Distribution</div>
          <SeverityBar incidents={incidents} />
        </div>
      )}

      {/* ── Filters ── */}
      <div style={{ display: 'flex', gap: 'var(--sp-md)', marginBottom: 'var(--sp-lg)', flexWrap: 'wrap', alignItems: 'center' }}>
        <input
          type="text"
          className="field-input"
          placeholder="Search incidents…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          style={{ maxWidth: 280 }}
        />

        <div style={{ display: 'flex', gap: 'var(--sp-sm)', flexWrap: 'wrap' }}>
          {['all', 'open', 'resolved'].map(s => (
            <button
              key={s}
              onClick={() => setStatusFilter(s)}
              className={`btn btn-sm ${statusFilter === s ? 'btn-primary' : 'btn-ghost'}`}
            >
              {s.charAt(0).toUpperCase() + s.slice(1)}
            </button>
          ))}
        </div>

        <div style={{ display: 'flex', gap: 'var(--sp-sm)', flexWrap: 'wrap' }}>
          {['all', 'critical', 'warning', 'info'].map(s => (
            <button
              key={s}
              onClick={() => setSeverityFilter(s)}
              className={`btn btn-sm ${severityFilter === s ? 'btn-primary' : 'btn-ghost'}`}
            >
              {s.charAt(0).toUpperCase() + s.slice(1)}
            </button>
          ))}
        </div>
      </div>

      {/* ── Table ── */}
      {loading && (
        <div className="empty-state"><div className="loading-text">Loading incidents…</div></div>
      )}

      {error && !loading && (
        <div className="card card-danger" style={{ textAlign: 'center', padding: 'var(--sp-xxl)' }}>
          <div style={{ color: 'var(--danger)', fontWeight: 600 }}>Failed to load incidents</div>
          <div style={{ color: 'var(--ash)', fontSize: 13, marginTop: 4 }}>{error}</div>
        </div>
      )}

      {!loading && !error && filtered.length === 0 && (
        <div className="empty-state">
          <div className="empty-icon">🎯</div>
          <div style={{ fontWeight: 600, marginBottom: 4 }}>
            {incidents.length === 0 ? 'No incidents yet' : 'No incidents match filters'}
          </div>
          <div style={{ fontSize: 13 }}>
            {incidents.length === 0
              ? 'Incidents are auto-created when the processing engine detects anomalies.'
              : 'Try adjusting your search or filter criteria.'}
          </div>
        </div>
      )}

      {!loading && !error && filtered.length > 0 && (
        <div className="data-table-wrap slide-up">
          <table className="data-table">
            <thead>
              <tr>
                <th>Severity</th>
                <th>Type</th>
                <th>Summary</th>
                <th>Agent</th>
                <th>Status</th>
                <th>Created</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((inc) => (
                <tr
                  key={inc.id || inc.incident_id}
                  className={(inc.severity === 'critical' && inc.status === 'open') ? 'row-critical' : ''}
                >
                  <td><SeverityBadge severity={inc.severity} /></td>
                  <td>
                    <span className="text-mono" style={{ fontSize: 12, color: 'var(--charcoal)' }}>
                      {inc.type || inc.issue_type || '—'}
                    </span>
                  </td>
                  <td style={{ maxWidth: 320 }}>
                    <span style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {inc.summary || '—'}
                    </span>
                  </td>
                  <td>
                    {inc.agent_id ? (
                      <Link href={`/infrastructure/${inc.agent_id}`}
                        style={{ color: 'var(--accent-blue)', fontSize: 12, fontFamily: 'var(--font-mono)' }}>
                        {inc.agent_id.slice(0, 12)}…
                      </Link>
                    ) : (
                      <span style={{ color: 'var(--ash)', fontSize: 12 }}>{inc.server_id?.slice(0, 12) || '—'}</span>
                    )}
                  </td>
                  <td><StatusBadge status={inc.status} /></td>
                  <td style={{ color: 'var(--ash)', fontSize: 12, fontFamily: 'var(--font-mono)', whiteSpace: 'nowrap' }}>
                    {timeAgo(inc.created_at)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
