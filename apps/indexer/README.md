# Indexer

This package contains the Olympus protocol visualizer indexer. The runtime is
Envio HyperIndex.

## What It Indexes

The indexer tracks Olympus Kernel, ROLES, and RolesAdmin events across the
enabled chains in `config.yaml`:

- Ethereum mainnet
- Optimism
- Arbitrum
- Base
- Berachain
- Sepolia

The handlers live in `src/EventHandlers.ts`. Contract-state lookups that happen
inside handlers use Envio `createEffect`, so Envio can cache, rate-limit, and
surface effect metrics for those reads.

## Prerequisites

- Node.js 24
- pnpm 11.13.0
- Docker Desktop, for the local Envio Postgres/Hasura stack
- RPC URLs for the enabled chains
- `ENVIO_API_TOKEN` is strongly recommended and required by the local Docker
  Compose stack. Without it, the wrapper can run RPC-only indexing, but cold
  backfills are slower and more likely to hit public RPC limits.

Install dependencies from the repository root:

```bash
pnpm install --frozen-lockfile
```

## Environment

Create `apps/indexer/.env` from `apps/indexer/.env.sample` and fill in the RPC
URLs and Etherscan API key:

```bash
cp apps/indexer/.env.sample apps/indexer/.env
```

Required variables in `.env.sample` are uncommented. Optional overrides are
commented.

Set one RPC URL for each enabled chain:

```bash
ENVIO_RPC_URL_1=
ENVIO_RPC_URL_10=
ENVIO_RPC_URL_42161=
ENVIO_RPC_URL_8453=
ENVIO_RPC_URL_80094=
ENVIO_RPC_URL_11155111=
```

Set the Etherscan API key used when contract metadata is not already
precomputed or present in local ABI/source-code files:

```bash
ETHERSCAN_API_KEY=
```

For production wrapper runs, also set the database and private Hasura metadata
endpoint:

```bash
PORT=9898
DATABASE_URL=
HASURA_GRAPHQL_ENDPOINT=
HASURA_GRAPHQL_ADMIN_SECRET=
```

`config.yaml` uses `ENVIO_RPC_MODE` for each RPC source. The startup wrapper
sets it automatically:

- `sync` when `ENVIO_API_TOKEN` is absent, for RPC-only indexing
- `fallback` when `ENVIO_API_TOKEN` is present, for HyperSync with RPC fallback

You can explicitly set `ENVIO_RPC_MODE=sync` or `fallback` to override that
derived default. Any other value fails at startup.

Local Docker Compose intentionally requires `ENVIO_API_TOKEN` so the default
path is HyperSync with RPC fallback. Set `ENVIO_RPC_MODE=sync` only when you are
deliberately testing RPC-only ingestion.

Effect-handler RPC reads also support `ENVIO_RPC_URL_FALLBACK_<chainId>`.

Arbitrum is enabled in `config.yaml`, so `ENVIO_RPC_URL_42161` is required with
the other enabled-chain RPC URLs.

For Railway or any externally managed Postgres database, set `DATABASE_URL`.
`scripts/start-envio.mjs` maps it to Envio's `ENVIO_PG_*` variables at startup.
Do not set `ENVIO_PG_SCHEMA` on Railway. Railway starts use `envio start -r`,
and public blue/green handover is handled by the snapshot publisher manifest
rather than deployment-scoped database schemas.

## Code Generation

Run codegen after changing `config.yaml`, `schema.graphql`, ABIs, or generated
Envio types:

```bash
pnpm --filter indexer run codegen
```

Envio rewrites `envio-env.d.ts`; that generated file is ignored by the repo
ESLint config.

## Contract Metadata

After adding named contracts to `src/ContractNames.ts`, refresh generated
function-role metadata without reindexing:

```bash
pnpm run indexer:metadata
```

The generator reads the repository root `.env` and `apps/indexer/.env`, requires
`ETHERSCAN_API_KEY`, fetches metadata for named contracts that are missing from
`src/generated/contract-metadata.json`, and writes the merged generated file.
It skips addresses that already have generated metadata unless `--force` is
passed.

Etherscan HTTP `429`, server errors, network failures, and Etherscan rate-limit
responses are retried with bounded backoff. Tune this with
`ETHERSCAN_MAX_RETRIES`, `ETHERSCAN_RETRY_BASE_DELAY_MS`,
`ETHERSCAN_RATE_LIMIT_DELAY_MS`, and `ETHERSCAN_MIN_REQUEST_INTERVAL_MS` when
needed.

## Local Development

The indexer Docker build installs dependencies on Debian slim/glibc and runs on
distroless Node.js. Envio's Hypersync native dependency publishes
`linux-arm64-gnu`, but not `linux-arm64-musl`, so Alpine ARM builds cannot load
the required binding.

For the quickest local loop, run Envio's built-in local stack and a host
indexer process from the repository root:

```bash
pnpm run indexer:dev
```

This loads `apps/indexer/.env`, derives `ENVIO_RPC_MODE=fallback` when
`ENVIO_API_TOKEN` is set, starts the indexer process outside Docker, and lets
Envio manage its local Postgres and Hasura support containers.

The wrapper also reads the repository root `.env`, so the same file used by
Docker Compose can provide `ETHERSCAN_API_KEY`, `ENVIO_API_TOKEN`, and RPC URLs
for host indexer runs.

For a cold local run that resets Envio's local database state:

```bash
pnpm run indexer:dev:reset
```

This starts `envio dev -r`, which clears the local Envio database and reindexes
from scratch. Avoid it when you want to keep local progress between runs.

Stop the dev process with `Ctrl-C`. Envio's Docker services may remain running;
that is normal for repeated local testing.

To check progress from another terminal:

```bash
pnpm run indexer:metrics
```

## Checking Progress

During a local run, use the Envio metrics endpoint to confirm each chain is
advancing and whether effect handlers are running:

```bash
curl -s http://localhost:9898/metrics | rg 'envio_progress_|hyperindex_synced_to_head|envio_effect_'
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

1. Ensure `apps/indexer/.env` has the intended RPC URLs.
2. Run a reset local indexer:

   ```bash
   cd apps/indexer
   ENVIO_TUI=false pnpm exec envio dev -r
   ```

3. Record elapsed time and per-chain `envio_progress_block` values from the
   metrics endpoint.

During the migration, a cold Envio run using HyperSync reached head for all
enabled chains in about one minute, versus the earlier Ponder baseline that was
still partially backfilling after five minutes.

After switching the config to RPC-only (`ENVIO_RPC_MODE=sync`) and running with
`ENVIO_API_TOKEN` empty, a cold local run reached head in about eight minutes.
That is slower than HyperSync but still completed well inside the prior Railway
timeout risk. The RPC-only run emitted Alchemy compute-unit `429` backoffs on
Base, Optimism, and especially Berachain, so RPC quota is the main constraint to
watch when self-hosting.

## Production Runtime

Railway self-hosting architecture and service variables are documented in
`../../docs/railway-self-hosting.md`.

The Docker image starts:

```bash
node scripts/start-envio.mjs
```

That wrapper exists so the same image can run locally or on Railway with
Railway-style environment variables. It maps:

- `DATABASE_URL` to `ENVIO_PG_HOST`, `ENVIO_PG_PORT`, `ENVIO_PG_USER`,
  `ENVIO_PG_PASSWORD`, and `ENVIO_PG_DATABASE`
- missing Envio production defaults required by `NODE_ENV=production`:
  `ENVIO_PG_SSL_MODE=prefer`, `HASURA_GRAPHQL_ROLE=admin`,
  `ENVIO_THROTTLE_CHAIN_METADATA_INTERVAL_MILLIS=500`, and
  `ENVIO_THROTTLE_PRUNE_STALE_DATA_INTERVAL_MILLIS=30000`
- `HASURA_GRAPHQL_ENDPOINT` readiness before production `envio start`, when
  both it and `HASURA_GRAPHQL_ADMIN_SECRET` are set. This avoids a Railway
  startup race where Envio can attempt table tracking before Hasura is accepting
  metadata requests. Local `envio dev` skips this wait because Envio owns the
  local stack lifecycle.
- production readiness on `PORT`, when `PORT` is set. The wrapper moves Envio to
  an internal port, proxies normal requests through, returns `200` from
  `/healthz` for process-level Railway health, and keeps `/ready` data-aware for
  manual checks.
- Railway deployments must set `PORT=9898` so sibling services can reach the
  proxied metrics endpoint at `http://indexer.railway.internal:9898/metrics`.
  Keep `snapshot-publisher.INDEXER_METRICS_URL` and
  `snapshot-monitor.INDEXER_METRICS_URL` aligned with this value.
- `PORT` to `ENVIO_INDEXER_PORT`, when no indexer port is explicitly set and the
  healthcheck wrapper is disabled or not used

Set `ENVIO_HASURA_STARTUP_TIMEOUT_MS` to change the Hasura readiness wait from
the default 180 seconds.

Set `ENVIO_HEALTHCHECK_WRAPPER_ENABLED=false` to disable the production
healthcheck wrapper. If you need to choose the internal Envio port explicitly,
set `ENVIO_INDEXER_INTERNAL_PORT`.

The runtime image removes package-manager binaries after install to reduce the
container scan surface.
