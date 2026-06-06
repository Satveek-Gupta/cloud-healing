# SelfHeal Micro-Agent v4.0

A **zero-dependency** Node.js 18 daemon that does exactly two things:

| Responsibility | How |
|---|---|
| **Command execution** | Polls backend every 5s, runs `restart_service` / `kill_process` / `scale_up` |
| **Log alerting** | Scans system logs every 30s, pushes alert to backend if critical/warning keywords found |

No metrics collection. No extra packages. One file.

---

## Requirements

- Node.js ≥ 22 (uses built-in `fetch`)
- Network access to your Cloud-Heal backend

---

## Quick Start (any Linux/macOS server)

```bash
# 1. Copy agent to server (or clone the repo)
scp -r agent/ user@your-server:~/selfheal-agent

# 2. Configure
cp .env.example .env
nano .env              # set BACKEND_URL, SERVER_NAME, REGION, RESTART_CMD

# 3. Run
node agent.js
```

---

## Running on Cloud Servers

### Option A — systemd (recommended for production on Ubuntu/Debian/RHEL)

```bash
# Install Node 22 (LTS)
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs

# Deploy agent
sudo mkdir -p /opt/selfheal-agent
sudo cp agent.js /opt/selfheal-agent/
sudo cp .env     /opt/selfheal-agent/

# Install systemd service
sudo cp selfheal-agent.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable selfheal-agent
sudo systemctl start selfheal-agent

# Check logs
sudo journalctl -u selfheal-agent -f
```

The included [`selfheal-agent.service`](./selfheal-agent.service) file is ready to use — just edit `WorkingDirectory` and `Environment` if needed.

---

### Option B — One-liner remote deploy (no SSH setup needed)

If your cloud provider blocks port 22, paste this in the **Web Console** (DigitalOcean/AWS/GCP droplet console):

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash - && \
sudo apt-get install -y nodejs && \
mkdir -p ~/selfheal && cat > ~/selfheal/agent.js << 'AGENT'
# paste agent.js contents here
AGENT
cat > ~/selfheal/.env << 'ENV'
BACKEND_URL=https://your-backend.example.com
SERVER_NAME=$(hostname)
REGION=nyc3
RESTART_CMD=systemctl restart your-service
ENV
node ~/selfheal/agent.js &
```

---

### Option C — Docker

```dockerfile
FROM node:22-alpine
WORKDIR /app
COPY agent.js .
COPY .env .
CMD ["node", "agent.js"]
```

```bash
docker build -t selfheal-agent .
docker run -d --restart=unless-stopped \
  -e BACKEND_URL=https://your-backend.example.com \
  -e SERVER_NAME=my-container-node \
  -e REGION=us-east-1 \
  -e RESTART_CMD="echo restart" \
  --name selfheal-agent \
  selfheal-agent
```

> **Note**: `kill_process` and system log access require `--privileged` or appropriate capabilities inside Docker.

---

### Option D — PM2 (simple process manager)

```bash
npm install -g pm2
BACKEND_URL=https://your-backend.example.com \
SERVER_NAME=my-server \
REGION=us-east-1 \
pm2 start agent.js --name selfheal-agent
pm2 save
pm2 startup   # auto-restart on reboot
```

---

## Healing Hooks

Set these env vars so the agent can actually do something when commanded:

| Var | Example value |
|---|---|
| `RESTART_CMD` | `systemctl restart nginx` |
| `RESTART_CMD` | `pm2 restart all` |
| `RESTART_CMD` | `docker restart my-container` |
| `SCALE_CMD` | `doctl kubernetes cluster node-pool update my-cluster --count 3` |
| `SCALE_CMD` | `kubectl scale deployment/api --replicas=3` |

---

## Log alert keywords

The agent watches for these in `journalctl` / syslog output:

**Critical** (triggers healing): `out of memory`, `oom kill`, `kernel panic`, `fatal`, `segfault`, `killed process`, `stack overflow`

**Warning**: `connection refused`, `connection reset`, `timeout`, `too many open files`, `no space left`, `disk quota`

SSH scanner noise is automatically filtered out.

---

## Config reference

| Env var | Default | Description |
|---|---|---|
| `BACKEND_URL` | `http://localhost:5000` | Cloud-Heal backend URL |
| `SERVER_NAME` | OS hostname | Unique name for this node |
| `REGION` | `local` | Region label |
| `RESTART_CMD` | *(echo warning)* | Shell command to restart your service |
| `SCALE_CMD` | *(echo warning)* | Shell command to scale up |
| `CMD_POLL_MS` | `5000` | Command poll interval |
| `LOG_POLL_MS` | `30000` | Log scan interval |
| `LOG_COOLDOWN_MS` | `60000` | Min gap between log alerts |
