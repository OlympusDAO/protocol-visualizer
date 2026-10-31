# Indexer RPC performance

This report records the first bytecode-cache optimization. See [local follow-on milestones](performance/indexer-rpc-milestones.md) for exact-call reuse, event/deployment facts, eRPC recovery, measurements and current validation/release boundaries. The current follow-up includes a stale-observation fix and supersedes the earlier inner-effect/restart performance claims.

See [getter and transport follow-up](performance/indexer-rpc-followup-milestones.md) for automatic compiler-proven immutable discovery, event-maintained ownership including OpenZeppelin Ownable, viem retry scheduling and HTTP batching. Its measurements and limitations supersede the corresponding implementation descriptions below.

## Scope

The performance branch starts from commit `9eb4755be2904f6751a72890ecce134c4c701fef`.
The PR indexer runs `b0c7832`; its indexer source matches that base.
Checkpoint frequency and existing effect and eRPC rate limits stay unchanged.
No Railway deployment, variable change or database reset forms part of this comparison.

The first change stores compact bytecode hashes through an Envio effect.
The cache key contains the chain, address and canonical block hash.
Getter reads, metadata verification and bridge observations share these facts.
Envio stores successful facts in PostgreSQL and reloads them after a restart.
Failures are not persisted.
Empty code is a valid observation at one block hash, not evidence of permanent absence.

Every existing before/after canonical-block check remains active.
The cache does not reuse numeric block headers or infer that mutable getters are constant.
An Envio reset removes these additional effect records.
The independent eRPC database still preserves its RPC responses across that reset.

## Live baseline

Environment: `protocol-visualizer-pr-82`.
The baseline uses 16 read-only database samples from 2026-10-30 10:02:03.471 UTC to 10:17:34.763 UTC.
Elapsed time: **931.292 seconds**.

| Chain | First committed block | Last committed block | Blocks advanced | Blocks/second |
| --- | ---: | ---: | ---: | ---: |
| Ethereum | 17,238,767 | 17,238,767 | 0 | 0 |
| Optimism | 114,866,112 | 115,361,212 | 495,100 | 531.63 |
| Arbitrum | 199,745,460 | 203,705,860 | 3,960,400 | 4,252.59 |
| Base | 24,078,923 | 24,078,923 | 0 | 0 |
| Berachain | 8,195,510 | 8,688,910 | 493,400 | 529.80 |
| Robinhood | 26,729,457 | 27,719,557 | 990,100 | 1,063.15 |
| Sepolia | 8,055,887 | 8,055,887 | 0 | 0 |
| Arbitrum Sepolia | 286,811,944 | 287,307,044 | 495,100 | 531.63 |
| Base Sepolia | 29,857,136 | 29,857,136 | 0 | 0 |

These rates measure committed block progress, not RPC activity inside a batch.
A zero means no batch advanced that chain during this window.
Envio schedules work across chains, and large preload batches can delay visible progress.
Different block times and active contract inventories also prevent direct comparisons between chains.
The `eventsProcessed` counter includes scheduled block callbacks, including historical callbacks that return immediately.
It does not count only protocol logs.
Do not use this window alone for a rebuild ETA.

An earlier profile at 09:49:29 UTC recorded 9,359.669 seconds of runtime:

| Stage | Seconds | Share |
| --- | ---: | ---: |
| Preload | 7,934.816 | 84.8% |
| Processing | 1,345.278 | 14.4% |
| Waiting for fetched data | 31.870 | 0.3% |
| Waiting for storage writes | 0.063 | Less than 0.01% |

Resource samples from 09:29–09:44 UTC showed about 0.051 vCPU and 421 MB of indexer memory.
The service allocation was 1 vCPU and 2 GB.
These are sampled values, not peak measurements.
The evidence points to checkpoint reads as the first optimization target.

## Controlled before/after comparison

The workload uses Ethereum's 324 active relationship getters across 64 contracts at block 17,238,767.
Each getter returns one shared fixture address.
The controlled upstream adds 10 ms per JSON-RPC request.
Fixture metadata uses the fixture bytecode hash without changing committed contract metadata.

The comparison runs the production getter effect through the pinned Envio 3.14.1 loader and rate limiter.
It uses real viem HTTP requests and a PostgreSQL adapter with a connection-local temporary table.
The adapter replaces Envio's storage boundary; this is not a complete HyperSync replay or Envio database migration test.
eRPC is not part of this fixture.
Request counts measure traffic leaving the indexer, not provider-billed cache misses.

| Metric | Before | After |
| --- | ---: | ---: |
| Block-header requests | 972 | 972 |
| Getter calls | 324 | 324 |
| Bytecode requests | 648 | 65 |
| Total JSON-RPC requests | 1,944 | 1,361 |
| Median duration, three runs | 31.660 s | 22.372 s |

The fixture makes **30.0% fewer requests** and finishes **29.3% sooner**, equivalent to **1.42× checkpoint throughput**.
All result digests match before and after.
Fresh Envio runtimes reload both getter outputs and bytecode facts from PostgreSQL with zero RPC requests.
Tests also cover concurrent deduplication, chain/address/block isolation, empty code, malformed responses, failures and canonical changes during reads.

The shared fixture target makes bytecode reuse explicit.
Real targets vary, so the measured reduction is not a promise for every checkpoint.
No live after-deployment measurement exists yet.
The remaining 972 header requests and 324 getter calls limit this first improvement.

Raw samples and individual fixture timings are in [the measurement artifact](performance/indexer-rpc-2026-10-30.json).

## Repeat the comparison

Use the repository-pinned Node and pnpm versions.
Install dependencies with `pnpm install --frozen-lockfile`.

Run the controlled comparison from this checkout:

```sh
node --import ./apps/indexer/scripts/register-typescript.mjs \
  apps/indexer/scripts/benchmark-rpc-reads.mjs \
  --repetitions 3 --latency-ms 10
```

Without a database URL, the script uses an in-memory storage adapter.
For the PostgreSQL comparison, start a new disposable database:

```sh
docker run --detach --name pv-indexer-benchmark \
  --env POSTGRES_PASSWORD=fixture --env POSTGRES_DB=rpc_benchmark \
  --publish 127.0.0.1:15439:5432 --tmpfs /var/lib/postgresql/data \
  postgres:17-alpine@sha256:979c4379dd698aba0b890599a6104e082035f98ef31d9b9291ec22f2b13059ca
```

Use this fixture database, not an existing indexer database:

```sh
RPC_BENCH_DATABASE_URL=postgres://postgres:fixture@127.0.0.1:15439/rpc_benchmark \
  node --import ./apps/indexer/scripts/register-typescript.mjs \
  apps/indexer/scripts/benchmark-rpc-reads.mjs --repetitions 3 --latency-ms 10
```

For the before measurement, pass `--source-root /path/to/base-checkout` to the same script.
That checkout must contain the base commit and its installed dependencies.
Run before and after sequentially on the same machine with the same arguments.
Keep other builds idle during timing.
Compare result digests, request counts, effect queue time and median duration.
The script also checks cache reloads through a fresh Envio runtime outside the timed section.

After the comparison, remove only the disposable container created above:

```sh
docker rm --force pv-indexer-benchmark
```

Measure live committed progress from the local machine:

```sh
railway run --no-local --service Postgres \
  --environment protocol-visualizer-pr-82 \
  node apps/indexer/scripts/measure-indexing.mjs \
  --duration-seconds 900 --interval-seconds 60
```

The script prints its environment, samples and per-chain block rates as JSON.
It requires `DATABASE_PUBLIC_URL` for remote access or `DATABASE_URL` for a reachable local database.
Public connections require TLS.
The connection is read-only, and errors omit connection credentials.
For a deployment comparison, record the indexer commit, resource allocation, effect limits, starting blocks and cache warmth separately.
Use a longer interval that includes completed batches for each chain.
Do not run two indexers against the same database.

## Further opportunities

The protocol metrics subgraph provides two useful patterns:

- `SnapshotHelpers.ts` reads event-accumulated token balances from entities.
- `snapshot/contract-cache.ts` caches explicitly invariant reads across snapshots.

This indexer already stores event-derived state, but it also checks getter-only relationships at checkpoints.
Token decimals are not part of its current checkpoint workload.
A decimals cache would therefore remove no current reads.

Nonproxy bytecode is often stable, but stable code does not imply stable storage or getter results.
The committed metadata records ABI signatures, source hashes and documentation.
It does not record compiler AST evidence for Solidity `immutable` or `constant` declarations.
The current cache therefore keeps block-hash identity, including for proxy code and absent code.

For cross-checkpoint reuse, first classify invariant getters from compiler evidence bound to the matched deployed runtime.
Audit proxy and deployment-lifetime exceptions before removing block identity.
Keep mutable authorities, module pointers, routing and approval getters as checkpoint observations.
Never reuse an observation backwards before deployment.

## Per-chain workers

Per-chain workers remain disabled.
The pinned runtime requires every entity to use per-chain storage before it splits processing.
All 17 current entities use the default cross-chain storage scope.
`ENVIO_PG_MAX_CONNECTIONS` is unset, so its default of two connections permits one process.

Most entity IDs already include chain IDs, making a later isolation migration plausible.
That migration needs a separate database and replay/reorg equivalence checks.
Existing stored state must not be reset automatically.

Envio's effect limiter is process-local.
Four workers could multiply the aggregate getter limit from 25 to 100 operations per second.
The existing eRPC budget would remain global, but that alone would not preserve the additional indexer limit.
Future workers need coordinated limits or explicitly partitioned budgets before benchmarking.
They also share the service's total CPU and memory allocation.

The runtime supports at most four automatic workers.
See [Envio's multiprocess release notes](https://github.com/enviodev/hyperindex/releases/tag/v3.13.0).

## Validation

The required nine-step repository sequence passed in order, including all four required Docker builds.
The first attempt stopped at a type-only import lint warning.
After that correction, the complete sequence restarted from the runtime check.
The indexer suite passed all 67 tests.
Typechecking also passed after offline code generation with localhost RPC placeholders.
Code generation did not contact providers.

The measurement command ran against the PR database through a read-only connection.
The controlled PostgreSQL comparison passed before/after equality and cache reload checks.
An independent local code review found no actionable correctness issues.
The candidate has not indexed against live providers or deployed to Railway.
