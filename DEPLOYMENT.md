# SelfHeal Phase 1 — Deployment Guide

## Prerequisites

| Requirement | Version |
|---|---|
| Node.js | 18+ |
| Redis | 7.x (or managed: Upstash, Redis Cloud, Railway) |
| Supabase | Any plan |
| Docker (optional) | 24+ |

---

## Step 1 — Apply Database Migrations

Open the Supabase SQL editor for your project and run:

```
backend/migrations/phase1_agents.sql
```

This creates:
- `agents` table — registered agent registry
- `telemetry` table — time-series metrics
- Adds `agent_id` and `incident_id` columns to existing `incidents`
- Creates performance indexes

> **All changes are additive** — no existing tables are dropped or altered destructively.

---

## Step 2 — Start Redis

### Option A: Docker (recommended for local dev)
```bash
docker compose up redis -d
```

Redis will be available at `redis://localhost:6379`.

### Option B: Use your existing Redis instance
Set `REDIS_URL` in each service's `.env` to point to your instance:
```
REDIS_URL=redis://your-host:6379
# or TLS:
REDIS_URL=rediss://user:pass@your-host:6380
```

---

## Step 3 — Configure & Start the Backend

```bash
cd backend
cp .env.example .env     # fill in SUPABASE_URL, SUPABASE_KEY, REDIS_URL, Clerk keys
npm install
npm run dev
```

The backend will start on `http://localhost:8000`.

Verify Redis connectivity:
```bash
curl http://localhost:8000/health
```

---

## Step 4 — Start the Processing Engine

The processing engine is a **separate process**. Run it alongside the backend:

```bash
cd services/processing-engine
cp .env.example .env     # fill in REDIS_URL, SUPABASE_URL, SUPABASE_KEY
npm install
npm start
```

You should see:
```
[INFO] Ensuring consumer group 'processing-engine' on stream 'telemetry_stream'...
[INFO] Consumer group ready. Starting to consume...
[INFO] Waiting for messages...
```

---

## Step 5 — Deploy the SelfHeal Agent

### Install on a Linux server

```bash
# 1. Copy agent directory to the target server
scp -r agents/selfheal-agent/ user@your-server:/opt/selfheal-agent

# 2. SSH into the server
ssh user@your-server

# 3. Install dependencies
cd /opt/selfheal-agent
npm install

# 4. Configure
cp .env.example .env
nano .env
```

Minimum `.env` for the agent:
```
BACKEND_URL=https://your-backend.example.com
REDIS_URL=redis://your-redis-host:6379
ENVIRONMENT=production
```

```bash
# 5. Run as systemd service (auto-restart on crash/reboot)
cp selfheal-agent.service /etc/systemd/system/
systemctl daemon-reload
systemctl enable selfheal-agent
systemctl start selfheal-agent

# 6. Check status
systemctl status selfheal-agent
journalctl -u selfheal-agent -f
```

### Run in Docker

```dockerfile
# Dockerfile for the agent
FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
COPY src/ ./src/
CMD ["node", "src/index.js"]
```

```bash
docker build -t selfheal-agent:latest agents/selfheal-agent/
docker run -d \
  --name selfheal-agent \
  --restart unless-stopped \
  -e BACKEND_URL=https://your-backend.example.com \
  -e REDIS_URL=redis://redis:6379 \
  -e ENVIRONMENT=production \
  selfheal-agent:latest
```

### Run in Kubernetes (DaemonSet)

```yaml
apiVersion: apps/v1
kind: DaemonSet
metadata:
  name: selfheal-agent
  namespace: monitoring
spec:
  selector:
    matchLabels:
      app: selfheal-agent
  template:
    metadata:
      labels:
        app: selfheal-agent
    spec:
      containers:
        - name: selfheal-agent
          image: your-registry/selfheal-agent:latest
          env:
            - name: BACKEND_URL
              value: "https://your-backend.example.com"
            - name: REDIS_URL
              valueFrom:
                secretKeyRef:
                  name: selfheal-secrets
                  key: redis-url
            - name: ENVIRONMENT
              value: "kubernetes"
          resources:
            requests:
              cpu: 10m
              memory: 64Mi
            limits:
              cpu: 100m
              memory: 128Mi
```

---

## Step 6 — Start the Frontend

```bash
cd frontend
npm install
npm run dev
```

Navigate to:
- `http://localhost:3000/infrastructure` — Fleet overview
- `http://localhost:3000/incidents` — Incident Center

---

## Verification

### Check an agent registered:
```bash
curl http://localhost:8000/api/agents \
  -H "Authorization: Bearer <your-clerk-jwt>"
```

### Manually push a test telemetry event to Redis:
```bash
redis-cli XADD telemetry_stream '*' \
  agent_id test-agent-001 \
  cpu 88 memory 75 disk 40 \
  health_score 72 \
  log_severity INFO log_summary "All OK" \
  process_crashed 0 \
  timestamp "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
```

The processing engine should log:
```
[INFO] Processing event from stream...
[INFO] Telemetry written for agent test-agent-001
[INFO] Anomaly detected: high_cpu (cpu=88%)
[INFO] Incident created: high_cpu for agent test-agent-001
```

### Trigger a critical incident (CPU stress test):
```bash
# On a node running the agent:
node agents/selfheal-agent/stress-cpu.js
```

Watch `/infrastructure` — the agent card should turn red and an incident should appear in `/incidents`.

---

## Environment Variables Reference

### Backend (`backend/.env`)

| Variable | Required | Description |
|---|---|---|
| `SUPABASE_URL` | ✅ | Supabase project URL |
| `SUPABASE_KEY` | ✅ | Service role key |
| `REDIS_URL` | ✅ | Redis connection string |
| `CLERK_SECRET_KEY` | ✅ | Clerk backend secret |
| `FRONTEND_URL` | ✅ | Frontend origin (CORS) |
| `GEMINI_API_KEY` | Optional | For AI healing (existing feature) |

### Processing Engine (`services/processing-engine/.env`)

| Variable | Required | Description |
|---|---|---|
| `REDIS_URL` | ✅ | Redis connection string |
| `SUPABASE_URL` | ✅ | Supabase project URL |
| `SUPABASE_KEY` | ✅ | Service role key |
| `CONSUMER_GROUP` | Optional | Default: `processing-engine` |
| `CONSUMER_NAME` | Optional | Default: `engine-1` (increment for scale-out) |
| `BATCH_SIZE` | Optional | Default: `10` messages per poll |

### Agent (`agents/selfheal-agent/.env`)

| Variable | Required | Description |
|---|---|---|
| `BACKEND_URL` | ✅ | Backend base URL |
| `REDIS_URL` | ✅ | Redis connection string |
| `ENVIRONMENT` | Optional | Default: `production` |
| `AGENT_ID` | Optional | Default: `auto` (stable hash of hostname+MAC) |
| `COLLECT_INTERVAL_MS` | Optional | Default: `10000` (10s) |
| `HEARTBEAT_INTERVAL_MS` | Optional | Default: `30000` (30s) |

---

## Scaling Out

### Multiple processing engine consumers:
```bash
# Terminal 1
CONSUMER_NAME=engine-1 node services/processing-engine/src/index.js

# Terminal 2
CONSUMER_NAME=engine-2 node services/processing-engine/src/index.js
```

Redis consumer groups distribute messages across consumers automatically.

### Swap Redis for NATS/Kafka (future):
1. Implement `services/processing-engine/src/natsAdapter.js` matching the `EventBusConsumer` interface
2. Update import in `services/processing-engine/src/consumer.js`
3. No other changes required

---

## Monitoring the Platform Itself

| Signal | Where to look |
|---|---|
| Agent health | `journalctl -u selfheal-agent -f` |
| Redis stream depth | `redis-cli XLEN telemetry_stream` |
| Consumer lag | `redis-cli XINFO GROUPS telemetry_stream` |
| Processing engine | stdout / Docker logs |
| Backend logs | stdout / PM2 logs |
| Supabase | Table editor → `telemetry`, `agents`, `incidents` |
