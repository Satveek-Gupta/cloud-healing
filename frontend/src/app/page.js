"use client";
import Link  from 'next/link';
import Image from 'next/image';
import { useRealtime }   from '@/context/RealtimeContext';
import { usePageTitle }  from '@/hooks/usePageTitle';


function ActivityFeed({ events }) {
  if (!events.length) return (
    <div className="activity-empty">
      <span style={{ fontSize: '1.5rem', opacity: 0.25 }}>📭</span>
      <span>Waiting for incidents...</span>
    </div>
  );
  return (
    <div className="activity-feed">
      {events.slice(0, 6).map((e, i) => (
        <div key={e.id || i} className={`activity-item ${i === 0 ? 'activity-item-new' : ''}`}>
          <span
            className={`activity-dot ${e.type === 'ALERT' ? 'dot-danger' : 'dot-success'}`}
            style={{ width: 7, height: 7, flexShrink: 0 }}
          />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 600, fontSize: '0.8rem', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {e.node}
            </div>
            <div style={{ fontSize: '0.72rem', color: 'var(--text-tertiary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {e.root_cause || e.action || '—'}
            </div>
          </div>
          <div style={{ textAlign: 'right', flexShrink: 0 }}>
            <span className={`badge ${e.type === 'ALERT' ? 'badge-critical' : 'badge-healing'}`} style={{ fontSize: '0.58rem' }}>
              {e.type}
            </span>
            <div style={{ fontSize: '0.65rem', color: 'var(--text-tertiary)', marginTop: 3 }}>
              {new Date(e.timestamp).toLocaleTimeString()}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

function ServerMiniCard({ s }) {
  const statusColor = s.status === 'healthy' ? 'var(--success)' : s.status === 'critical' ? 'var(--danger)' : s.status === 'recovering' ? 'var(--healing)' : 'var(--text-tertiary)';
  const dotCls = s.status === 'healthy' ? 'dot-success' : s.status === 'critical' ? 'dot-danger' : 'dot-warn';
  return (
    <Link href={`/servers/${s.id}`} style={{ textDecoration: 'none' }}>
      <div className="card card-clickable" style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', padding: '0.75rem 1rem' }}>
        <span className={`status-dot ${dotCls}`} style={{ width: 8, height: 8, flexShrink: 0 }} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 700, fontSize: '0.82rem', fontFamily: 'var(--font-mono)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {s.name}
          </div>
          <div style={{ fontSize: '0.7rem', color: 'var(--text-tertiary)', marginTop: 2 }}>
            {s.region || 'unknown'} · {s.ip_address}
          </div>
        </div>
        <div style={{ textAlign: 'right', flexShrink: 0 }}>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.78rem', color: statusColor, fontWeight: 700 }}>
            {s.cpu || '—'}
          </div>
          <div style={{ fontSize: '0.65rem', color: 'var(--text-tertiary)', marginTop: 2 }}>CPU</div>
        </div>
      </div>
    </Link>
  );
}

export default function Home() {
  usePageTitle('Overview');
  const { servers, events, stats, wsConnected } = useRealtime();


  const healthy   = servers.filter(s => s.status === 'healthy').length;
  const critical  = servers.filter(s => s.status === 'critical').length;
  const offline   = servers.filter(s => s.status === 'offline').length;
  const recovering = servers.filter(s => s.status === 'recovering').length;

  return (
    <div className="fade-in">
      {/* ── Hero Banner ── */}
      <div className="overview-hero slide-up">
        <div className="overview-hero-left">
          <Image
            src="/SelfHeal.png"
            alt="SelfHeal"
            width={56}
            height={56}
            style={{ borderRadius: 12, flexShrink: 0 }}
            priority
          />
          <div className="overview-status-orb" data-status={critical > 0 ? 'critical' : 'healthy'} />
          <div>
            <div className="overview-status-label">
              {critical > 0 ? '⚠ ACTIVE INCIDENT' : recovering > 0 ? '🔄 RECOVERING' : '✅ ALL SYSTEMS OPERATIONAL'}
            </div>
            <div className="overview-status-sub">
              {servers.length} nodes · {healthy} healthy · {critical} critical
              {offline > 0 && ` · ${offline} offline`}
              {stats?.uptime && ` · Uptime ${stats.uptime}`}
            </div>
          </div>
        </div>
        <div className="live-indicator">
          <span className="live-dot" style={{ background: wsConnected === false ? 'var(--danger)' : undefined }} />
          {wsConnected === false ? 'DISCONNECTED' : 'LIVE'}
        </div>
      </div>

      {/* ── Stat Tiles ── */}
      <div className="grid-4 slide-up delay-1" style={{ marginBottom: '1.5rem' }}>
        {[
          { label: 'Connected Nodes', val: servers.length,  color: 'var(--accent)',   cls: 'stat-card-accent'  },
          { label: 'Healthy',         val: healthy,          color: 'var(--success)',  cls: 'stat-card-success' },
          { label: 'Critical',        val: critical,         color: critical > 0 ? 'var(--danger)' : undefined, cls: critical > 0 ? 'stat-card-danger' : '' },
          { label: 'Total Incidents', val: events.length,    color: 'var(--healing)', cls: '' },
        ].map(({ label, val, color, cls }) => (
          <div key={label} className={`card stat-card ${cls}`}>
            <div className="stat-label">{label}</div>
            <div className="stat-value" style={{ color }}>{val}</div>
          </div>
        ))}
      </div>

      <div className="grid-2 slide-up delay-2">
        {/* ── Live Server List ── */}
        <div className="card">
          <div className="card-header">
            Connected Servers
            <span className="live-indicator" style={{ fontSize: '0.6rem' }}><span className="live-dot" />WS</span>
          </div>
          {servers.length === 0 ? (
            <div className="activity-empty">
              <span style={{ fontSize: '1.5rem', opacity: 0.25 }}>🖥️</span>
              <span>No servers registered. Run the agent to connect a node.</span>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              {servers.slice(0, 6).map(s => <ServerMiniCard key={s.id} s={s} />)}
            </div>
          )}
          {servers.length > 0 && (
            <Link href="/servers" className="btn btn-ghost btn-sm" style={{ width: '100%', marginTop: '0.875rem' }}>
              View All {servers.length} Servers →
            </Link>
          )}
        </div>

        {/* ── Live Activity Feed ── */}
        <div className="card">
          <div className="card-header">
            Live Incident Feed
            <span className="live-indicator" style={{ fontSize: '0.6rem' }}><span className="live-dot" />WS</span>
          </div>
          <ActivityFeed events={events} />
          {events.length > 0 && (
            <Link href="/history" className="btn btn-ghost btn-sm" style={{ width: '100%', marginTop: '0.875rem' }}>
              View All {events.length} Incidents →
            </Link>
          )}
        </div>
      </div>

      {/* ── Quick Nav ── */}
      <div className="grid-3 slide-up delay-3" style={{ marginTop: '1.5rem' }}>
        {[
          { href: '/dashboard', icon: '📊', label: 'Dashboard',    sub: 'Live telemetry & AI diagnosis' },
          { href: '/servers',   icon: '🖥️',  label: 'Servers',     sub: `${servers.length} nodes connected` },
          { href: '/history',   icon: '📋',  label: 'Incident Log', sub: `${events.length} total events` },
        ].map(({ href, icon, label, sub }) => (
          <Link key={href} href={href}>
            <div className="card card-clickable" style={{ display: 'flex', alignItems: 'center', gap: '1rem', padding: '1rem 1.25rem' }}>
              <span style={{ fontSize: '1.5rem' }}>{icon}</span>
              <div>
                <div style={{ fontWeight: 700, fontSize: '0.9rem' }}>{label}</div>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-tertiary)', marginTop: 2 }}>{sub}</div>
              </div>
              <span style={{ marginLeft: 'auto', color: 'var(--text-tertiary)', fontSize: '1rem' }}>→</span>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
