# Cloud-Healing API Structure

## Overview

Three main actors communicate over HTTP/SSE/WebSocket:

```
┌─────────────┐          HTTP/SSE/WS          ┌──────────────────────┐
│   Frontend  │ ◄─────────────────────────────► │                      │
│  (Next.js)  │                                 │   Backend (Express)  │
└─────────────┘                                 │   localhost:8000     │
                                                │                      │
┌─────────────┐          HTTP polling           │  /health             │
│  Agent      │ ─────────────────────────────► │  /api/*              │
│ (Node.js)   │ ◄──────── commands ──────────── │                      │
└─────────────┘                                 └──────────┬───────────┘
                                                           │
                                                     Supabase DB
```

---

## Backend Base URL

```
BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || http://localhost:8000
```

All API routes are prefixed with `/api`. A global rate limiter (`apiLimiter`) is applied to everything under `/api`. SSE routes have their own `sseLimiter`.

---

## Authentication

- **Auth Provider**: Clerk (JWT-based)
- **Middleware chain**: `requireAuth` → `requireAdmin` → `requireSuperAdmin`
- **Roles** (ascending privilege): `USER` → `ADMIN` → `SUPERADMIN`
- All routes (except agent polling routes) require `requireAuth`
- JWT token is passed as `Authorization: Bearer <token>` header

---

## Full Route Map

### 🔓 Public / No Auth

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/health` | Health check — used by load balancers |

---

### 🖥️ Servers — `/api/servers`
> File: [servers.js](file:///Users/satveekgupta/Developer/cloud-healing/backend/src/routes/servers.js)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/api/servers` | `requireAuth` | List all registered nodes with live online/offline status |
| `GET` | `/api/servers/:id` | `requireAuth` | Get a single server by ID |
| `POST` | `/api/servers/register` | `requireSuperAdmin` | Register or re-register a node (upsert by name) |
| `POST` | `/api/servers/register-server` | `requireSuperAdmin` | **Alias** — backward-compat for old agents (internally rewrites to `/register`) |
| `DELETE` | `/api/servers/:id` | `requireAdmin` | Deregister a node |

---

### 📊 Metrics — `/api/metrics`
> File: [metrics.js](file:///Users/satveekgupta/Developer/cloud-healing/backend/src/routes/metrics.js)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `POST` | `/api/metrics` | ❌ (no auth — agent call) | Ingest a metric snapshot. If CPU/logs are critical, triggers the **healing pipeline** |
| `GET` | `/api/metrics/:server_id` | `requireAuth` | Fetch metric history for a given server |

**POST body fields:**
```json
{
  "server_id": "uuid",
  "cpu": 85.3,
  "memory": 60.1,
  "uptime": 86400,
  "log_summary": "...",
  "logs": "...",
  "disk_used_pct": 70,
  "load_1m": 2.4,
  "load_per_core": 0.6,
  "memory_used_mb": 4096,
  "issue_type": "log_critical",
  "severity": "critical",
  "health_score": 42,
  "anomalies": ["log_critical"],
  "is_anomaly": true
}
```

**Response paths:**
- `status === "healthy"` → quick `{ stored: true, status, health_score, healing: null }`
- `status === "critical"` → runs `runHealingPipeline()` → returns diagnosis + healing action

---

### 🚨 Commands — `/api/commands`
> File: [commands.js](file:///Users/satveekgupta/Developer/cloud-healing/backend/src/routes/commands.js)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/api/commands` | `requireAdmin` | List all queued commands (admin/debug view) |
| `GET` | `/api/commands/:server_id` | ❌ (no auth — agent polls this) | Agent polls for its pending command |
| `POST` | `/api/commands/:server_id` | `requireAdmin` | Dashboard dispatches a command to a server |
| `POST` | `/api/commands/:server_id/ack` | ❌ (no auth — agent acks) | Agent acknowledges command execution |

**Allowed commands** (validated server-side):
```
restart_service | kill_process | scale_up
```

---

### 📜 Incidents / History / Stats — `/api/`
> File: [incidents.js](file:///Users/satveekgupta/Developer/cloud-healing/backend/src/routes/incidents.js)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/api/history` | `requireAuth` | Paginated incident log (`?limit=N`) |
| `GET` | `/api/stats` | `requireAuth` | Cluster aggregate stats (healing events, avg CPU/memory) |
| `GET` | `/api/latest` | `requireAuth` | Full dashboard snapshot — servers + latest AI diagnosis |
| `POST` | `/api/incidents/:id/ack` | `requireAdmin` | Acknowledge an incident |

---

### 📡 SSE Event Streams — `/api/events`
> File: [incidents.js](file:///Users/satveekgupta/Developer/cloud-healing/backend/src/routes/incidents.js)

The frontend opens **one long-lived connection** and receives real-time push events.

| Method | Path | Auth | Channel |
|--------|------|------|---------|
| `GET` | `/api/events` | `requireAuth` | All events |
| `GET` | `/api/events/servers` | `requireAuth` | Server state changes only |
| `GET` | `/api/events/incidents` | `requireAuth` | New incidents only |
| `GET` | `/api/events/diagnosis` | `requireAuth` | AI diagnosis results only |

**SSE event types pushed by backend:**
- `connected` — on connect, sends role + channel
- `server:updated` — when any server row changes
- `incident:new` — when a healing event fires
- `diagnosis:new` — when AI produces a diagnosis
- `session:refresh` — sent after 10 min to force reconnect
- `: heartbeat` — keepalive comment every 25s

---

### 👤 User / Auth — `/api/user`, `/api/admin`, `/api/superadmin`
> File: [user.js](file:///Users/satveekgupta/Developer/cloud-healing/backend/src/routes/user.js)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/api/user/me` | `requireAuth` | Get current user profile (id, clerk_id, email, role) |
| `POST` | `/api/user/session/login` | `requireAuth` | Log login event to audit trail |
| `POST` | `/api/user/session/logout` | `requireAuth` | Log logout event to audit trail |
| `GET` | `/api/admin/example` | `requireAdmin` | Admin-scoped test route |
| `POST` | `/api/admin/example-action` | `requireAdmin` | Admin-scoped audit test |
| `GET` | `/api/superadmin/example` | `requireSuperAdmin` | SuperAdmin-scoped test route |
| `POST` | `/api/superadmin/example-action` | `requireSuperAdmin` | SuperAdmin-scoped audit test |

---

## WebSocket

> File: [config.js](file:///Users/satveekgupta/Developer/cloud-healing/frontend/src/lib/config.js)

The frontend also maintains a **WebSocket connection** derived from `BACKEND_URL`:
- `http://` → `ws://`
- `https://` → `wss://`

Used for real-time broadcast of server state changes alongside SSE.

---

## Agent Call Flow (agent.js)

> File: [agent.js](file:///Users/satveekgupta/Developer/cloud-healing/agent/agent.js)

```
Boot
 └─► POST /api/servers/register-server   ← registers itself, gets server_id

Every 5s (CMD_POLL_MS):
 └─► GET  /api/commands/:server_id       ← polls for queued command
      └─► (if command received)
           ├── execute locally (restart_service / kill_process / scale_up)
           └── POST /api/commands/:server_id/ack   ← acknowledges execution

Every 30s (LOG_POLL_MS):
 └─► scan local logs (journalctl / syslog / macOS log)
      └─► (if critical/warning keywords found)
           └── POST /api/metrics   ← pushes log alert with severity + summary
```

---

## Frontend ↔ Backend Call Patterns

The frontend (Next.js) calls the backend with a Clerk JWT via `Authorization: Bearer`:

```
Frontend Page Load:
 ├── GET  /api/latest          ← initial dashboard data (servers + last diagnosis)
 ├── GET  /api/stats           ← cluster-level stats widget
 └── GET  /api/events          ← SSE stream (stays open for real-time updates)

Servers Page:
 ├── GET  /api/servers         ← server list
 └── GET  /api/metrics/:id     ← per-server metric history chart

History Page:
 └── GET  /api/history         ← paginated incident log

Admin Actions:
 ├── POST /api/commands/:id    ← dispatch manual command to a server
 ├── POST /api/servers/register ← add a new server (superadmin only)
 └── DELETE /api/servers/:id  ← remove a server

Auth:
 ├── POST /api/user/session/login   ← on sign-in
 └── POST /api/user/session/logout  ← on sign-out
```
