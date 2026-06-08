# ── Stage 1: build ───────────────────────────────────────────────────────────
FROM node:20-slim AS builder

# Install pnpm
RUN corepack enable && corepack prepare pnpm@latest --activate

WORKDIR /app

# Copy all three repos into a single build context.
# The sabha workspace references ../argus and ../narada via pnpm-workspace.yaml.
COPY sabha/ ./sabha/
COPY argus/  ./argus/
COPY narada/ ./narada/

# Install all workspace dependencies
WORKDIR /app/sabha
RUN pnpm install --frozen-lockfile

# Build all packages (argus core + mcp, narada core + mcp, sabha core + telemetry + mcp-server)
RUN pnpm -r build

# ── Stage 2: runtime ─────────────────────────────────────────────────────────
FROM node:20-slim AS runtime

RUN corepack enable && corepack prepare pnpm@latest --activate

WORKDIR /app

# Copy built artifacts + node_modules
COPY --from=builder /app/sabha/ ./sabha/
COPY --from=builder /app/argus/  ./argus/
COPY --from=builder /app/narada/ ./narada/

WORKDIR /app/sabha

# Expose the HTTP port Railway will forward to
EXPOSE 3000

# Server data directory (per-user config/registry on the server)
ENV SABHA_DATA_ROOT=/var/sabha-data
RUN mkdir -p /var/sabha-data

CMD ["node", "packages/mcp-server/dist/index.js"]
