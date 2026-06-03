#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════
#  setup-node-exporter.sh
#
#  One-shot setup script for node_exporter on any Linux server.
#  Works on: AWS EC2, DigitalOcean Droplets, GCP VMs, Azure VMs,
#            Hetzner, Vultr, Linode, bare metal — anything Debian/Ubuntu/RHEL based.
#
#  Run as root:
#    curl -fsSL https://raw.githubusercontent.com/.../setup-node-exporter.sh | sudo bash
#  Or:
#    sudo bash setup-node-exporter.sh
#
#  After running:
#    - node_exporter runs on port 9100
#    - Metrics available at: http://<server-ip>:9100/metrics
#    - Service auto-starts on reboot via systemd
# ═══════════════════════════════════════════════════════════════

set -euo pipefail

# ── Config ────────────────────────────────────────────────────────────────────
NE_VERSION="1.8.2"
NE_PORT="9100"
NE_USER="node_exporter"

# IMPORTANT: Restrict port 9100 to your backend server's IP only.
# Replace with your actual backend IP — leave empty to allow all (NOT recommended for production).
BACKEND_IP=""   # e.g. "203.0.113.42"

# ── Colors ────────────────────────────────────────────────────────────────────
GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; NC='\033[0m'
info()    { echo -e "${GREEN}[✓]${NC} $*"; }
warn()    { echo -e "${YELLOW}[!]${NC} $*"; }
error()   { echo -e "${RED}[✗]${NC} $*"; exit 1; }

# ── Root check ────────────────────────────────────────────────────────────────
[[ $EUID -ne 0 ]] && error "Run as root: sudo bash $0"

# ── Detect arch ──────────────────────────────────────────────────────────────
ARCH=$(uname -m)
case $ARCH in
  x86_64)          NE_ARCH="amd64"  ;;
  aarch64|arm64)   NE_ARCH="arm64"  ;;
  armv7l)          NE_ARCH="armv7"  ;;
  *)               error "Unsupported architecture: $ARCH" ;;
esac
info "Detected architecture: $ARCH → $NE_ARCH"

# ── Download node_exporter ────────────────────────────────────────────────────
NE_FILE="node_exporter-${NE_VERSION}.linux-${NE_ARCH}"
NE_URL="https://github.com/prometheus/node_exporter/releases/download/v${NE_VERSION}/${NE_FILE}.tar.gz"

info "Downloading node_exporter v${NE_VERSION}..."
cd /tmp
curl -fsSL "$NE_URL" -o node_exporter.tar.gz
tar xzf node_exporter.tar.gz
mv "${NE_FILE}/node_exporter" /usr/local/bin/node_exporter
chmod +x /usr/local/bin/node_exporter
rm -rf node_exporter.tar.gz "${NE_FILE}"
info "Installed to /usr/local/bin/node_exporter"

# Verify
/usr/local/bin/node_exporter --version | head -1

# ── Create dedicated system user ──────────────────────────────────────────────
if ! id "$NE_USER" &>/dev/null; then
  useradd --no-create-home --shell /bin/false "$NE_USER"
  info "Created system user: $NE_USER"
fi

# ── systemd service ───────────────────────────────────────────────────────────
cat > /etc/systemd/system/node_exporter.service << EOF
[Unit]
Description=Prometheus Node Exporter
Documentation=https://github.com/prometheus/node_exporter
After=network-online.target
Wants=network-online.target

[Service]
User=${NE_USER}
Group=${NE_USER}
Type=simple
Restart=on-failure
RestartSec=5s
ExecStart=/usr/local/bin/node_exporter \\
  --web.listen-address=0.0.0.0:${NE_PORT} \\
  --collector.disable-defaults \\
  --collector.cpu \\
  --collector.meminfo \\
  --collector.filesystem \\
  --collector.loadavg \\
  --collector.time \\
  --collector.uname \\
  --collector.netdev

[Install]
WantedBy=multi-user.target
EOF

info "Created systemd service: /etc/systemd/system/node_exporter.service"

# ── Enable and start ──────────────────────────────────────────────────────────
systemctl daemon-reload
systemctl enable node_exporter
systemctl restart node_exporter
sleep 2

if systemctl is-active --quiet node_exporter; then
  info "node_exporter is running on port ${NE_PORT}"
else
  error "node_exporter failed to start. Check: journalctl -u node_exporter -n 20"
fi

# ── Firewall: restrict port 9100 ──────────────────────────────────────────────
echo ""
warn "SECURITY: Port ${NE_PORT} must only be accessible from your backend server."

# Try UFW first (Ubuntu/Debian)
if command -v ufw &>/dev/null && ufw status | grep -q "Status: active"; then
  if [[ -n "$BACKEND_IP" ]]; then
    ufw allow from "$BACKEND_IP" to any port "$NE_PORT" proto tcp comment "SelfHeal backend"
    ufw deny "$NE_PORT"
    info "UFW: port ${NE_PORT} restricted to ${BACKEND_IP}"
  else
    warn "BACKEND_IP not set — port ${NE_PORT} is open to all. Set BACKEND_IP and re-run."
    ufw allow "$NE_PORT"/tcp comment "node_exporter (RESTRICT THIS)"
  fi
# Try firewalld (RHEL/CentOS)
elif command -v firewall-cmd &>/dev/null && firewall-cmd --state &>/dev/null; then
  if [[ -n "$BACKEND_IP" ]]; then
    firewall-cmd --permanent --add-rich-rule="rule family=ipv4 source address=${BACKEND_IP} port port=${NE_PORT} protocol=tcp accept"
    firewall-cmd --reload
    info "firewalld: port ${NE_PORT} restricted to ${BACKEND_IP}"
  else
    warn "BACKEND_IP not set — manually restrict port ${NE_PORT} in your cloud provider firewall."
  fi
else
  warn "No active firewall detected. Restrict port ${NE_PORT} in your cloud provider's security group/firewall."
fi

# ── Done ──────────────────────────────────────────────────────────────────────
echo ""
echo "═══════════════════════════════════════════════════════════"
echo "  node_exporter setup complete!"
echo ""
echo "  Metrics endpoint: http://$(hostname -I | awk '{print $1}'):${NE_PORT}/metrics"
echo "  Service status:   systemctl status node_exporter"
echo "  Logs:             journalctl -u node_exporter -f"
echo ""
echo "  Register this server in your SelfHeal dashboard:"
echo "    Name:          $(hostname)"
echo "    IP:            $(hostname -I | awk '{print $1}')"
echo "    Exporter port: ${NE_PORT}"
echo "═══════════════════════════════════════════════════════════"
