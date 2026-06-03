"use client";
import Link            from 'next/link';
import Image           from 'next/image';
import { usePathname } from 'next/navigation';
import { useRealtime } from '@/context/RealtimeContext';

const TABS = [
  { href: '/',          label: 'Overview'     },
  { href: '/dashboard', label: 'Dashboard'    },
  { href: '/servers',   label: 'Servers'      },
  { href: '/history',   label: 'Incident Log' },
];

const STATUS_META = {
  connecting: { text: 'CONNECTING', color: '#ffc53d', bg: 'rgba(255,197,61,0.07)', border: 'rgba(255,197,61,0.22)' },
  live:       { text: 'LIVE',       color: '#11ff99', bg: 'rgba(34,255,153,0.07)', border: 'rgba(34,255,153,0.22)' },
  fallback:   { text: 'POLLING',    color: '#888e90', bg: 'rgba(255,255,255,0.04)', border: 'rgba(255,255,255,0.08)' },
};

export default function TopBar() {
  const pathname       = usePathname();
  const ctx            = useRealtime();
  const realtimeStatus = ctx?.realtimeStatus ?? 'connecting';
  const notifications  = ctx?.notifications  ?? [];
  const sm             = STATUS_META[realtimeStatus] || STATUS_META.connecting;

  return (
    <header className="topbar">

      {/* ── Logo — horizontal SelfHeal wordmark ──────────── */}
      <Link href="/" className="topbar-brand" aria-label="SelfHeal home">
        <Image
          src="/SelfHeal_Horizontal.png"
          alt="SelfHeal"
          width={120}
          height={36}
          style={{ objectFit: 'contain', objectPosition: 'left center' }}
          priority
        />
      </Link>

      {/* ── Sub-nav pill tabs (centred) ───────────────────── */}
      <nav className="topbar-tabs" aria-label="Main navigation">
        {TABS.map(({ href, label }) => {
          const active = pathname === href;
          return (
            <Link key={href} href={href} className={`topbar-tab${active ? ' active' : ''}`}>
              {label}
            </Link>
          );
        })}
      </nav>

      {/* ── Right side ───────────────────────────────────── */}
      <div className="topbar-right">
        {/* Toasts */}
        {notifications.length > 0 && (
          <div className="topbar-toast-stack" aria-live="polite">
            {notifications.map((n) => (
              <div key={n.id} className={`topbar-toast-item status-toast-${n.type}`}>
                {n.msg}
              </div>
            ))}
          </div>
        )}

        {/* Live status pill */}
        <div
          className="topbar-status-pill"
          style={{ color: sm.color, background: sm.bg, borderColor: sm.border }}
          title={`Realtime: ${realtimeStatus}`}
        >
          <span
            className="topbar-status-dot"
            style={{
              background: sm.color,
              animation: realtimeStatus === 'live' ? 'livePulse 2s ease infinite' : 'none',
            }}
          />
          {sm.text}
        </div>

        {/* Clock */}
        <time className="topbar-time" suppressHydrationWarning>
          {new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}
        </time>
      </div>
    </header>
  );
}
