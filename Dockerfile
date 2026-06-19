# ── Katra Server Dockerfile ────────────────────────────────────────
# Multi-stage build: compile TypeScript, then copy to slim runtime image.
# The result is a self-contained image — no bind mounts needed.

# ── Stage 1: Build ─────────────────────────────────────────────────
FROM node:20-alpine AS builder

RUN apk add --no-cache python3 make g++

WORKDIR /app

# Copy package files and install ALL deps (including devDeps for build)
COPY server/package*.json ./
RUN npm ci

# Copy source and build
COPY server/ ./
RUN node esbuild.config.mjs

# ── Stage 2: Runtime ───────────────────────────────────────────────
FROM node:20-alpine

RUN apk add --no-cache curl

WORKDIR /app

# Copy package files and install production deps only
COPY server/package*.json ./
RUN npm ci --production && npm cache clean --force

# Copy built artifacts from builder stage
COPY --from=builder /app/build ./build

# Expose ports: MCP (3100) + Admin API (9002)
EXPOSE 3100 9002

# Health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD curl -sf http://localhost:9002/api/v1/health || exit 1

CMD ["node", "build/index.js"]
