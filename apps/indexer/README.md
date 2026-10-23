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

- Node.js 24.22.1 or newer (24.x)
- pnpm 11.28.7
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
ENVIO_RPC_URL_421614=<arbitrum sepolia archive RPC>
ENVIO_RPC_URL_84532=<base sepolia archive RPC>
ENVIO_RPC_URL_4663=
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

Control-state getter reads require archive state at the requested block.
The effect input includes the chain, address, block number, block hash, and getter.
The getter call uses the block hash and requires a canonical block (EIP-1898).
The reader also checks the canonical hash before and after each read.
An unavailable historical read returns an unavailable result; it never reads latest state.
Providers that do not support hash-bound calls leave the read unavailable.
Failed verification preserves the indexed value and its provenance.

Control-state seeds describe the end of a completed block.
Only events from later blocks can replay over that seed.
Control-event registrations must select `block: ["hash", "timestamp"]` and `transaction: ["hash"]` in their `fields`.
The block-completion handler records indexing progress after all events in that block.
Seed provenance, transition provenance, indexing progress, and snapshot publication time remain separate.

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

Run the commands in this section from the repository root.
The generator reads `.env` and `apps/indexer/.env`.
Etherscan requests require `ETHERSCAN_API_KEY`.

### Add a contract

1. Verify the chain, deployed address, contract name, and creation block against deployment receipts and verified source.
2. Add the contract to the appropriate inventory:

   | Contract | File | Fields |
   | --- | --- | --- |
   | Kernel, module, or policy | `apps/indexer/src/ContractNames.ts` | Chain, address, `name`, `type`, verified `startBlock`, and available `version` |
   | Periphery or external contract | `packages/protocol-config/other-contracts.json` | `chainId`, lowercase `address`, `name`, and verified `startBlock` for tracked state |
   | Name for a referenced address only | `packages/protocol-config/other-contracts.json` | `chainId`, lowercase `address`, `name`, and `labelOnly: true` |

   A label-only entry does not create a standalone snapshot contract.
   A reference can still introduce that address into the graph.
   An inventory entry does not establish ownership, enablement, or Kernel membership.

3. For new chains, update the shared chain catalog, indexer constants, RPC variables, and `config.yaml`.
4. For existing event families, register the address and verified start block under the matching chain in `apps/indexer/config.yaml`.
5. For new event families, add the ABI and handlers before registering their events.

Event registration is separate from getter discovery.
An inventory entry alone does not subscribe to ownership, IEnabler, or reference-change events.
Source inspection must establish the getter spelling, event signature, and constructor behavior.
The relationship definitions are in `apps/indexer/src/events/ownership-contracts.ts`.
IEnabler capabilities are in `apps/indexer/src/events/enabler-contracts.ts`.
Both use generated metadata, with explicit handling for known contract families.

### Refresh getter links

Refresh verified getter metadata for registered contracts:

```bash
pnpm run indexer:metadata -- --refresh-getters
```

This mode reads `ContractNames.ts` and non-label-only entries in `other-contracts.json`.
For new policies, first run `pnpm run indexer:metadata` to extract function-role metadata through Etherscan.
Getter refresh preserves existing role mappings but does not extract role modifiers from source.
It upgrades older getter metadata through Sourcify without an Etherscan key.
It preserves existing role mappings and skips records that already contain verified getter metadata.
Unavailable verification retains the previous record and reports its chain and address.
This command does not start the indexer or publish snapshots.

To restrict the refresh, add `--chain-id CHAIN_ID` and optionally `--address ADDRESS`.
To recheck already verified records, add `--force` to this mode.
The manual verified-source import remains available for saved responses.

### Extract function metadata

For named contracts in `ContractNames.ts`, fetch missing metadata:

```bash
pnpm run indexer:metadata
```

The generator writes `apps/indexer/src/generated/contract-metadata.json`.
It skips existing nonempty entries.
The Etherscan scan does not enumerate `other-contracts.json`.
For inventory-only contracts, use `--refresh-getters` or a manual verified-source import.

**CAUTION:** `--force` replaces each selected metadata entry.
It can remove imported source verification and documentation, which disables generic getter links for that entry.
After an Etherscan refresh, run `--refresh-getters` before restarting the indexer.
Avoid a repository-wide `--force` refresh unless you can restore every affected verification record.

To refresh an existing named contract, restrict the request to its chain and address.
Replace `CHAIN_ID` and `ADDRESS` with the deployed identity:

```bash
pnpm run indexer:metadata -- --chain-id CHAIN_ID --address ADDRESS --force
```

For untyped entries in `ContractNames.ts`, add `--include-unknown-type`.

Etherscan HTTP `429`, server errors, network errors, and rate-limit responses use bounded retries.
The retry controls are `ETHERSCAN_MAX_RETRIES`, `ETHERSCAN_RETRY_BASE_DELAY_MS`,
`ETHERSCAN_RATE_LIMIT_DELAY_MS`, and `ETHERSCAN_MIN_REQUEST_INTERVAL_MS`.

### Discover address getters

The metadata processor extracts functions with all three properties:

- `view` or `pure` mutability.
- No arguments.
- Exactly one `address` return value, including contract-typed public getters.

Argument-taking getters, tuples, multiple returns, and state-changing functions require explicit support.
Known token-scoped registry getters already have that support.

1. Obtain the Sourcify v2 verification response for the deployed chain and address.
2. Save the response as `/tmp/compiler-record.json`.
3. Verify that the response includes `chainId`, `address`, `runtimeMatch`, `runtimeBytecode.onchainBytecode`, and `metadata.output.abi`.
4. If available, include `metadata.output.userdoc` and `metadata.output.devdoc` for NatSpec context.
5. Import the response:

   ```bash
   pnpm run indexer:metadata -- --chain-id CHAIN_ID --address ADDRESS --verified-source /tmp/compiler-record.json
   ```

The importer accepts `runtimeMatch` values `match` and `exact_match`.
It checks the chain and address, computes the deployed code hash, and preserves existing selector-based role mappings.
Local compiler artifacts alone do not qualify as deployed-source verification.
An unverified Etherscan ABI can identify getter candidates but cannot activate generic links.

Generic getters need no individual entry in the relationship definitions after this import.
At completed blocks, the indexer compares the recorded runtime code hash with deployed code before reading each getter.
NatSpec appears only for an exact metadata match and the matching deployed code hash.
A code match without an exact metadata match supplies signatures and verification context without original NatSpec.

### Track changes and publish links

For mutable references, inspect the source for change events.
If a complete change event exists, add its subscription and handler.
Otherwise, the indexer observes the getter at completed checkpoints and reports getter-only coverage.
Getter discovery does not generate event handlers or reconstruct earlier transitions.

1. Review the generated metadata diff for getter names, source records, and retained role mappings.
2. After changes to configuration, schema, or ABIs, run code generation:

   ```bash
   pnpm --filter indexer run codegen
   ```

3. Run `pnpm --filter indexer run typecheck`.
4. Run the repository validation procedure in [the root README](../../README.md#validation).
5. Rebuild the affected indexer, publisher, and frontend services with the updated metadata, registrations, inventories, and labels.
6. Restart the indexer with the updated build.
7. Wait for a completed checkpoint and inspect indexing progress.
8. Publish a snapshot from the updated indexer.

Metadata generation alone does not update indexed relationships or published snapshots.
During catch-up, checkpoints occur every 10,000 blocks.
In realtime, checkpoints occur every 100 blocks.
Creation boundaries also trigger completed-block observations.
Unknown creation anchors use the first indexed observation boundary for generic getters.
Historical event coverage requires a replay from the relevant start block.
An ordinary restart does not establish missing earlier history.

For an existing local Compose stack, rebuild the affected services with `pnpm run stack:up`.
After the indexer catches up, publish its data from another terminal:

```bash
pnpm run stack:publish
curl http://localhost:8082/v1/chains/CHAIN_ID/protocol
```

Use live indexed snapshots for this check.
Sample snapshot generation does not read deployed getters.
Production restart and publication instructions are in [the Railway guide](../../docs/railway-self-hosting.md).

In the snapshot, inspect `data.relationships` for the source address, getter, target, provenance, coverage, and verification outcome.
In the frontend, inspect the connection label and its details.
Zero and self references do not produce graph links.
Unavailable reads retain established values and report unavailable verification.
A source code mismatch prevents a new verified observation.
Returned addresses do not automatically establish ownership or recursively discover another contract's getters.
For additional target getters, repeat this procedure for the target contract.

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

## CCIP lane observations

The Bridge lanes view uses optional `BridgeConfiguration` snapshot records.
Pool records enumerate remote selectors, accepted pools/tokens, router support,
allowlists, and inbound/outbound rate-limit configuration. Bridge records read
the corresponding EVM or SVM trusted-remote getter. Chain selectors remain
decimal strings; they are not EVM chain IDs.

Configuration events invalidate the previous observation immediately. Completed
checkpoints refresh it with hash-bound reads: at creation, every 10,000 blocks
during catch-up, and every 100 blocks in realtime. Failed reads retain the prior
configuration as unverified. Canonical-anchor checks prevent orphaned evidence
from becoming current. Envio rollback restores both observations and events.

Each direction is checked independently against both snapshots. Missing snapshots,
missing configuration, and unindexed Solana destinations remain unknown. Known
disabled endpoints, absent registrations, incompatible trusted remotes/pools,
and zero-capacity/zero-refill active limits are reported as blockers. Disabled
rate limiting means unlimited throughput for that limiter.

This first view covers recorded CCIP configuration. It does not simulate delivery,
index Solana destination state, measure liquidity or CCIP health, or discover
LayerZero lanes. Update the gateway/schema readers before publishing the new
optional snapshot field. Older snapshots remain readable without lane evidence.

## Module dependencies

Module dependencies and permission requests describe different relationships.
`configureDependencies()` declares the module keycodes that a policy uses, including read-only dependencies.
The Kernel records these declarations in `moduleDependents`.
The indexer reads this registry and resolves each keycode to its current installed module.
This covers internal module references without calling the state-changing `configureDependencies()` function.

Completed canonical checkpoints update these relationships through the existing reference pipeline.
The graph labels them `Depends on KEYCODE`.
The Module dependencies filter starts disabled, including getter links to modules.
Dependency details remain available while those graph links are hidden.
Module details, policy details, and module counts include these dependencies separately from permissioned functions.
Legacy snapshots retain their permission-based fallback.
Unavailable registry reads retain established links with unavailable verification.
Checkpoint coverage does not establish every earlier dependency transition.
