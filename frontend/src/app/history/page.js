"use client";
import { useState }     from 'react';
import { useRealtime }  from '@/context/RealtimeContext';
import { usePageTitle } from '@/hooks/usePageTitle';


export default function History() {
  usePageTitle('Incident Log');

  const { events } = useRealtime();
  const [filter, setFilter] = useState('ALL');

  const filtered = filter === 'ALL' ? events : events.filter(e => e.type === filter);

  const counts = {
    ALL:     events.length,
    ALERT:   events.filter(e => e.type === 'ALERT').length,
    HEALING: events.filter(e => e.type === 'HEALING').length,
  };

  const avgConf = (() => {
    const withConf = events.filter(e => e.confidence != null);
    if (!withConf.length) return null;
    return Math.round(withConf.reduce((s, e) => s + Number(e.confidence), 0) / withConf.length);
  })();

  const getBadge = (type) => ({ HEALING: 'badge-healing', ALERT: 'badge-critical', SCALING: 'badge-info' }[type] ?? 'badge-warning');

  return (
    <div className="fade-in">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem', flexWrap: 'wrap', gap: '0.75rem' }}>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          {[['ALL', 'All Incidents'], ['ALERT', 'Alerts'], ['HEALING', 'Healed']].map(([val, lbl]) => (
            <button key={val} onClick={() => setFilter(val)}
              className={`btn btn-sm ${filter === val ? 'btn-primary' : 'btn-outline'}`}>
              {lbl} <span style={{ opacity: 0.6, marginLeft: '3px' }}>({counts[val]})</span>
            </button>
          ))}
        </div>
        <div className="live-indicator"><span className="live-dot" />WS LIVE</div>
      </div>

      {events.length > 0 && (
        <div className="grid-3 slide-up" style={{ marginBottom: '1.5rem' }}>
          <div className="card stat-card stat-card-accent">
            <div className="stat-label">Total Incidents</div>
            <div className="stat-value">{events.length}</div>
          </div>
          <div className="card stat-card stat-card-success">
            <div className="stat-label">Resolved</div>
            <div className="stat-value" style={{ color: 'var(--success)' }}>{events.filter(e => e.status === 'resolved').length}</div>
          </div>
          <div className="card stat-card">
            <div className="stat-label">Avg Confidence</div>
            <div className="stat-value" style={{ color: 'var(--healing)' }}>{avgConf != null ? `${avgConf}%` : '—'}</div>
          </div>
        </div>
      )}

      <div className="card slide-up delay-1" style={{ padding: 0, overflow: 'hidden' }}>
        {filtered.length === 0 ? (
          <div className="empty-state">
            <div className="empty-icon">📭</div>
            <p>No incidents recorded yet.</p>
            <p style={{ fontSize: '0.8rem', marginTop: '0.5rem' }}>Trigger a failure from the Dashboard to populate this log.</p>
          </div>
        ) : (
          <div className="data-table-wrap">
            <table className="data-table">
              <thead>
                <tr><th>#</th><th>Node</th><th>AI Root Cause</th><th>Remediation</th><th>Confidence</th><th>Type</th><th>Timestamp</th></tr>
              </thead>
              <tbody>
                {filtered.map((e, i) => {
                  const isCrit = e.type === 'ALERT' && e.status === 'investigating';
                  const conf   = Number(e.confidence);
                  const confColor = conf >= 85 ? 'var(--success)' : conf >= 70 ? 'var(--warning)' : 'var(--text-secondary)';
                  return (
                    <tr key={e.id} className={isCrit ? 'row-critical' : ''}>
                      <td style={{ color: 'var(--text-tertiary)', fontFamily: 'var(--font-mono)', width: 40 }}>{filtered.length - i}</td>
                      <td style={{ fontFamily: 'var(--font-mono)', fontWeight: 600, whiteSpace: 'nowrap' }}>{e.node}</td>
                      <td style={{ maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--text-secondary)' }} title={e.root_cause}>
                        {e.root_cause || <span style={{ color: 'var(--text-tertiary)' }}>Processing...</span>}
                      </td>
                      <td style={{ maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--success)' }} title={e.action}>
                        {e.action || <span style={{ color: 'var(--text-tertiary)' }}>—</span>}
                      </td>
                      <td style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, color: confColor, whiteSpace: 'nowrap' }}>
                        {e.confidence ? `${e.confidence}%` : '—'}
                      </td>
                      <td><span className={`badge ${getBadge(e.type)}`}>{e.type}</span></td>
                      <td style={{ color: 'var(--text-tertiary)', fontFamily: 'var(--font-mono)', fontSize: '0.72rem', whiteSpace: 'nowrap' }}>
                        {new Date(e.timestamp).toLocaleString()}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
