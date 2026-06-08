# Protocol Visualizer

This repository contains the source code for a visualizer of the Olympus protocol.

To be specific, it visualizes the following:

- Modules
- Kernel
- Policies
- Roles
- Role Assignments
- Role Assignees

## Components

The project is made up of these components:

- Indexer
  - This uses Envio HyperIndex to index blockchain events
- Snapshot publisher
  - A short-lived Railway cron job that reads private Hasura data and writes
    deployment-scoped per-chain JSON snapshots to a private Railway Bucket
- Snapshot gateway
  - A small public Node REST API that reads the active bucket manifest and serves
    cacheable snapshot responses
- Snapshot monitor
  - A short-lived Railway cron job that reports indexing progress and handovers
    to Discord
- Frontend
  - A static frontend that retrieves per-chain protocol snapshots and renders
    them in a diagram

Shared public chain configuration lives in
`packages/protocol-config/protocol-chains.json`. The frontend, snapshot
publisher, and snapshot gateway all read that file so supported chain IDs,
names, and explorer URLs do not drift.

## Deployment

The indexer is designed to be self-hosted with Postgres and Hasura. Railway and
Docker Compose deployments require chain RPC URLs, `ETHERSCAN_API_KEY`, and
`ENVIO_API_TOKEN` so production and local backfills use Envio HyperSync with RPC
fallback instead of slow RPC-only indexing.

For local end-to-end testing, Docker Compose can run Postgres, Hasura, the
indexer, a local S3-compatible bucket, the snapshot gateway, and the frontend:

```bash
pnpm run stack:up
pnpm run stack:publish:sample
```

The full local stack guide is in `docs/local-stack.md`.

Railway self-hosting is documented in `docs/railway-self-hosting.md`. The
deployable Railway services, bucket, Postgres service, cron schedules,
healthchecks, restart policies, watch patterns, and variable references are
defined in `.railway/railway.ts`.

The frontend is a static build that points at the public snapshot gateway. The
publisher talks to Hasura over Railway private networking and writes snapshots
to a private Railway Bucket.

## Validation

Run full local validation (including Docker builds):

```bash
pnpm run validate:local
```

Run checks individually:

```bash
pnpm run check:runtime-versions
pnpm install --frozen-lockfile
pnpm run lint:check
pnpm run build
pnpm run snapshots:generate:local
pnpm run docker:build:indexer
pnpm run docker:build:frontend
pnpm run docker:build:hasura
pnpm run docker:build:snapshot-gateway
pnpm run docker:build:snapshot-publisher
pnpm run docker:build:snapshot-monitor
```

## Indexer

Indexer setup, local Envio testing, metrics, and Docker runtime notes are
documented in `apps/indexer/README.md`.

Quick local indexer commands:

```bash
pnpm run indexer:dev
pnpm run indexer:dev:reset
pnpm run indexer:metrics
```

## Frontend

The frontend reads per-chain protocol snapshots from the public REST snapshot
gateway.
Configure it at build time with:

```bash
VITE_PROTOCOL_SNAPSHOT_BASE_URL=http://localhost:8082
```
