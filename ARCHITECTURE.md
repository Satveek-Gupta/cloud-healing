# SelfHeal — Architecture

## System Overview

SelfHeal is an AI-powered, distributed observability platform designed around a production-grade telemetry pipeline. The architecture follows the Datadog/New Relic agent model: lightweight agents run on every monitored node and stream data into a centralized, event-driven processing backend.

```mermaid
flowchart TD
    subgraph Nodes["Monitored Nodes (any environment)"]
        A1[SelfHeal Agent<br/>Linux Server]
        A2[SelfHeal Agent<br/>Docker Container]
        A3[SelfHeal Agent<br/>Kubernetes Node]
        A4[SelfHeal Agent<br/>VM]
    end

    subgraph EventBus["Event Bus Layer"]
        RS[(Redis Streams<br/>telemetry_stream)]
        note1["Future: NATS / Kafka<br/>(swap adapter only)"]
    end

    subgraph Backend["Backend (Node.js / Express)"]
        API[API Server<br/>:8000]
        AR[/api/agents/register<br/>/api/agents/heartbeat<br/>/api/agents/telemetry]
    end

    subgraph PE["Processing Engine (Standalone Process)"]
        CG[Consumer Group]
        VAL[Validator]
        NRM[Normalizer]
        AD[Anomaly Detector<br/>Rule Engine]
        IM[Incident Manager]
        SW[Storage Writer]
    end

    subgraph Storage["Storage Layer (Supabase / Postgres)"]
        DB_A[(agents)]
        DB_T[(telemetry)]
        DB_I[(incidents)]
    end

    subgraph AI["AI Layer (Phase 2)"]
        LLM[Gemini / OpenAI<br/>Diagnosis Engine]
    end

    subgraph Dashboard["Dashboard (Next.js)"]
        UI_INF[/infrastructure<br/>Fleet Overview]
        UI_AGT[/infrastructure/agentId<br/>Agent Detail]
        UI_INC[/incidents<br/>Incident Center]
        UI_DSH[/dashboard<br/>Legacy Dashboard]
    end

    A1 & A2 & A3 & A4 -->|XADD telemetry_stream| RS
    A1 & A2 & A3 & A4 -->|POST /api/agents/register<br/>POST /api/agents/heartbeat| API
    API -->|XADD relay| RS
    RS -->|XREADGROUP| CG
    CG --> VAL --> NRM --> AD --> IM
    NRM --> SW
    IM --> SW
    SW --> DB_A & DB_T & DB_I
    DB_I --> AI
    AI --> DB_I
    DB_A & DB_T & DB_I --> Dashboard
```

---

## Component Responsibilities

### SelfHeal Agent (`agents/selfheal-agent/`)

| Responsibility | Implementation |
|---|---|
| Metrics collection (10s interval) | `systeminformation` — CPU, memory, disk, network, load, uptime |
| Log collection + classification | `journalctl` / `/var/log/syslog` / macOS `log show` |
| Process monitoring | `si.processes()` — crashed, high-CPU, high-memory |
| Health score (0–100) | Weighted penalty formula across all dimensions |
| Redis producer | `ioredis` + `XADD telemetry_stream` |
| Agent registration | `POST /api/agents/register` → receives token |
| HMAC request signing | `crypto.createHmac('sha256', token)` on every signed request |
| Heartbeat | Every 30s to `POST /api/agents/heartbeat` |

**Health Score Formula:**
```
score = 100
  - CPU penalty   (0 / 10 / 20 / 30 based on thresholds)
  - Memory penalty (0 / 8 / 15 / 25)
  - Disk penalty   (0 / 10 / 20 / 30)
  - 15 per crashed process (max −30)
  - Log penalty   (WARNING=5, ERROR=15, CRITICAL=25)
clamped to [0, 100]
```

---

### Event Bus Layer (`backend/src/lib/eventBus/`)

Built around a **pluggable adapter pattern**:

```
EventBusProducer (abstract)
  └── RedisStreamProducer   ← current
  └── NatsProducer          ← future
  └── KafkaProducer         ← future
```

The agent and the backend relay use `RedisStreamProducer` which calls `XADD telemetry_stream * field1 val1 ...`.  
To migrate to Kafka: implement `KafkaProducer` with the same interface, update the import. **Zero other changes required.**

---

### Agent Registration API (`backend/src/routes/agents.js`)

| Endpoint | Auth | Description |
|---|---|---|
| `POST /api/agents/register` | None (bootstrap) | Upsert agent, auto-generate and return token |
| `POST /api/agents/heartbeat` | HMAC signature | Update `last_seen` |
| `POST /api/agents/telemetry` | HMAC signature | Relay telemetry to Redis stream |
| `GET /api/agents` | Clerk JWT | List all agents |
| `GET /api/agents/:id` | Clerk JWT | Agent detail + telemetry history + incidents |

**Token lifecycle:**
1. Agent calls `POST /api/agents/register` (no auth)
2. Backend generates `crypto.randomBytes(32).toString('hex')`
3. Token stored in `agents.token` column
4. Subsequent signed requests use `X-Agent-Signature: hmac-sha256=<hex>`

---

### Processing Engine (`services/processing-engine/`)

A **separate Node.js process** — not imported by the backend. Designed to scale independently.

```
Pipeline per telemetry event:
  1. Consume from Redis (XREADGROUP, Consumer Group)
  2. Validate — reject malformed payloads
  3. Normalize — timestamps, units, clamping
  4. Write to `telemetry` table
  5. Update `agents.last_seen` + status
  6. Anomaly detection (rule engine)
  7. Create incidents (with deduplication)
  8. ACK message (XACK)
```

**Anomaly Rules:**
| Rule | Threshold | Severity | Incident Type |
|---|---|---|---|
| High CPU | > 85% | warning | `high_cpu` |
| Critical CPU | > 95% | critical | `critical_cpu` |
| High Memory | > 80% | warning | `high_memory` |
| Critical Memory | > 90% | critical | `critical_memory` |
| Disk Warning | > 80% | warning | `disk_warning` |
| Disk Critical | > 90% | critical | `disk_critical` |
| Process Crash | detected | critical | `process_crash` |
| Critical Log | CRITICAL | critical | `log_critical` |
| Error Log | ERROR | warning | `log_error` |
| Low Health | < 40 | critical | `low_health_score` |

---

### Storage Schema

```sql
agents (
  id UUID PK, agent_id TEXT UNIQUE, hostname TEXT, os TEXT,
  ip TEXT, environment TEXT, version TEXT, token TEXT,
  last_seen TIMESTAMPTZ, status TEXT, created_at TIMESTAMPTZ
)

telemetry (
  id UUID PK, agent_id TEXT → agents,
  cpu NUMERIC, memory NUMERIC, disk NUMERIC,
  network_in BIGINT, network_out BIGINT,
  uptime BIGINT, load_avg NUMERIC, health_score SMALLINT,
  log_summary TEXT, process_report JSONB,
  timestamp TIMESTAMPTZ
)

incidents (
  id UUID PK, incident_id TEXT UNIQUE,
  agent_id TEXT, severity TEXT, type TEXT,
  summary TEXT, status TEXT, created_at TIMESTAMPTZ
)
```

---

### Dashboard (Next.js)

| Route | Purpose |
|---|---|
| `/dashboard` | Legacy dashboard (unchanged) |
| `/infrastructure` | Fleet overview — all agents, stat cards, health grid |
| `/infrastructure/[agentId]` | Agent detail — metrics, sparklines, logs, incidents |
| `/incidents` | Incident Center — filter/search, severity distribution |

---

## Data Flow — Telemetry Event

```
Agent (every 10s)
  └── collectMetrics()  ─┐
  └── collectLogs()     ─┼── computeHealthScore()
  └── collectProcesses()─┘
        │
        ▼
  Publish to Redis: XADD telemetry_stream * agent_id x cpu 65 memory 54 ...
        │
        ▼
  Processing Engine (Consumer Group "processing-engine")
        │
        ├── validate(rawEvent)      → reject if malformed
        ├── normalize(data)         → ISO timestamps, clamp values
        ├── writeTelemetry()        → INSERT into telemetry
        ├── updateAgentStatus()     → UPDATE agents SET last_seen, status
        ├── detectAnomalies()       → run 10 rules
        └── createIncidents()       → INSERT open incidents (deduplicated)
        │
        ▼
  Supabase (Postgres)
        │
        ▼
  Dashboard (polling /api/agents, /api/history)
```

---

## Scalability Design

The architecture is built for future horizontal scale:

| Current | Future Path |
|---|---|
| Redis Streams | NATS JetStream or Apache Kafka (swap `redisAdapter.js`) |
| Single consumer process | Multiple consumer instances (different `CONSUMER_NAME`) |
| Rule-based anomaly detection | ML scoring layer (add pre-processing step) |
| Supabase / Postgres | TimescaleDB for hypertables, ClickHouse for analytics |
| OpenAI/Gemini | OpenTelemetry integration (Phase 3) |
| Manual remediation | Auto-remediation actions (Phase 4) |

---

## Security Model

| Layer | Mechanism |
|---|---|
| Agent ↔ Backend | HMAC-SHA256 on every signed request (`X-Agent-Signature`) |
| Backend ↔ Dashboard | Clerk JWT authentication |
| Agent registration | No auth (bootstrap) — token returned and stored locally |
| CORS | Explicit allowlist in `config/env.js` |
| Rate limiting | `express-rate-limit` on `/api` |
| Headers | `helmet` — HSTS, X-Frame-Options, etc. |
