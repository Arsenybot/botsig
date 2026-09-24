# Multi-stage production-ready Dockerfile for Node.js + TypeScript (Telegram Bot + Dashboard)
FROM node:20-alpine AS builder

WORKDIR /app

# Install dependencies needed for build
COPY package*.json ./
COPY tsconfig*.json ./
RUN npm install

# Copy source code and build config
COPY index.html ./
COPY vite.config.ts ./
COPY server.ts ./
COPY server ./server
COPY src ./src

# Build frontend (Vite) and server (esbuild bundle -> dist/server.cjs)
RUN npm run build

# --- Production Runner Stage ---
FROM node:20-alpine AS runner

WORKDIR /app

# Default environment variables
ENV NODE_ENV=production
ENV PORT=3000

# Install production dependencies only
COPY package*.json ./
RUN npm install --omit=dev && npm cache clean --force

# Copy compiled bundles from builder stage
COPY --from=builder /app/dist ./dist

# Create persistent data directory
RUN mkdir -p /app/data

# Expose port (Cloud.ru Container Apps or Webhook)
EXPOSE 3000

# Healthcheck
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://127.0.0.1:${PORT}/api/health || exit 1

# Start server (runs node dist/server.cjs which starts Telegram Bot, Monitor & Dashboard)
CMD ["node", "dist/server.cjs"]
