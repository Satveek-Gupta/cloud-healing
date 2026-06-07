"use client";

import { useEffect, useState } from 'react';
import { useRealtime } from '@/context/RealtimeContext';
import { usePageTitle } from '@/hooks/usePageTitle';
import BACKEND_URL from '@/lib/config';

export default function SuperAdminPage() {
  usePageTitle('Superadmin');
  const { authFetch, currentUser } = useRealtime() || {};
  const [state, setState] = useState({ loading: true, error: null, data: null });

  useEffect(() => {
    if (!authFetch) return;
    authFetch(`${BACKEND_URL}/api/superadmin/example`)
      .then(async r => {
        const body = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(body.error || 'Superadmin access denied');
        setState({ loading: false, error: null, data: body });
      })
      .catch(err => setState({ loading: false, error: err.message, data: null }));
  }, [authFetch]);

  return (
    <div className="fade-in">
      <p className="section-label">Superadmin</p>
      <div className="card">
        <div className="card-header">Privileged platform controls</div>
        {state.loading ? (
          <p className="loading-text">Checking server-side permissions...</p>
        ) : state.error ? (
          <p style={{ color: 'var(--danger)' }}>{state.error}</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            <p>Superadmin access confirmed by backend role check.</p>
            <p style={{ color: 'var(--text-secondary)' }}>
              Role assignment is environment-owned, not user-controlled.
            </p>
            <p className="text-mono">{currentUser?.email}</p>
          </div>
        )}
      </div>
    </div>
  );
}
