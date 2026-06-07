"use client";
import { useEffect, useState } from 'react';
import Link from 'next/link';

const STATUS_META = {
  healthy:    { badge: 'badge-healthy',    dot: 'dot-success', cardCls: ''                },
  critical:   { badge: 'badge-critical',   dot: 'dot-danger',  cardCls: 'card-critical'   },
  recovering: { badge: 'badge-recovering', dot: 'dot-healing', cardCls: 'card-recovering' },
  warning:    { badge: 'badge-warning',    dot: 'dot-warning', cardCls: 'card-warning'    },
  offline:    { badge: 'badge-offline',    dot: 'dot-offline', cardCls: 'card-offline'    },
};

function FleetMetricBar({ label, value }) {
  const num = parseFloat(value) || 0;
  const cls   = num > 90 ? 'danger' : num > 70 ? 'warn' : '';
  const color = num > 90 ? 'var(--danger)' : num > 70 ? 'var(--warning)' : 'var(--success)';
  return (
    <div className="metric-bar-wrap">
      <div className="metric-bar-header">
        <span className="metric-bar-label">{label}</span>
        <span className="metric-bar-value" style={{ color }}>{value || '—'}</span>
      </div>
      <div className="metric-bar-track">
        <div className={`metric-bar-fill ${cls}`} style={{ width: `${Math.min(num, 100)}%` }} />
      </div>
    </div>
  );
}

/**
 * @param {{ s: object, prevStatus?: string, index?: number, onRemove?: (id: string) => void, linkToDetail?: boolean }} props
 */
export default function ServerFleetCard({ s, prevStatus, index = 0, onRemove, linkToDetail = true }) {
  const [flash, setFlash] = useState(false);
  const [removing, setRemoving] = useState(false);
  const meta = STATUS_META[s.status] || STATUS_META.healthy;
  const isOffline = s.status === 'offline';

  useEffect(() => {
    if (prevStatus && prevStatus !== s.status) {
      const start = setTimeout(() => setFlash(true), 0);
      const end = setTimeout(() => setFlash(false), 800);
      return () => {
        clearTimeout(start);
        clearTimeout(end);
      };
    }
  }, [s.status, prevStatus]);

  const handleRemove = async (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (!onRemove || !confirm(`Remove "${s.name}" from registry?`)) return;
    setRemoving(true);
    try {
      await onRemove(s.id);
    } catch {
      setRemoving(false);
    }
  };

  const inner = (
    <div
      className={`card server-card ${meta.cardCls} ${flash ? 'status-flash' : ''}`}
      style={{ animationDelay: `${index * 0.04}s`, opacity: isOffline ? 0.7 : 1 }}
    >
      {s.status === 'critical' && <div className="critical-glow-ring" />}

      <div className="server-card-name">
        <span className={`status-dot ${meta.dot}`} style={{ width: 9, height: 9 }} />
        <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.name}</span>
        <span className={`badge ${meta.badge}`}>{s.status}</span>
        {isOffline && onRemove && (
          <button
            type="button"
            onClick={handleRemove}
            disabled={removing}
            style={{
              marginLeft: '0.375rem',
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              color: 'var(--text-tertiary)',
              fontSize: '0.9rem',
              lineHeight: 1,
              padding: '0 2px',
            }}
            title="Remove from registry"
          >
            ✕
          </button>
        )}
      </div>

      {isOffline && (
        <div
          style={{
            fontSize: '0.72rem',
            color: 'var(--text-tertiary)',
            marginBottom: '0.625rem',
            padding: '0.3rem 0.5rem',
            background: 'rgba(255,255,255,0.03)',
            borderRadius: 'var(--radius-sm)',
          }}
        >
          ⚠ No heartbeat for &gt;30s — agent stopped
        </div>
      )}

      <div className="server-card-ip">
        <span style={{ fontFamily: 'var(--font-mono)' }}>{s.ip_address}</span>
        {s.region && (
          <>
            {' '}
            ·{' '}
            <span
              style={{
                color: isOffline ? 'var(--text-tertiary)' : 'var(--accent)',
                fontFamily: 'var(--font-mono)',
              }}
            >
              {s.region}
            </span>
          </>
        )}
      </div>

      <FleetMetricBar label="CPU" value={s.cpu || '0%'} />
      <FleetMetricBar label="Memory" value={s.memory || '0%'} />

      <div className="server-card-footer">
        <span>↑ {s.uptime || '—'}</span>
        <span className="text-mono" style={{ color: 'var(--text-tertiary)', fontSize: '0.68rem' }}>
          {new Date(s.last_seen).toLocaleTimeString()}
        </span>
      </div>
    </div>
  );

  if (linkToDetail) {
    return (
      <Link href={`/servers/${s.id}`} className="card-clickable">
        {inner}
      </Link>
    );
  }

  return <div className="card-clickable">{inner}</div>;
}
