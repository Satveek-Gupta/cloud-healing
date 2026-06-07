"use client";

import { useEffect, useState } from 'react';
import { useRealtime } from '@/context/RealtimeContext';
import { usePageTitle } from '@/hooks/usePageTitle';
import BACKEND_URL from '@/lib/config';

export default function AdminPage() {
  usePageTitle('Admin');
  const { authFetch, currentUser } = useRealtime() || {};
  const [state, setState] = useState({ loading: true, error: null, data: null });

  useEffect(() => {
    if (!authFetch) return;
    authFetch(`${BACKEND_URL}/api/admin/example`)
      .then(async r => {
        const body = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(body.error || 'Admin access denied');
        setState({ loading: false, error: null, data: body });
      })
      .catch(err => setState({ loading: false, error: err.message, data: null }));
  }, [authFetch]);

  return (
    <div className="fade-in">
      <p className="section-label">Admin</p>
      <div className="card">
        <div className="card-header">Operational control plane</div>
        {state.loading ? (
          <p className="loading-text">Checking server-side permissions...</p>
        ) : state.error ? (
          <p style={{ color: 'var(--danger)' }}>{state.error}</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            <p>Access confirmed by backend role check.</p>
            <p style={{ color: 'var(--text-secondary)' }}>
              Signed in as <span className="text-mono">{currentUser?.email}</span> with role{' '}
              <span className="badge badge-info">{currentUser?.role}</span>.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
