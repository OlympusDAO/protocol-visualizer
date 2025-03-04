# Build stage
FROM node:18-alpine AS builder

# Install pnpm
RUN corepack enable && corepack prepare pnpm@9.5 --activate

# Set working directory
WORKDIR /app

# Copy root package.json and pnpm workspace files
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/indexer/package.json ./apps/indexer/

# Install dependencies
RUN pnpm install --frozen-lockfile

# Copy source code
COPY apps/indexer/ ./apps/indexer/

# Build the application
RUN pnpm --filter indexer build

# Production stage
FROM node:18-alpine AS runner

# Install pnpm
RUN corepack enable && corepack prepare pnpm@9.5 --activate

# Set working directory
WORKDIR /app

# Copy built assets and dependencies from builder
COPY --from=builder /app/apps/indexer/dist ./dist
COPY --from=builder /app/apps/indexer/package.json ./
COPY --from=builder /app/node_modules ./node_modules

# Set environment variables
ENV NODE_ENV=production

# Expose the port the app runs on
EXPOSE 3000

# Start the application
CMD ["pnpm run start"]
