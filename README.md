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

The project is made up of two components:

- Indexer
  - This uses the Ponder framework to index blockchain events
- Frontend
  - A static frontend that retrieves records from the indexer and renders them in a diagram

## Deployment

Note: WIP

- PostgreSQL database
  - Hosted on a Google Compute Engine VM
- Indexer
  - Hosted on a Google Compute Engine VM
- Frontend
  - Hosted on Fleek

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
pnpm run docker:build:indexer
pnpm run docker:build:frontend
```

## Runtime Image Notes

- The indexer runtime image keeps `pnpm`/Corepack so it can execute `pnpm exec ponder ...` at startup.
- `npm` is removed from the indexer runtime image because it is not required to run the service and it reduces toolchain-only vulnerability surface in container scans.

## Indexer Performance

Indexer startup performance is measured with `scripts/benchmark-indexer.mjs`. The benchmark runs Ponder with a fresh schema, can temporarily move local Ponder cache and contract metadata data aside, and records per-chain progress under `benchmarks/indexer/`.

Use this command for a cold Ponder/database-cache run:

```bash
BENCHMARK_CLEAN_CACHE=1 BENCHMARK_SECONDS=300 BENCHMARK_PORT=43124 node scripts/benchmark-indexer.mjs
```

Use this command when testing a Railway-like cold filesystem with no local ABI/source/contract metadata data:

```bash
BENCHMARK_CLEAN_CACHE=1 BENCHMARK_CLEAN_CONTRACT_DATA=1 BENCHMARK_SECONDS=300 BENCHMARK_PORT=43124 node scripts/benchmark-indexer.mjs
```

Current optimizations:

- Ponder uses `experimental_isolated` ordering so one slow chain does not hold back all other enabled chains.
- Kernel policy permission handling caches `requestPermissions()` per policy address for the process lifetime.
- Module addresses for policy permissions are resolved from indexed module state instead of making historical `getModuleForKeycode` RPC calls.
- Contract metadata is precomputed in `apps/indexer/src/generated/contract-metadata.json`, which lets the indexer avoid runtime Etherscan ABI/source fetches and source parsing for known contracts.

Benchmark justification:

| Benchmark | Cold local Ponder cache | Cold contract metadata data | Blocks indexed in 300s | Handler time | RPC errors |
| --- | --- | --- | ---: | ---: | ---: |
| Original cold baseline (`2026-05-19T14-32-48-055Z`) | Yes | No | 464,094 | 281,363 ms | 139 |
| Isolated ordering + first RPC reductions (`2026-05-19T14-56-03-180Z`) | Yes | No | 4,477,249 | 436,103 ms | 243 |
| Current cold-data run (`2026-05-19T17-46-23-475Z`) | Yes | Yes | 5,599,565 | 151,244 ms | 152 |

Compared with the original cold baseline, the optimized indexer advances 12.1x as many blocks in the same 5 minute window. Compared with the first isolated-ordering/RPC-reduction benchmark, the current cold-data run advances 25.1% more blocks, while reducing handler time by 65.3% and RPC errors from 243 to 152. The cold-data run is the best Railway proxy because it starts without the ignored `apps/indexer/data` cache and proves the tracked precomputed metadata artifact is sufficient for startup progress.
