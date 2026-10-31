# Approved indexing-speed implementation milestones

The user approved DB-first semantic facts, verified deployment bytecode reuse, shared fresh canonical checks, then finite effect-limit tuning if still needed. HyperSync, 10,000-block checkpoints and the shared 50-credit eRPC cap stay unchanged. Work remains local; no existing database reset, live variables, deployment or publication.

The whole-indexer reference is the recorded 50,001-block Ethereum replay at 174.323 seconds, 286.8 blocks/second. A 50–100% throughput improvement means 116.215–87.162 seconds. Narrow fixture percentages below are not whole-indexer gains.

## DB-first Kernel facts

The production getter now checks eligible Kernel entity state before attempting deployment discovery or getter effects. A miss retains the previous discovery/getter path. When a read already carries older deployment verification provenance, the Kernel entity retains that actual block instead of relabeling it as a new RPC observation.

The proof-first production-entry regression failed with one unwanted effect invocation, then passed with zero. The provenance regression failed with block 10 instead of block 4, then passed. Seven focused Kernel/cache-first tests pass, including existing action invalidation, inactivity, migration and fork cases. Additional characterization verifies target-code refresh on reuse and propagation of its transient failure.

| Three-run controlled fixture, ten quiet checkpoints | Before | DB-first |
| --- | ---: | ---: |
| Header RPC items | 20 | 20 |
| Source code RPC items | 10 | 0 |
| Total RPC items | 30 | 20 |
| Calls through the effect interface | 20 | 0 |
| Median duration | 306.837 ms | 154.181 ms |

The fixture starts with a proven Kernel entity fact, restarts the real Envio effect loader at each checkpoint and uses controlled responses at 10 ms/RPC. Effect persistence storage is adapted in memory, not a real database. Source discovery returns a controlled 404. The new deployment entity path is absent from this fixture, isolating the lookup-order change. This is 33.3% fewer RPC items and 49.8% shorter fixture time, not a live indexing speed result. [Raw measurements](indexer-speed-db-first-2026-10-31.json).

Run `node --import ./apps/indexer/scripts/register-typescript.mjs apps/indexer/scripts/benchmark-db-first.mjs <source-root>` from the repository root. The baseline used source exported from 69e6379.

Astra's stage review found no actionable production issue. Its suggested target refresh/failure characterization was added; broader persisted-fork tests remain in the existing suite. Ponytail simplification retained the existing fallback closure and entity schema; no second cache, queue or cache helper was added for this change. The one-line provenance change is required to preserve actual verification history.
