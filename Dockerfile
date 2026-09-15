# ==============================================================================
# STAGE 1: Builder Stage
# ==============================================================================
FROM node:22-alpine AS builder

WORKDIR /app

# Install build dependencies for native sqlite3 bindings if needed
RUN apk add --no-cache python3 make g++

# Copy package descriptors
COPY package*.json tsconfig.json ./

# Install dependencies (including devDependencies for TypeScript compiler)
RUN npm ci

# Copy application source and seed fixtures
COPY src/ ./src/
COPY seeds/ ./seeds/

# Build TypeScript to dist/
RUN npm run build

# Prune devDependencies to keep runtime lightweight
RUN npm prune --production

# ==============================================================================
# STAGE 2: Runtime Stage (Minimal & Non-Root)
# ==============================================================================
FROM node:22-alpine AS runner

WORKDIR /app

# Set non-root execution environment
ENV NODE_ENV=pilot \
    PORT=4000 \
    HOST=0.0.0.0 \
    DATABASE_PATH=/app/data/impersonation_desk.db \
    EVIDENCE_STORAGE_DIR=/app/storage/evidence \
    EVIDENCE_TEMP_DIR=/app/storage/temp \
    BACKUP_STORAGE_DIR=/app/storage/backups \
    PILOT_MODE=true \
    ENABLE_LIVE_PLATFORM_ACTIONS=false \
    ENABLE_LIVE_BILLING=false \
    ENABLE_LIVE_NOTIFICATIONS=false

# Create data and storage directories with proper ownership
RUN mkdir -p /app/data /app/storage/evidence /app/storage/temp /app/storage/backups /app/storage/notifications && \
    chown -R node:node /app

# Copy production node_modules from builder
COPY --chown=node:node --from=builder /app/node_modules ./node_modules
COPY --chown=node:node --from=builder /app/package*.json ./
COPY --chown=node:node --from=builder /app/dist ./dist
COPY --chown=node:node --from=builder /app/seeds ./seeds
COPY --chown=node:node src/client ./src/client
COPY --chown=node:node src/db/migrations ./src/db/migrations

# Switch to standard non-root node user
USER node

# Health check against readiness endpoint
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://127.0.0.1:4000/health/readiness || exit 1

EXPOSE 4000

# Run entrypoint
CMD ["node", "dist/src/server.js"]
