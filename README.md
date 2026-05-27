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
    per-chain JSON snapshots to a private Railway Bucket
- Snapshot gateway
  - A small public Go service that serves allowlisted JSON snapshot files from
    the private Railway Bucket with cache headers for Cloudflare
- Frontend
  - A static frontend that retrieves per-chain protocol snapshots and renders
    them in a diagram

Shared public chain configuration lives in
`packages/protocol-config/protocol-chains.json`. The frontend, snapshot
publisher, and snapshot gateway all read that file so supported chain IDs,
names, and explorer URLs do not drift.

## Deployment

The indexer is designed to be self-hosted with Postgres and Hasura. The default
indexer config is RPC-only and does not require `ENVIO_API_TOKEN`.

For local end-to-end testing, Docker Compose can run Postgres, Hasura, the
indexer, a local S3-compatible bucket, the snapshot gateway, and the frontend:

```bash
pnpm run stack:up
pnpm run stack:publish:sample
```

The full local stack guide is in `docs/local-stack.md`.

Railway self-hosting is documented in `docs/railway-self-hosting.md`. The
deployable Railway services are defined by `railway-indexer.json`,
`railway-hasura.json`, `railway-snapshot-publisher.json`,
`railway-snapshot-gateway.json`, and `railway-frontend.json`.

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

The frontend reads per-chain protocol snapshots from the public snapshot gateway.
Configure it at build time with:

```bash
VITE_PROTOCOL_SNAPSHOT_BASE_URL=http://localhost:8082
```
