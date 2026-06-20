# SelfHeal Agent

A lightweight, standalone Node.js telemetry agent that continuously collects system metrics, log events, and process health data, then publishes structured events to a **Redis Stream** for consumption by the SelfHeal backend.

---

## Overview

```
┌─────────────────────────────────────────────────────┐
│                  SelfHeal Agent                     │
│                                                     │
│  ┌──────────┐  ┌──────────┐  ┌──────────────────┐  │
│  │  metrics │  │   logs   │  │    processes     │  │
│  └────┬─────┘  └────┬─────┘  └────────┬─────────┘  │
│       └─────────────┴─────────────────┘            │
│                      │                             │
│             ┌─────────▼──────────┐                 │
│             │  computeHealthScore │                 │
│             └─────────┬──────────┘                 │
│                       │                            │
│             ┌─────────▼──────────┐                 │
│             │  RedisProducer      │                 │
│             │  XADD telemetry_   │                 │
│             │       stream       │                 │
│             └─────────┬──────────┘                 │
└───────────────────────┼─────────────────────────────┘
                        │
              ┌─────────▼──────────┐
              │   Redis Streams    │
              └────────────────────┘
```

The agent also:
- **Registers** itself with the SelfHeal backend REST API on startup.
- Sends periodic **heartbeats** to signal liveness.
- Signs all outbound requests with **HMAC-SHA256** for tamper detection.

---

## Prerequisites

| Requirement | Version |
|-------------|---------|
| Node.js     | ≥ 18.0.0 |
| Redis       | ≥ 6.x (Streams support) |
| SelfHeal Backend | Running and reachable |

---

## Installation

```bash
# 1. Clone or copy the agent directory
cd /path/to/selfheal-agent

# 2. Install dependencies
npm install

# 3. Copy the example environment file and fill in your values
cp .env.example .env
```

---

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `BACKEND_URL` | `http://localhost:8000` | SelfHeal backend base URL |
| `REDIS_URL` | `redis://localhost:6379` | Redis connection URL |
| `AGENT_ID` | `auto` | Agent identifier. `auto` = derived from hostname + MAC address |
| `ENVIRONMENT` | `production` | Deployment environment tag (e.g. `staging`, `production`) |
| `COLLECT_INTERVAL_MS` | `10000` | Telemetry collection interval in milliseconds |
| `HEARTBEAT_INTERVAL_MS` | `30000` | Heartbeat ping interval in milliseconds |
| `LOG_LEVEL` | `info` | Log verbosity (informational only, not enforced in current version) |

---

## Running the Agent

### Development (with auto-restart on file changes)

```bash
npm run dev
```

### Production (Node.js directly)

```bash
npm start
# or
node src/index.js
```

### As a systemd service (Linux)

```bash
# 1. Copy agent files to /opt/selfheal-agent
sudo cp -r . /opt/selfheal-agent
sudo cp .env /opt/selfheal-agent/.env
cd /opt/selfheal-agent && sudo npm install --omit=dev

# 2. Install the systemd unit
sudo cp selfheal-agent.service /etc/systemd/system/
sudo systemctl daemon-reload

# 3. Enable and start
sudo systemctl enable selfheal-agent
sudo systemctl start selfheal-agent

# 4. Check status and logs
sudo systemctl status selfheal-agent
sudo journalctl -u selfheal-agent -f
```

### Docker

```dockerfile
FROM node:18-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install --omit=dev
COPY . .
CMD ["node", "src/index.js"]
```

```bash
docker build -t selfheal-agent .
docker run -d \
  --name selfheal-agent \
  --env-file .env \
  --restart unless-stopped \
  selfheal-agent
```

---

## Project Structure

```
selfheal-agent/
├── src/
│   ├── index.js                    # Main entry point & orchestrator
│   ├── auth.js                     # Registration, heartbeat, HMAC signing
│   ├── health.js                   # Health score computation
│   ├── collectors/
│   │   ├── metrics.js              # CPU, memory, disk, network, load avg
│   │   ├── logs.js                 # System log collection & classification
│   │   └── processes.js            # Process health (crashed, high CPU/mem)
│   └── transport/
│       ├── eventBusProducer.js     # Abstract base class
│       └── redisProducer.js        # Redis Streams implementation
├── .env.example                    # Environment variable template
├── package.json
├── selfheal-agent.service          # systemd unit file
└── README.md
```

---

## Telemetry Event Schema

Each event published to the `telemetry_stream` Redis Stream contains the following fields:

| Field | Type | Description |
|---|---|---|
| `agent_id` | string | Unique agent identifier |
| `cpu` | float | CPU usage percentage (0–100) |
| `memory` | float | Memory usage percentage (0–100) |
| `memory_used_mb` | float | Active memory in megabytes |
| `disk` | float | Primary disk usage percentage (0–100) |
| `disk_used_gb` | float | Used disk space in gigabytes |
| `network_in` | float | Inbound network bytes/sec (all interfaces) |
| `network_out` | float | Outbound network bytes/sec (all interfaces) |
| `load_avg_1m` | float | 1-minute load average |
| `load_avg_5m` | float | 5-minute load average |
| `uptime_seconds` | float | System uptime in seconds |
| `health_score` | integer | Aggregate health score (0–100) |
| `log_severity` | string | `INFO` \| `WARNING` \| `ERROR` \| `CRITICAL` |
| `log_summary` | string | Up to 3 representative log lines joined by ` \| ` |
| `log_keywords` | JSON string | Array of matched severity keywords |
| `process_crashed` | integer | Count of zombie/stopped processes |
| `process_high_cpu` | integer | Count of processes with CPU > 50% |
| `process_report` | JSON string | Human-readable process health summary |
| `timestamp` | string | ISO 8601 collection timestamp |

### Health Score Breakdown

The health score starts at **100** and deducts points based on:

| Condition | Deduction |
|---|---|
| CPU > 70% | −10 |
| CPU > 85% | −20 |
| CPU > 95% | −30 |
| Memory > 65% | −8 |
| Memory > 80% | −15 |
| Memory > 90% | −25 |
| Disk > 80% | −10 |
| Disk > 90% | −20 |
| Disk > 95% | −30 |
| Each crashed process | −15 (max −30) |
| Log severity: WARNING | −5 |
| Log severity: ERROR | −15 |
| Log severity: CRITICAL | −25 |

---

## Security

- All requests to the backend include an `X-Agent-Signature: hmac-sha256=<sig>` header.
- The signature covers the full JSON request body, using the token issued at registration.
- Agent IDs are deterministically derived (hash of hostname + MAC) and cannot be spoofed without matching the hardware identity.

---

## Extending Transport

To add a new transport (e.g. Kafka, NATS), extend `EventBusProducer` and swap out `RedisProducer` in `src/index.js`:

```js
// src/transport/kafkaProducer.js
const EventBusProducer = require('./eventBusProducer');
class KafkaProducer extends EventBusProducer {
  async connect()               { /* ... */ }
  async publish(topic, payload) { /* ... */ }
  async disconnect()            { /* ... */ }
}
module.exports = KafkaProducer;
```

---

## License

ISC
