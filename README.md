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
deployable Railway services and storage are defined in
[`.railway/railway.ts`](.railway/railway.ts). The Railway infrastructure workflow
plans changes on PR updates and applies the reviewed production plan on merge.
See [the Railway setup guide](docs/railway-self-hosting.md) for bootstrap and
secrets.

The frontend is a static build that points at the public snapshot gateway. The
publisher talks to Hasura over Railway private networking and writes snapshots
to a private Railway Bucket.

## Validation

With the repository-pinned Node and pnpm versions active, run the nine required agent validation steps:

```bash
./scripts/validate.sh
```

The script runs from the repository root, prints each step, and stops at the first failure with its exit code.

Run full local validation (including container builds):

```bash
pnpm run validate:local
```

The `container:build:*`, `container:tag:scan:*`, and `stack:*` commands use Docker
when installed, otherwise Podman. Set `CONTAINER_ENGINE=podman` or
`CONTAINER_ENGINE=docker` to choose explicitly, including for `pnpm validate`.
Failures from the selected engine stop the command. Podman stack commands
require a Compose provider installed on the host.

Run checks individually:

```bash
pnpm run check:runtime-versions
pnpm install --frozen-lockfile
pnpm run lint:check
pnpm run build
pnpm run snapshots:generate:local
pnpm run container:build:indexer
pnpm run container:build:frontend
pnpm run container:build:hasura
pnpm run container:build:snapshot-gateway
pnpm run container:build:snapshot-publisher
pnpm run container:build:snapshot-monitor
```

## Indexer

Indexer setup, local Envio testing, metrics, and Docker runtime notes are
documented in `apps/indexer/README.md`.
For new contracts and getter links, use the
[contract metadata update procedure](apps/indexer/README.md#contract-metadata).

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
