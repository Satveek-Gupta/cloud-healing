# SelfHeal Security Implementation

## Folder Structure

```text
backend/
  migration_auth.sql
  src/
    lib/
      audit.js
      clerk.js
      roles.js
      sse.js
      supabase.js
      ws.js
    middleware/
      auth.js
      admin.js
      superadmin.js
      security.js
    routes/
      user.js
      incidents.js
      servers.js
      metrics.js
      commands.js
frontend/
  src/
    middleware.js
    app/
      sign-in/[[...sign-in]]/page.js
      sign-up/[[...sign-up]]/page.js
      admin/page.js
      superadmin/page.js
      layout.js
    context/
      RealtimeContext.js
```

## Environment Variables

Backend:

```env
SUPABASE_URL=
SUPABASE_KEY= # service-role key on the backend only
CLERK_SECRET_KEY=
CLERK_JWT_KEY=
CLERK_ISSUER=
CLERK_AUDIENCE=selfheal-api
CLERK_AUTHORIZED_PARTIES=https://app.example.com,http://localhost:3000
SUPERADMIN_EMAIL=
ADMIN_EMAIL=
CORS_ALLOWED_ORIGINS=https://app.example.com,http://localhost:3000
```

Frontend:

```env
NEXT_PUBLIC_BACKEND_URL=
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=
CLERK_SECRET_KEY=
NEXT_PUBLIC_CLERK_JWT_TEMPLATE=selfheal-api
NEXT_PUBLIC_CLERK_SIGN_IN_URL=/sign-in
NEXT_PUBLIC_CLERK_SIGN_UP_URL=/sign-up
```

Create a Clerk JWT template named `selfheal-api` that emits `aud=selfheal-api`.

## Authorization Model

Roles are assigned only on the backend:

```text
email == SUPERADMIN_EMAIL -> SUPERADMIN
email == ADMIN_EMAIL      -> ADMIN
else                      -> USER
```

Client roles are display-only. Every protected backend route verifies Clerk JWTs, syncs the Supabase user record, and checks `req.user.role`.

## Protected API Examples

```text
GET  /api/user/me                  -> authenticated users
GET  /api/admin/example            -> ADMIN or SUPERADMIN
POST /api/admin/example-action     -> ADMIN or SUPERADMIN, audited
GET  /api/superadmin/example       -> SUPERADMIN
POST /api/superadmin/example-action -> SUPERADMIN, audited
```

Operational route protections:

```text
GET /api/latest                    -> authenticated
GET /api/history                   -> authenticated
GET /api/stats                     -> authenticated
GET /api/servers                   -> authenticated
GET /api/servers/:id               -> authenticated
GET /api/metrics/:server_id        -> authenticated
DELETE /api/servers/:id            -> ADMIN or SUPERADMIN, audited
GET /api/commands                  -> ADMIN or SUPERADMIN
POST /api/commands/:server_id      -> ADMIN or SUPERADMIN, audited
```

## SSE Security

Protected streams:

```text
GET /api/events
GET /api/events/servers
GET /api/events/incidents
GET /api/events/diagnosis
```

The browser uses a Clerk session token in the EventSource query string because native EventSource cannot attach custom headers. Tokens are redacted in request logs. Streams are authenticated before headers flush, capped by user/IP, heartbeat-protected, and closed after 10 minutes so reconnects refresh permissions.

## Audit Logging

`logAuditEvent()` writes to `audit_logs` for:

- `auth.login`
- `auth.logout`
- `admin.example_action`
- `superadmin.example_action`
- `server.delete`
- `server.command.dispatch`
- `incident.acknowledge`

Add the same helper to future server management, role-sensitive, and incident workflows.

## Security Review

Implemented:

- Clerk JWT verification with issuer, audience, expiration, and authorized-party checks.
- Server-side role assignment from environment variables.
- Supabase-backed user sync on every authenticated request.
- Fail-closed auth middleware.
- ADMIN and SUPERADMIN authorization middleware.
- Authenticated SSE streams with reconnect permission refresh.
- Request size limits.
- Strict CORS allowlist.
- Helmet security headers and production HSTS.
- API and SSE rate limiting.
- Token redaction in request logs.
- Secure error handling that hides production stack details.
- RLS-denied direct access for `users` and `audit_logs`.

Recommendations:

- Enforce MFA in Clerk for ADMIN and SUPERADMIN.
- Use short session lifetimes for privileged users.
- Alert on admin login from new IPs, countries, devices, or impossible travel.
- Store request IP and user agent on all sensitive audit events.
- Add a dedicated agent authentication scheme for metric ingestion and command polling.
- Add anomaly detection over audit logs for repeated authorization failures and unusual command dispatches.
- Rotate Supabase service-role and Clerk secret keys on a schedule.

## Threat Model

Primary assets:

- Clerk sessions and JWTs.
- Supabase service-role key.
- Server inventory and metrics.
- Healing command queue.
- AI diagnosis data.
- Audit logs.

Primary threats:

- Stolen browser session token.
- Role escalation by client-side manipulation.
- Unauthenticated SSE data exfiltration.
- Cross-origin API abuse.
- Replay or misuse of admin command dispatch.
- Log leakage of query-string tokens.
- Direct browser access to privileged Supabase tables.

Controls:

- Backend-only role derivation.
- Clerk JWT verification on every protected request.
- Strict CORS and authorized-party token checks.
- SSE token validation before stream open.
- SSE connection caps and forced reconnect.
- Audit logging for privileged actions.
- RLS deny policies on auth/audit tables.

Residual risks:

- Native EventSource requires query-string token transport unless same-site cookies are used. Keep HTTPS mandatory and retain log redaction.
- Existing agent endpoints remain backward compatible. Production deployments should add an agent identity or shared secret before exposing ingestion endpoints publicly.
- The current database schema has no tenant/server ownership model, so USER read access is fleet-wide. Add ownership tables before multi-tenant use.
