# Build stage
FROM node:18-alpine AS builder

# Install pnpm
RUN corepack enable && corepack prepare pnpm@9.5 --activate

# Set working directory
WORKDIR /app

# Copy pnpm files
COPY pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/frontend/package.json ./apps/frontend/
COPY apps/indexer/package.json ./apps/indexer/

# Install dependencies
RUN pnpm install --frozen-lockfile

# Copy source code
# Indexer needed due to the ponder schema
COPY apps/indexer/ ./apps/indexer/
COPY apps/frontend/ ./apps/frontend/

WORKDIR /app/apps/frontend

# Environment variables
ARG VITE_PONDER_URL
ENV VITE_PONDER_URL=$VITE_PONDER_URL

# Build the application
RUN pnpm run build

# Production stage
FROM caddy:alpine

# Copy the built static files to Caddy's serve directory
COPY --from=builder /app/apps/frontend/dist /srv/

# Copy the Caddyfile
COPY --from=builder /app/apps/frontend/Caddyfile /etc/caddy/Caddyfile

# Add environment variables to Caddy
ENV VITE_PONDER_URL=$VITE_PONDER_URL
