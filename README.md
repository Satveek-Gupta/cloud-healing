# ☁️ Cloud-Heal: AI-Powered Self-Healing Infrastructure

<p align="center">
  <a href="https://github.com/Satveek-Gupta/cloud-healing">
    <img src="https://img.shields.io/github/stars/Satveek-Gupta/cloud-healing?style=for-the-badge&logo=github&logoColor=white&color=24292e" alt="Stars">
  </a>
  <a href="https://github.com/Satveek-Gupta/cloud-healing/issues">
    <img src="https://img.shields.io/github/issues/Satveek-Gupta/cloud-healing?style=for-the-badge&logo=github&logoColor=white&color=d73a49" alt="Issues">
  </a>
  <a href="https://github.com/Satveek-Gupta/cloud-healing/blob/main/LICENSE">
    <img src="https://img.shields.io/badge/License-MIT-green.svg?style=for-the-badge" alt="License">
  </a>
  <a href="https://cloud.digitalocean.com/apps/new?repo=https://github.com/Satveek-Gupta/cloud-healing">
    <img src="https://img.shields.io/badge/Deploy%20To-DigitalOcean-0080FF?style=for-the-badge&logo=digitalocean&logoColor=white" alt="Deploy to DigitalOcean">
  </a>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Frontend-Next.js_14-black?style=flat-square&logo=next.js" alt="Next.js">
  <img src="https://img.shields.io/badge/Backend-Express.js-000000?style=flat-square&logo=express" alt="Express.js">
  <img src="https://img.shields.io/badge/Database-Supabase-3ECF8E?style=flat-square&logo=supabase" alt="Supabase">
  <img src="https://img.shields.io/badge/Agent-Node.js-339933?style=flat-square&logo=node.js&logoColor=white" alt="Node.js Agent">
  <img src="https://img.shields.io/badge/AI-Gemini_Flash-4285F4?style=flat-square&logo=google&logoColor=white" alt="Gemini Flash">
</p>

Cloud-Heal is a production-grade infrastructure monitoring and automated remediation system. It combines real-time metrics collection, AI-driven anomaly detection, and autonomous "self-healing" actions to keep your cloud servers healthy without manual intervention.

---

## 🏗️ Architecture

The system consists of three primary components:

### 1. 🖥️ Dashboard (Frontend)
A high-performance monitoring dashboard built with **Next.js 14** and **Geist Sans/Mono** typography.
- **Live Monitoring**: Real-time server status and health scores.
- **Anomaly Visualization**: Clear indicators for CPU spikes, memory leaks, and log-based errors.
- **Healing Logs**: Detailed history of AI-triggered remediation actions.

### 2. 🧠 Brain (Backend)
An **Express.js** API that orchestrates the entire fleet.
- **AI Diagnosis**: Analyzes critical server states to suggest and trigger fixes (e.g., `restart_service`, `kill_process`).
- **Data Persistence**: Uses **Supabase** for robust server registration and metrics history.
- **Reliability**: Advanced upsert logic and heartbeat-based offline detection (90s stale threshold).

### 3. 🤖 Smart Node Agent
A lightweight **Node.js** daemon deployed on your servers (AWS, DigitalOcean, local).
- **Local Anomaly Detection**: Tracks CPU, Memory, Disk, and Load averages.
- **Log Watcher**: Monitors system logs for fatal errors and OOM events.
- **Healing Execution**: Receives commands from the Brain to perform graceful restarts or scaling.

---

## 🚀 Quick Start

### 1. Setup Backend & Frontend
1. Clone the repository.
2. Configure **DigitalOcean App Platform** or Vercel using the provided `.do/app.yaml`.
3. Set environment variables:
   - `NEXT_PUBLIC_BACKEND_URL`: Your backend API endpoint.
   - `SUPABASE_URL` / `SUPABASE_KEY`: Your database credentials.
   - `ALLOW_AI_MOCK`: Set to `true` for faster local testing without LLM costs.

### 2. Deploy the Agent
The agent can be deployed to any Linux/macOS environment.

**Direct Install:**
```bash
cd agent
npm install
cp .env.example .env
# Edit .env with your BACKEND_URL and SERVER_NAME
node agent.js
```

**Remote Relay (Bypassing SSH blocks):**
If your network blocks Port 22, use our **Base64 Relay** method via the provider's Web Console:
1. Generate the deployment payload (see [internal docs](docs/deployment.md)).
2. Paste the payload into the Cloud Console.

---

## 🛠️ Configuration

| Variable | Description | Default |
|---|---|---|
| `REPORT_INTERVAL` | How often the agent sends metrics (ms) | `20000` |
| `STALE_THRESHOLD_MS` | Delay before marking a server "Offline" | `90000` |
| `CPU_CRITICAL` | Threshold for AI healing triggers (%) | `85` |

---

## ✨ Features
- **Modern UI**: Dark-mode first design using the Geist design system.
- **Resilient Registration**: Prevents duplicate server entries on agent restart.
- **Graceful Healing**: AI explains *why* it's taking an action before executing.
- **Scalable Monitoring**: Optimized for low-bandwidth reporting environments.

---

## 🔍 Demo Access

Want to explore the dashboard without setting up your own environment? Use the read-only demo account:

| Field    | Value                  |
|----------|------------------------|
| Email    | `demo@satveek.dev`     |
| Password | `SelfHeal2026!`        |
| Role     | `USER` (read-only)     |

> **What you can do:** Browse the dashboard, view server metrics, inspect incident history, and watch the AI healing pipeline in real time.
>
> **What's restricted:** Registering new nodes, dispatching remediation commands (Restart / Scale Up / Kill Process), and deleting servers.

---

## 📄 License
MIT © Satveek Gupta
