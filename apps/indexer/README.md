# Indexer

This package contains the Olympus protocol visualizer indexer. The primary
runtime is Envio HyperIndex. The old Ponder scripts and config are still present
for comparison while the migration is being validated, but new local testing and
deployments should use Envio.

## What It Indexes

The indexer tracks Olympus Kernel, ROLES, and RolesAdmin events across the
enabled chains in `config.yaml`:

- Ethereum mainnet
- Optimism
- Base
- Berachain
- Sepolia

The handlers live in `src/EventHandlers.ts`. Contract-state lookups that happen
inside handlers use Envio `createEffect`, so Envio can cache, rate-limit, and
surface effect metrics for those reads.

## Prerequisites

- Node.js 24
- pnpm 10.33.0
- Docker Desktop, for the local Envio Postgres/Hasura stack
- RPC URLs for the enabled chains
- `ENVIO_API_TOKEN`, required for Envio HyperSync on supported chains

Install dependencies from the repository root:

```bash
pnpm install --frozen-lockfile
```

## Environment

Create `apps/indexer/.env` from `apps/indexer/.env.sample` and fill in the RPC
URLs and Envio token:

```bash
cp apps/indexer/.env.sample apps/indexer/.env
```

The chain RPC variables intentionally keep the existing Ponder names because
they are already used by deployment configuration:

```bash
PONDER_RPC_URL_1=
PONDER_RPC_URL_10=
PONDER_RPC_URL_8453=
PONDER_RPC_URL_80094=
PONDER_RPC_URL_11155111=
ENVIO_API_TOKEN=
```

`PONDER_RPC_URL_42161` is still present in the sample for Arbitrum, but Arbitrum
is not currently enabled in `config.yaml`.

For Railway or any externally managed Postgres database, set `DATABASE_URL`.
`scripts/start-envio.mjs` maps it to Envio's `ENVIO_PG_*` variables at startup.
If `RAILWAY_DEPLOYMENT_ID` is present and `ENVIO_PG_SCHEMA` is not set, the
script also derives a schema name from the deployment id so preview deployments
do not share one schema.

## Code Generation

Run codegen after changing `config.yaml`, `schema.graphql`, ABIs, or generated
Envio types:

```bash
pnpm --filter indexer run codegen
```

Envio rewrites `envio-env.d.ts`; that generated file is ignored by the repo
ESLint config.

## Local Development

Start the local Envio stack and indexer from `apps/indexer`:

```bash
cd apps/indexer
ENVIO_TUI=false pnpm exec envio dev
```

For a cold local run that resets Envio's local database state:

```bash
cd apps/indexer
ENVIO_TUI=false pnpm exec envio dev -r
```

Use `-r` for benchmarking or debugging startup behavior. Avoid it when you want
to keep local progress between runs.

Stop the dev process with `Ctrl-C`. Envio's Docker services may remain running;
that is normal for repeated local testing.

## Checking Progress

During a local run, use the Envio metrics endpoint to confirm each chain is
advancing and whether effect handlers are running:

```bash
curl -s http://localhost:8080/metrics | rg 'envio_progress_|hyperindex_synced_to_head|envio_effect_'
```

Useful metrics include:

- `envio_progress_block{chainId="..."}`: latest indexed block per chain
- `envio_progress_ready{chainId="..."}`: whether a chain has reached ready state
- `hyperindex_synced_to_head`: whether the indexer is synced
- `envio_effect_call_total{effect="..."}`: effect handler call counts
- `envio_effect_cache{effect="..."}`: effect cache entries
- `envio_effect_queue{effect="..."}`: queued effect calls

If an effect does not appear in the metrics, it may simply mean that the current
event sequence did not require that contract-state fallback path.

## Local Validation

Fast validation for indexer-only changes:

```bash
pnpm --filter indexer run codegen
pnpm --filter indexer run typecheck
pnpm --filter indexer run lint:check
```

Validate the production indexer image from the repository root:

```bash
pnpm run docker:build:indexer
```

Full repository validation is defined at the repository root:

```bash
pnpm run validate:local
```

## Benchmarking Startup

For a simple cold-start benchmark:

1. Ensure `apps/indexer/.env` has the intended RPC URLs and `ENVIO_API_TOKEN`.
2. Run a reset local indexer:

   ```bash
   cd apps/indexer
   ENVIO_TUI=false pnpm exec envio dev -r
   ```

3. Record elapsed time and per-chain `envio_progress_block` values from the
   metrics endpoint.

The last local cold Envio run during the migration reached head for all enabled
chains in about one minute, versus the earlier Ponder baseline that was still
partially backfilling after five minutes. Treat that as a migration validation
signal, not a permanent SLA; RPC provider behavior and HyperSync availability
can change over time.

## Production Runtime

The Docker image starts:

```bash
node scripts/start-envio.mjs
```

That wrapper exists so the same image can run locally or on Railway with
Railway-style environment variables. It maps:

- `DATABASE_URL` to `ENVIO_PG_HOST`, `ENVIO_PG_PORT`, `ENVIO_PG_USER`,
  `ENVIO_PG_PASSWORD`, and `ENVIO_PG_DATABASE`
- `RAILWAY_DEPLOYMENT_ID` to `ENVIO_PG_SCHEMA`, when no schema is explicitly set
- `PORT` to `ENVIO_INDEXER_PORT`, when no indexer port is explicitly set

The runtime image removes package-manager binaries after install to reduce the
container scan surface.

## Legacy Ponder Path

The following scripts are retained for fallback comparison only:

```bash
pnpm --filter indexer run ponder:dev
pnpm --filter indexer run ponder:start
pnpm --filter indexer run ponder:codegen
```

Do not use these for the Envio migration benchmark or Railway deployment path.
