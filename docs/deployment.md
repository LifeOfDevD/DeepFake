# Deployment & Containerization Guide

## 1. Overview

The **Digital Impersonation Response Desk** is packaged as a lightweight, containerized service designed to run on standard Linux/Docker infrastructure or container orchestrators (Kubernetes, AWS ECS, Google Cloud Run).

The architecture follows the **Single-Process Modular Monolith** pattern: Express.js HTTP API, client UI assets, background workers, and SQLite embedded database run within a single isolated container instance with zero external service dependencies required for controlled pilot operations.

---

## 2. Docker Architecture

### 2.1 Multi-Stage Dockerfile Highlights

- **Stage 1 (Builder)**: `node:22-alpine` compiles TypeScript source (`npm run build`), bundles assets, and prunes development dependencies.
- **Stage 2 (Runner)**: Minimal alpine image containing only production `node_modules`, compiled `dist/`, migrations, client static assets, and seed fixtures.
- **Non-Root Execution**: Runs as standard unprivileged `node` user (`UID:GID 1000:1000`).
- **Health Checks**: Uses lightweight Alpine `wget` probe against `/health/readiness`.

```dockerfile
# Build the Docker image locally
docker build -t impersonation-response-desk:pilot .
```

### 2.2 Docker Compose Quickstart

The repository includes a ready-to-deploy `docker-compose.yml` configured for controlled pilot operations:

```bash
# Launch the controlled pilot stack
docker compose up -d

# View container logs
docker compose logs -f

# Inspect container health
docker compose ps
```

The service will be accessible on host port `4000` at `http://localhost:4000`.

---

## 3. Storage & Volume Mounts

The service requires two persistent volume mounts:

| Volume Name | Container Path | Purpose |
| :--- | :--- | :--- |
| `response_desk_data` | `/app/data` | SQLite database file (`impersonation_desk.db`), WAL log (`-wal`), and shared memory (`-shm`). |
| `response_desk_storage` | `/app/storage` | Evidence lockers (`/evidence`), temp uploads (`/temp`), and backup snapshots (`/backups`). |

> [!CAUTION]
> **Data Persistence Rule**: Never run without mounting `/app/data` and `/app/storage`. SQLite writes using Write-Ahead Logging (WAL); container destruction without volume persistence will result in unrecoverable evidence loss.

---

## 4. Environment Variables Reference

| Variable | Default (Pilot) | Required in Prod | Description |
| :--- | :--- | :--- | :--- |
| `NODE_ENV` | `pilot` | Yes (`production`) | Runtime mode (`development`, `test`, `pilot`, `production`). |
| `PORT` | `4000` | No | HTTP listener port. |
| `HOST` | `0.0.0.0` | No | Bind address (use `127.0.0.1` behind reverse proxy). |
| `APP_URL` | `http://localhost:4000` | Yes | Canonical base URL for invitations and links. |
| `DATABASE_PATH` | `/app/data/impersonation_desk.db` | Yes | Path to SQLite database file. |
| `EVIDENCE_STORAGE_DIR` | `/app/storage/evidence` | No | Root directory for quarantined evidence files. |
| `BACKUP_STORAGE_DIR` | `/app/storage/backups` | No | Root directory for atomic backup archives. |
| `SESSION_SECRET` | *(Random 32-char)* | Yes | HMAC signing key for user authentication tokens. |
| `DOWNLOAD_TOKEN_SECRET` | *(Random 32-char)* | Yes | HMAC signing key for evidence download tokens. |
| `PILOT_MODE` | `true` | Yes | Enforces controlled pilot safety guarantees. |
| `ENABLE_LIVE_PLATFORM_ACTIONS` | `false` | **MUST BE FALSE** | Safety gate. Refuses startup if set to `true`. |
| `ENABLE_LIVE_BILLING` | `false` | **MUST BE FALSE** | Safety gate. Refuses startup if set to `true`. |
| `ENABLE_LIVE_NOTIFICATIONS` | `false` | **MUST BE FALSE** | Safety gate. Refuses startup if set to `true`. |
| `NOTIFICATION_MODE` | `in_app` | No | Delivery adapter (`in_app`, `console`, `file`). |
| `BILLING_MODE` | `dry_run` | No | Billing provider mode (`dry_run`, `disabled`). |

---

## 5. Health & Monitoring Endpoints

The service provides three standard health endpoints:

### `GET /health/liveness`
- Basic process liveness probe.
- Returns `HTTP 200 { status: "healthy", uptime: number, timestamp: string }`.

### `GET /health/readiness`
- Comprehensive readiness probe used by Docker and Kubernetes.
- Verifies:
  - Database connectivity and writeability.
  - Storage directory availability.
  - Pilot safety guarantees (`liveDispatchesDisabled: true`, `liveBillingDisabled: true`).
- Returns `HTTP 200` if all dependencies are ready, `HTTP 503` if degraded.

### `GET /health/metrics`
- System metrics and worker heartbeat inspection.
- Provides process memory consumption, active case counts, and background worker execution states.

---

## 6. Reverse Proxy & TLS Hardening

In controlled pilot deployments with institutional partners, place the container behind an enterprise reverse proxy (Nginx, Caddy, Cloudflare, or AWS ALB) enforcing:

1. **TLS 1.3 Termination**: All HTTP traffic must be redirected to HTTPS.
2. **Security Headers**:
   - `Strict-Transport-Security: max-age=63072000; includeSubDomains; preload`
   - `X-Content-Type-Options: nosniff`
   - `X-Frame-Options: DENY`
   - `Content-Security-Policy: default-src 'self'; script-src 'self' https://cdn.tailwindcss.com; style-src 'self' 'unsafe-inline' https://cdnjs.cloudflare.com;`
3. **Upload Size Limit**: Set `client_max_body_size 50M;` matching `MAX_UPLOAD_SIZE_MB`.
