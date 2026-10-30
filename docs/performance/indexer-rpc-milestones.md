# Local indexer RPC milestones

All work stays on the performance branch. Checkpoint frequency and HyperSync remain unchanged. No live variables, databases, deployments or PRs are changed.

## Comparable baseline

The recorded controlled PostgreSQL fixture runs 324 Ethereum relationship getter operations at block 17238767, a shared returned target, and 10 ms latency per RPC. Three serial repetitions use the pinned Envio loader with PostgreSQL-backed effect rows. The original baseline is 1944 requests and 31.660 s median. The first committed bytecode optimization is 1361 requests and 22.37 s median. Results and restart persistence match. This is not a full replay or live billing measurement. eRPC already absorbs duplicate upstream requests.

| Milestone | Requests in original fixture | Median | Change from original baseline |
| --- | ---: | ---: | --- |
| Recorded baseline | 1944 | 31.660 s | — |
| Persisted block bytecode facts (existing commit) | 1361 | 22.37 s | 30.0% fewer requests; 29.3% shorter |
| Shared proxy recovery and exact calls | 1361 | 22.362 s | 30.0% fewer requests; 29.4% shorter |

## Shared proxy recovery and exact calls

One process-wide FIFO queue admits eight logical RPC requests at a time and at most 256 waiters, across all chains. Six total attempts retry transient capacity/transport failures with bounded exponential jitter (250 ms to 4 s base delay). Permits are released during waits. Every retry uses the same configured proxy; upstream retries remain eRPC-owned. Exhaustion throws a sanitized identifiable exception through getter, bytecode, metadata, header, dependency, and optional router catch boundaries. It prevents successful incomplete observations. A prolonged outage can still stop Envio after the bounded budget; in-process recovery is for short outages, not infinite availability.

Raw successful canonical eth_call requests persist as Envio effects. The key includes chain and the complete wire parameters: destination, full calldata, caller, gas/value/options, state overrides and canonical block hash. ABI/field names do not affect identity. Consumers decode independently. Errors, latest calls and numeric-height calls do not persist. Mutable numeric-height headers remain uncached. Existing effect limits and Etherscan metadata limits remain.

The raw-call regression measures two independently decoded consumers becoming one RPC, including reload through a fresh Envio runtime. Key-isolation cases and non-caching of errors/latest/numeric heights pass. The original 324-operation workload contains no duplicate calldata, so this milestone adds no request reduction to that fixture. Do not extrapolate the 50% duplicate-consumer reduction to total indexing.

Verification: 71 indexer tests passed; indexer TypeScript check passed. The PostgreSQL fixture used a new disposable tmpfs container, without resetting an existing database. Three result digests match the baseline and restart adds zero fixture RPC requests. Raw measurement: [milestone 1](indexer-rpc-milestone-1.json). The final required nine-step repository sequence is still pending.

## Event-invalidated Kernel reuse

Six exact-source Ethereum contracts provide 13 eligible pointer operations: RolesAdmin, Emergency, Clearinghouse, OlympusRoles, OlympusMinter and OlympusTreasury. One exact Kernel runtime provides dependency registry scans. The manifest binds chain/address/runtime hashes to verified public source hashes and mutation sites. This is a narrow allowlist, not the full 103 potentially reusable active pointer reads from the inventory. Inactive policies keep ordinary observations because configureDependencies can run without a Kernel event. Read-only dependencies still come from moduleDependents, not requestPermissions.

KernelReadCache and KernelReadEpoch are ordinary Envio entities so rollback restores them. Every ActionExecuted changes the epoch. Migration permanently disables this optimization for the chain because the old Kernel leaves active records populated and the new Kernel may be untracked. Unknown sources and mismatched runtimes fall through. Cached observations must be older than the requested block and retain canonical anchors. Reused relationship/dependency verification retains the last actual RPC block while indexedThrough advances. Target-code presence is rechecked. changeExecutor uses the event target directly.

A separate controlled fixture exercises 13 pointers and three dependency scans (two dependents each) over ten checkpoints with no intervening Kernel action, 10 ms per request and three serial repetitions. It uses actual production readers, the pinned Envio effect loader, PostgreSQL-backed effect and entity adapters, and restarts the loader after checkpoint five. Source/runtime bindings and return values are deliberately replaced with fixture data; this is not a live replay or an Envio database migration test.

| Ten-checkpoint fixture | Requests | Median |
| --- | ---: | ---: |
| Same readers without event reuse | 780 | 13.883 s |
| Event reuse | 107 | 1.996 s |

This is 86.3% fewer requests and 85.6% shorter in the selected repeatable workload. Cold setup costs are included; raw per-method cold/warm counts are in [milestone 2](indexer-rpc-milestone-2.json). The original single-checkpoint fixture has no cross-block reuse opportunity and its previously measured 1361-request result remains the comparison reference, not a claim of additional savings.

Regression checks cover active/inactive state, every action, migration, backward reads, runtime/address mismatch, empty dependency scans, restart, canonical fork rejection and retained verification provenance. Indexer tests and TypeScript checking pass; offline code generation succeeds using localhost-only RPC placeholders. This milestone adds two schema entities; no existing database was migrated or reset. Worker isolation remains disabled.

## Remaining milestones

- Event-invalidated active Kernel/module pointer and dependency reuse, retaining original RPC provenance and inactive-policy fallback.
- Narrow source/runtime-proven deployment lifetime and immutable getter facts.
- Last: aggregate eRPC budget, private revert compatibility and actual proxy/PostgreSQL integration. Keep finite defaults and provider protection.

Worker isolation is not an environment-only toggle in Envio 3.14.1: all current entities use shared cross-chain storage. Enabling per-chain processing changes storage keys and checkpoint sequencing and requires a migration/replay plan. This task does not reset databases or activate workers. HyperSync rate limits already wait/retry their source query; custom RPC effects need the separate recovery boundary implemented above.
