"use client";
import { useEffect, useRef, useState } from 'react';
import { useRealtime }  from '@/context/RealtimeContext';
import { usePageTitle } from '@/hooks/usePageTitle';
import BACKEND_URL from '@/lib/config';

import ServerFleetCard from '@/components/ServerFleetCard';

export default function Servers() {
  usePageTitle('Servers');
  const { servers, removeServer, authFetch, currentUser } = useRealtime();
  const isSuperAdmin = currentUser?.role === 'SUPERADMIN';
  const [prevStatuses, setPrevStatuses] = useState({});
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ name: '', ip_address: '', region: '' });
  const [registering, setRegistering] = useState(false);
  const [submitStatus, setSubmitStatus] = useState(null);
  const [filter, setFilter] = useState('ALL');

  const removeFromBackend = async (id) => {
    const r = await authFetch(`${BACKEND_URL}/api/servers/${id}`, { method: 'DELETE' });
    if (!r.ok) throw new Error('remove failed');
    removeServer(id);
  };

  const prevServersRef = useRef([]);
  useEffect(() => {
    const prev = prevServersRef.current;
    if (!prev.length) {
      prevServersRef.current = servers;
      return;
    }
    const transitions = {};
    servers.forEach((ns) => {
      const old = prev.find((ps) => ps.id === ns.id);
      if (old && old.status !== ns.status) {
        transitions[ns.id] = old.status;
      }
    });
    let t;
    if (Object.keys(transitions).length) {
      t = setTimeout(() => setPrevStatuses((p) => ({ ...p, ...transitions })), 0);
    }
    prevServersRef.current = servers;
    return () => { if (t) clearTimeout(t); };
  }, [servers]);

  const registerServer = async (e) => {
    e.preventDefault();
    if (!form.name || !form.ip_address) return;
    setRegistering(true);
    try {
      const r = await authFetch(`${BACKEND_URL}/api/servers/register-server`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      if (r.ok) {
        setSubmitStatus('success');
        setForm({ name: '', ip_address: '', region: '' });
        setTimeout(() => {
          setShowForm(false);
          setSubmitStatus(null);
        }, 1500);
      } else setSubmitStatus('error');
    } catch {
      setSubmitStatus('error');
    }
    setRegistering(false);
  };

  const healthy = servers.filter((s) => s.status === 'healthy').length;
  const critical = servers.filter((s) => s.status === 'critical').length;
  const offline = servers.filter((s) => s.status === 'offline').length;
  const recovering = servers.filter((s) => s.status === 'recovering').length;

  const filtered =
    filter === 'ALL'
      ? servers
      : filter === 'CRITICAL'
        ? servers.filter((s) => s.status === 'critical')
        : filter === 'OFFLINE'
          ? servers.filter((s) => s.status === 'offline')
          : servers.filter((s) => s.status === 'healthy');

  return (
    <div className="fade-in">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem' }}>
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
          {[
            ['ALL', `All (${servers.length})`],
            ['HEALTHY', `Healthy (${healthy})`],
            ['CRITICAL', `Critical (${critical})`],
            ...(offline > 0 ? [['OFFLINE', `Offline (${offline})`]] : []),
          ].map(([val, label]) => (
            <button
              key={val}
              type="button"
              onClick={() => setFilter(val)}
              className={`btn btn-sm ${filter === val ? 'btn-primary' : 'btn-outline'}`}
            >
              {label}
            </button>
          ))}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <div className="live-indicator">
            <span className="live-dot" />
            WS
          </div>
          {isSuperAdmin ? (
            <button
              type="button"
              onClick={() => setShowForm((v) => !v)}
              className={`btn btn-sm ${showForm ? 'btn-outline' : 'btn-primary'}`}
            >
              {showForm ? '✕ Cancel' : '＋ Register node'}
            </button>
          ) : (
            <span className="badge badge-info" title="Only the superadmin can register nodes">👁 Read-only</span>
          )}
        </div>
      </div>

      <div style={{ display: 'flex', gap: '0.625rem', marginBottom: '1.25rem', flexWrap: 'wrap' }}>
        <div className="stat-chip">
          <span className="status-dot dot-success" style={{ width: 7, height: 7 }} />
          Healthy <strong style={{ color: 'var(--success)' }}>{healthy}</strong>
        </div>
        <div className="stat-chip">
          <span className="status-dot dot-danger" style={{ width: 7, height: 7 }} />
          Critical{' '}
          <strong style={{ color: critical > 0 ? 'var(--danger)' : 'var(--text-secondary)' }}>{critical}</strong>
        </div>
        {recovering > 0 && (
          <div className="stat-chip">
            <span className="status-dot dot-healing" style={{ width: 7, height: 7 }} />
            Recovering <strong style={{ color: 'var(--healing)' }}>{recovering}</strong>
          </div>
        )}
        {offline > 0 && (
          <div className="stat-chip">
            <span className="status-dot dot-offline" style={{ width: 7, height: 7 }} />
            Offline <strong style={{ color: 'var(--text-tertiary)' }}>{offline}</strong>
          </div>
        )}
        <div className="stat-chip">
          Fleet health{' '}
          <strong style={{ color: 'var(--success)' }}>
            {servers.length > 0 ? Math.round((healthy / servers.length) * 100) : 100}%
          </strong>
        </div>
      </div>

      {showForm && isSuperAdmin && (
        <div className="card slide-up" style={{ marginBottom: '1.5rem', borderColor: 'var(--border-focus)' }}>
          <div className="card-header">
            Register new node <span className="badge badge-info">Manual</span>
          </div>
          <form onSubmit={registerServer}>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: '1fr 1fr 1fr auto',
                gap: '0.875rem',
                alignItems: 'flex-end',
              }}
            >
              {[
                ['name', 'Server name', 'e.g. api-gateway-prod'],
                ['ip_address', 'IP address', 'e.g. 10.0.1.12'],
                ['region', 'Region', 'e.g. us-east-1'],
              ].map(([field, label, placeholder]) => (
                <div key={field}>
                  <p className="section-label" style={{ marginBottom: '0.3rem' }}>
                    {label}
                  </p>
                  <input
                    className="field-input"
                    type="text"
                    placeholder={placeholder}
                    value={form[field]}
                    onChange={(e) => setForm((p) => ({ ...p, [field]: e.target.value }))}
                    required={field !== 'region'}
                  />
                </div>
              ))}
              <button type="submit" disabled={registering} className="btn btn-primary" style={{ height: 38 }}>
                {registering ? '⏳' : submitStatus === 'success' ? '✅' : 'Register'}
              </button>
            </div>
            {submitStatus === 'error' && (
              <p style={{ color: 'var(--danger)', fontSize: '0.8rem', marginTop: '0.625rem' }}>
                ⚠ Registration failed.
              </p>
            )}
          </form>
        </div>
      )}

      <p className="section-label">Monitored nodes</p>
      {!servers.length ? (
        <div className="empty-state">
          <div className="empty-icon">🖥️</div>
          <p>No servers found.</p>
        </div>
      ) : filtered.length === 0 ? (
        <div className="empty-state">
          <div className="empty-icon">🔍</div>
          <p>No servers match this filter.</p>
        </div>
      ) : (
        <div className="grid-server-cards">
          {filtered.map((s, i) => (
            <ServerFleetCard
              key={s.id}
              s={s}
              prevStatus={prevStatuses[s.id]}
              index={i}
              onRemove={removeFromBackend}
            />
          ))}
        </div>
      )}
    </div>
  );
}
