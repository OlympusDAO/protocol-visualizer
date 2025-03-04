# Build stage
FROM node:18-alpine AS builder

# Install pnpm
RUN corepack enable && corepack prepare pnpm@9.5 --activate

# Set working directory
WORKDIR /app

# Copy root package.json and pnpm workspace files
COPY pnpm-lock.yaml pnpm-workspace.yaml ./
COPY package.json .

# Install dependencies
RUN pnpm install --frozen-lockfile

# Copy source code
COPY . .

# Nothing to build

# Set environment variables
ENV NODE_ENV=production

# Expose the port the app runs on
EXPOSE 3000

# Start the application
CMD ["pnpm run start"]
