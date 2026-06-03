#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────
#  SelfHeal Lightweight Agent — Cloud Server Setup
#  Tested on: Ubuntu 20.04+, Debian 11+, Amazon Linux 2023
# ─────────────────────────────────────────────────────────────────

set -e

# ── 1. Install Node.js 20 (if not already present) ───────────────
if ! command -v node &>/dev/null || [[ $(node -e "process.exit(+process.version.slice(1)<18)"; echo $?) -ne 0 ]]; then
  echo "[setup] Installing Node.js 20..."
  curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
  sudo apt-get install -y nodejs
fi

echo "[setup] Node $(node --version) ready."

# ── 2. Create agent directory ─────────────────────────────────────
sudo mkdir -p /opt/selfheal-agent
sudo chown "$USER":"$USER" /opt/selfheal-agent

# ── 3. Copy agent files ───────────────────────────────────────────
cp agent.js /opt/selfheal-agent/agent.js

# ── 4. Write .env from environment variables ──────────────────────
# Set these before running: export BACKEND_URL=... SERVER_NAME=... etc.
cat > /opt/selfheal-agent/.env <<EOF
BACKEND_URL=${BACKEND_URL:?Set BACKEND_URL before running setup}
SERVER_NAME=${SERVER_NAME:-$(hostname)}
REGION=${REGION:-us-east-1}
CMD_POLL_MS=5000
LOG_POLL_MS=30000
LOG_COOLDOWN_MS=60000

# Optional: shell command to run on restart_service / scale_up actions
# RESTART_CMD=systemctl restart myapp
# SCALE_CMD=kubectl scale deployment myapp --replicas=3
EOF

echo "[setup] Config written to /opt/selfheal-agent/.env"

# ── 5. Install systemd service ────────────────────────────────────
sudo tee /etc/systemd/system/selfheal-agent.service > /dev/null <<EOF
[Unit]
Description=SelfHeal Lightweight Agent
After=network.target
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=/opt/selfheal-agent
ExecStart=/usr/bin/node /opt/selfheal-agent/agent.js
EnvironmentFile=/opt/selfheal-agent/.env
Restart=always
RestartSec=5
StandardOutput=journal
StandardError=journal
SyslogIdentifier=selfheal-agent

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable selfheal-agent
sudo systemctl restart selfheal-agent

echo ""
echo "✅  SelfHeal Agent installed and running!"
echo "    Check status : sudo systemctl status selfheal-agent"
echo "    Live logs    : sudo journalctl -u selfheal-agent -f"
echo "    Stop         : sudo systemctl stop selfheal-agent"
