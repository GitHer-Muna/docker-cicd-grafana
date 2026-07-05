# docker-cicd-grafana

Containerizing HerWell with Docker, GitHub Actions CI/CD, and Grafana Monitoring on AWS EC2

---

## Table of Contents

- [Architecture](#architecture)
- [Prerequisites](#prerequisites)
- [AWS Setup](#aws-setup)
- [EC2 Setup](#ec2-setup)
- [ECR Setup](#ecr-setup)
- [GitHub Secrets](#github-secrets)
- [Deploying](#deploying)
- [Accessing Services](#accessing-services)
- [Monitoring](#monitoring)
- [Troubleshooting](#troubleshooting)

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         EC2 Host (t3.small)                      │
│                                                                   │
│  ┌──────────┐    ┌──────────────┐    ┌────────────────────────┐ │
│  │          │    │              │    │                        │ │
│  │  Users   │───▶│   Nginx      │───▶│  frontend:80 (React)   │ │
│  │ (port 80)│    │  (port 80)   │    │                        │ │
│  │          │    │              │    └────────────────────────┘ │
│  └──────────┘    │  reverse     │    ┌────────────────────────┐ │
│                  │  proxy       │───▶│                        │ │
│                  │              │    │  backend:3001 (Express) │ │
│                  │              │    │                        │ │
│                  └──────┬───────┘    └─────────┬──────────────┘ │
│                         │                      │                │
│                         │              ┌───────▼──────────┐    │
│                         │              │                  │    │
│                         └──────────────▶   db:5432 (Postgres) │
│                                        │                  │    │
│                                        └──────────────────┘    │
│                                                                   │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │  Monitoring Stack                                           │  │
│  │  ┌────────────┐     ┌──────────┐                           │  │
│  │  │ Prometheus  │◀────│ Backend  │ (scrapes /metrics)        │  │
│  │  │ :9090       │     │ :3001    │                           │  │
│  │  └────────────┘     └──────────┘                           │  │
│  │       ▲                                                   │  │
│  │       │ scrapes                                            │  │
│  │  ┌────┴─────────┐                                          │  │
│  │  │ Node Exporter │ (host metrics: CPU, RAM, disk)          │  │
│  │  │ :9100        │                                          │  │
│  │  └──────────────┘                                          │  │
│  │       ▲ scrapes                                            │  │
│  │  ┌────┴────────────┐                                       │  │
│  │  │    Grafana       │                                       │  │
│  │  │    :3000         │                                       │  │
│  │  └─────────────────┘                                       │  │
│  └────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

All services run as Docker containers on a **single EC2 instance** connected via a custom bridge network (`herwell_net`). Nginx is the only container exposed to the internet (port 80). Prometheus scrapes the backend's `/metrics` endpoint and Node Exporter directly over the internal network. Grafana visualises everything from Prometheus.

---

## Prerequisites

- An AWS account with permissions to create EC2, ECR, and IAM resources
- A domain or an EC2 public IP (for the initial setup)
- This repository cloned locally so you can configure GitHub Actions

---

## AWS Setup

### 1. Launch EC2 Instance

1. Open the EC2 console and click **Launch instance**.
2. **Name:** `herwell-prod`
3. **Application and OS Images:** Amazon Linux 2023 (free tier eligible)
4. **Instance type:** `t3.small` (t3.micro works for the app alone, but the monitoring stack adds memory pressure — t3.small gives comfortable headroom)
5. **Key pair:** Create or select an existing key pair (.pem) — you will SSH with this.
6. **Network settings:** Click **Edit** and create a security group with these rules:

| Type | Protocol | Port Range | Source | Purpose |
|------|----------|-----------|--------|---------|
| SSH | TCP | 22 | Your IP (e.g. `203.0.113.0/32`) | Admin access |
| HTTP | TCP | 80 | `0.0.0.0/0` | Web app traffic |
| Custom TCP | TCP | 3000 | Your IP only | Grafana (or skip & use SSH tunnel) |
| Custom TCP | TCP | 9090 | Your IP only | Prometheus (or skip & use SSH tunnel) |

7. **Configure storage:** 20 GB gp3 (enough for the app, monitoring data, and Docker images).
8. Click **Launch instance**.

> **Why Your IP only for 3000 and 9090?**
> Grafana and Prometheus have their own authentication, but exposing them broadly increases attack surface. The safer pattern is to leave these ports closed and use SSH port forwarding (explained below). During learning it's fine to open them to your IP, but get comfortable with the SSH tunnel approach.

### 2. Create ECR Repositories

1. Open the Amazon ECR console and click **Create repository**.
2. Create two private repositories:
   - `herwell-backend`
   - `herwell-frontend`
3. Note the **URI** of each repository (looks like `123456789012.dkr.ecr.us-east-1.amazonaws.com/herwell-backend`)

### 3. Create IAM User for GitHub Actions

1. Open the IAM console → **Users** → **Create user**.
2. **User name:** `github-actions-herwell`
3. Click **Next** → **Attach policies directly**.
4. Search for and attach **AmazonEC2ContainerRegistryFullAccess** (push/pull ECR images).
5. Click **Next** → **Create user**.
6. Open the user → **Security credentials** → **Create access key**.
7. Choose **Application running outside AWS** → **Next**.
8. Copy the **Access Key ID** and **Secret Access Key** — you'll add these to GitHub Secrets.

---

## EC2 Setup

SSH into your instance:

```bash
ssh -i /path/to/your-key.pem ec2-user@YOUR_EC2_PUBLIC_IP
```

### Install Docker & Docker Compose

Amazon Linux 2023 uses `dnf`:

```bash
# Update packages
sudo dnf update -y

# Install Docker
sudo dnf install -y docker

# Start Docker and enable on boot
sudo systemctl enable docker
sudo systemctl start docker

# Add ec2-user to the docker group (so you can run docker without sudo)
sudo usermod -aG docker ec2-user

# Log out and back in for the group change to take effect
exit

# SSH back in and verify
docker --version

# Install Docker Compose plugin
sudo dnf install -y docker-compose-plugin

# Verify
docker compose version
```

### Clone the repo and prepare .env

```bash
# Install git if not present
sudo dnf install -y git

# Clone (use HTTPS; deploy key auth is an alternative for stricter setups)
git clone https://github.com/GitHer-Muna/docker-cicd-grafana.git ~/herwell
cd ~/herwell

# Create .env from the example template
cp .env.example .env
nano .env
```

Fill in the `.env` file:
- `DB_PASSWORD` / `POSTGRES_PASSWORD`: A strong password (use `openssl rand -hex 32`)
- `JWT_SECRET`: `openssl rand -hex 64`
- `CORS_ORIGIN`: `http://YOUR_EC2_PUBLIC_IP`
- `VITE_API_URL`: `http://YOUR_EC2_PUBLIC_IP/api`
- `GF_SECURITY_ADMIN_PASSWORD`: A strong Grafana admin password

**Important:** You will need the application source code. This repo contains the infrastructure config only. Either:

**Option A** — Clone the HerWellness app into the same structure:
```bash
cd ~/herwell
# Copy HerWellness app code into backend/ and frontend/
# Or merge the repos: git clone https://github.com/GitHer-Muna/HerWellness.git tmp && cp -r tmp/* . && rm -rf tmp
```

**Option B** — The CD pipeline will pull the app from your HerWellness repo's main branch (see [GitHub Secrets](#github-secrets)).

### First deploy manually (before setting up CI/CD)

```bash
cd ~/herwell

# Log in to ECR (requires AWS CLI — install if needed)
aws ecr get-login-password --region YOUR_REGION | \
  docker login --username AWS --password-stdin YOUR_ACCOUNT_ID.dkr.ecr.YOUR_REGION.amazonaws.com

# Pull images (or build locally for a first run)
docker compose -f docker-compose.prod.yml up -d

# Check everything is running
docker compose -f docker-compose.prod.yml ps

# Watch the logs
docker compose -f docker-compose.prod.yml logs -f backend
```

---

## GitHub Secrets

Configure the following secrets in your GitHub repository (**Settings → Secrets and variables → Actions → Secrets**):

| Secret Name | Description |
|---|---|
| `AWS_ACCESS_KEY_ID` | IAM user access key for ECR push |
| `AWS_SECRET_ACCESS_KEY` | Corresponding secret key |
| `AWS_REGION` | e.g. `us-east-1` |
| `ECR_REGISTRY` | Full registry URL: `123456789012.dkr.ecr.us-east-1.amazonaws.com` |
| `ECR_BACKEND_REPO` | Backend repo name: `herwell-backend` |
| `ECR_FRONTEND_REPO` | Frontend repo name: `herwell-frontend` |
| `EC2_HOST` | Public IP or DNS of your EC2 instance |
| `EC2_USER` | `ec2-user` (Amazon Linux) |
| `EC2_SSH_KEY` | The full **private SSH key** (including line breaks) for the key pair |
| `VITE_API_URL` | **Variable** (not secret): `http://YOUR_EC2_PUBLIC_IP/api` — set this in **Variables** tab |

> **Note:** `VITE_API_URL` is stored as a **GitHub Actions variable** (not a secret) because it is needed at build time and visible in the frontend bundle anyway.

---

## Deploying

### First Deployment

Push to `main` — the CD workflow will:
1. Build and tag both images with `:latest` and `:<commit-sha>`
2. Push both to ECR
3. SSH into EC2, pull the repo, pull new images, and restart the stack
4. Run a smoke test against `/api/health`

If the workflow fails, check the Actions log. Common issues:
- SSH key format (the private key must be on a single line with `\n` in the secret, or pasted as a multiline secret).
- EC2 security group not allowing SSH from GitHub Actions IPs (they change; consider GitHub's `actions/runner` IP ranges).

### Watching a Deployment

1. Go to your GitHub repo → **Actions** tab.
2. Click the running workflow for the push to main.
3. Expand each step to see real-time output.
4. When it finishes, see the **Smoke test** step result.

---

## Accessing Services

### The Web App

Open `http://YOUR_EC2_PUBLIC_IP` in a browser. Nginx routes you to the React frontend. API calls are proxied to the backend.

### Grafana (via SSH Tunnel — Recommended)

Instead of opening port 3000 to the internet, use SSH port forwarding:

```bash
ssh -i /path/to/your-key.pem -L 3000:localhost:3000 ec2-user@YOUR_EC2_PUBLIC_IP
```

This forwards your **local** port 3000 to the EC2's **localhost** port 3000 (where Grafana is listening).

Then open `http://localhost:3000` in your browser. Log in with `admin` and the `GF_SECURITY_ADMIN_PASSWORD` you set in `.env`.

**Why this matters:** The SSH tunnel keeps Grafana completely inaccessible to anyone who doesn't already have SSH access to the EC2 instance. No open ports, no attack surface. Interviewers love this pattern because it shows you understand defence in depth, not just firewalls.

### Prometheus

Same pattern as Grafana:
```bash
ssh -i /path/to/your-key.pem -L 9090:localhost:9090 ec2-user@YOUR_EC2_PUBLIC_IP
```
Open `http://localhost:9090`.

Or open port 9090 in the security group if you prefer (less secure, simpler).

---

## Monitoring

### Built-in Grafana Dashboard

Once Grafana is accessible, you'll see the **HerWell — Application & Infrastructure** dashboard pre-loaded (provisioned via the `monitoring/grafana/` directory).

Panels available:

| Panel | Description |
|---|---|
| Total HTTP Requests | Cumulative request count (stat) |
| Request Rate by Route | Requests per second grouped by route |
| Error Rate (5xx) | Rate of server errors with yellow/red thresholds |
| p50 / p95 / p99 Latency | Request latency percentiles |
| Cycle Logs (24h) | Cycle tracking activity (created/updated/deleted) |
| Daily Symptom Logs (24h) | Symptom log submission count |
| DB Connection Pool Size | Active PostgreSQL pool connections (gauge) |
| Host CPU Usage % | EC2 CPU from Node Exporter |
| Host Memory Used % | EC2 RAM from Node Exporter |
| Host Disk Used % (Root) | Root filesystem utilisation |

### Custom Metrics

The backend exposes application-level metrics at `/metrics`:
- `http_requests_total` — Counter with labels `method`, `route`, `status_code`
- `http_request_duration_seconds` — Histogram with labels `method`, `route`
- `herwell_cycle_logs_total` — Counter with label `action` (created/updated/deleted)
- `herwell_daily_logs_total` — Counter
- `herwell_db_connection_pool_size` — Gauge

---

## Troubleshooting

### Container won't start

```bash
docker compose -f docker-compose.prod.yml logs SERVICE_NAME
```

Replace `SERVICE_NAME` with `backend`, `frontend`, `db`, `nginx`, etc.

### 502 Bad Gateway from Nginx

This usually means the upstream (backend or frontend) is not healthy:

```bash
# Check if backend container is running
curl http://localhost:3001/health

# Check inside the container directly
docker exec -it herwell-backend-1 wget -qO- http://localhost:3001/health
```

### Prometheus shows "target down"

```bash
# Check if the backend metrics endpoint works inside the container
docker exec -it herwell-backend-1 wget -qO- http://localhost:3001/metrics | head -20

# Verify Docker network connectivity
docker exec -it herwell-prometheus-1 wget -qO- http://backend:3001/metrics | head -20
```

If the second command fails, the containers may not be on the same Docker network. Check:
```bash
docker inspect herwell-backend-1 | jq '.[].NetworkSettings.Networks'
docker inspect herwell-prometheus-1 | jq '.[].NetworkSettings.Networks'
```

### Grafana shows "No data"

1. Check the Prometheus datasource in Grafana: **Configuration → Data Sources → Prometheus → Test**
2. In the dashboard, check the query in any panel: **Edit** → the PromQL expression should match the metric names
3. Verify Prometheus is scraping: **Prometheus UI → Status → Targets** `http://localhost:9090/targets`

### Something else?

Check the full stack logs:
```bash
docker compose -f docker-compose.prod.yml logs --tail=100 -f
```

---
