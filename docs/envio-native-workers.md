# Native Envio worker experiment

This branch starts from the RPC-read performance branch at `ac5eab8`. It tests Envio 3.14.1's built-in supervisor on fresh local databases. No preview or production storage has been migrated.

## Storage milestone

All 20 entities use Envio's native per-chain storage. Envio supplies the physical `chainId` column, partitions and composite identity. Handlers no longer supply or filter that column. Existing chain-prefixed IDs and external snapshot fields remain unchanged.

Deployment reuse now validates the handler's chain scope rather than expecting a physical database column in the loaded entity. Ownership presentation receives the chain explicitly. Dependency and discovered-pool queries use the handler's native scope and reject a conflicting explicit chain argument.

All 15 existing effects explicitly retain shared scope. Their inputs already include chain identity; this preserves their cache table identity and avoids accidentally multiplying effect limits within one process.

Metadata HTTP admission is separate from RPC admission. Etherscan and Sourcify each retain five starts/second in an ordinary process. Native workers reserve one start/second each, conservatively allowing at most four across Envio's pinned maximum of four workers. Admission measures from actual release so overdue timers cannot bunch up after a stall. Retries reacquire admission. This protection assumes one supervisor, not multiple replicas.

This schema change requires a fresh database/reindex. Do not point it at an existing shared-schema database or apply ad hoc DDL. Default PostgreSQL connection capacity remains unchanged, so this milestone alone does not enable multiple workers in deployment.

## Correctness evidence

The deployment reload regression first failed because a native entity lacks `chainId`; it now reuses the fact without entering effects and rejects wrong-chain access. Focused deployment, Kernel and ownership tests passed (30 tests).

The real PostgreSQL fixture seeds two chains with identical deployment, Kernel, dependency, module and registration IDs. Separate processes reload, roll back only chain 1, persist the replacement checkpoint and reload again. It checks native `get`/`getWhere` isolation, all three production query paths, pending-owner restoration, the unaffected chain, retained verification provenance and cache hits after restart. It creates its own database; existing databases are untouched.

## Measurement protocol

No worker speedup is claimed from single-chain tests. The previous Robinhood comparison (+142.7% throughput) measures earlier RPC optimizations, not this change.

Compare one, two and four native processing groups on identical four-chain HyperSync ranges, fresh indexer/cache databases and the same aggregate 50 unit-credit/second eRPC cap. Keep 10,000-block checkpoint and 100-block realtime observation intervals unchanged. Require all chains to finish, equal per-chain event counts and canonical entity digests before accepting a speed percentage.

Envio derives workers from the PostgreSQL connection budget: 2 connections select one process, 4 select two workers, and 8 select four workers. These are coupled native configurations; database capacity is a disclosed treatment, not a constant. Metadata admission also differs between ordinary and supervised processes. Report total wall time, aggregate blocks/second, per-chain progress, RPC items/retries and process resource use. A fixed account throughput cap can limit gains despite more CPU parallelism.

Worker groups share a failure boundary: one failed worker stops its siblings. The supervisor also holds realtime progression until all chains finish backfill. This experiment keeps bounded recovery and eRPC provider protection; it does not promise unlimited throughput or independent restarts.

Storage milestone validation: all nine ordered repository checks passed, including all four application images. The native 429/late-fork atomicity test passed in 68.9 seconds. The expanded PostgreSQL restart/rollback test passed in 3.8 seconds. Astra reviewed correctness; Ponytail's simplification removed the redundant per-instance Etherscan limiter. These are correctness measurements, not indexing-speed results.

The initial worker-profile scout reused the old Robinhood benchmark's eight-second capacity adapter. Its indexer completed, but adapter exhaustion invalidated the result. Native protocol v2 removes that compatibility adapter: both the performance parent and native variants already own production retries. No timing from the failed adapter-backed scout is accepted or compared to direct-path runs. HyperSync, the 50-credit cap and observation cadence remain unchanged. Proxy capacity/outcome counters and per-process HTTP status counts record throttling without provider text or URLs.
