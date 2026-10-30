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
| Event reuse | 430 | 4.439 s |

This is 44.9% fewer requests and 68.0% shorter in the selected repeatable workload. Canonical rechecks bypass the Envio effect loader, which can memoize even nonpersisted effects within a batch. An initial measurement accidentally benefited from that memoization; these corrected measurements issue fresh header RPCs for each recheck. Cold setup costs are included; raw per-method cold/warm counts are in [milestone 2](indexer-rpc-milestone-2.json). The original single-checkpoint fixture has no cross-block reuse opportunity and its previously measured 1361-request result remains the comparison reference, not a claim of additional savings.

Regression checks cover active/inactive state, every action, migration, backward reads, runtime/address mismatch, empty dependency scans, restart, canonical fork rejection and retained verification provenance. Indexer tests and TypeScript checking pass; offline code generation succeeds using localhost-only RPC placeholders. This milestone adds two schema entities; no existing database was migrated or reset. Worker isolation remains disabled.

## Verified deployment lifetime facts

The first deployment manifest covers only Ethereum CoolerV2Migrator at 0xe045bd0a0d85e980aa152064c06eae6b6ae358d2, creation block 22515497. Seven public immutable address getters are proven from verified compiler source: CHREG, FLASH, COOLERV2, MIGRATOR, USDS, GOHM and DAI. The source/runtime-bound manifest contains the runtime artifact and proof description. Mutable owner/isEnabled and unknown getters are excluded.

A persisted deployment proof requires empty code at the parent block and the exact audited runtime at creation. This reviewed executable has no CALLCODE, DELEGATECALL or SELFDESTRUCT (PUSH data and CBOR metadata excluded). Imported factory child creation bytecode is not this contract's executable. No proxy-slot heuristic is used. Ordinary nonempty runtime cannot turn into an EIP-7702 delegation account. An earlier incarnation or runtime mismatch rejects the lifetime proof; predeployment reads never reuse it. Forks re-key the proof by creation hash; deployment and descendant headers are read fresh. Absent code and target-contract code remain block-hash-specific. Legitimate unavailable historical state falls through; transient failures still propagate.

Immutable raw calls execute at creation and persist against deployment identity plus full allowlisted zero-argument calldata, with no caller/options. Relationship verification retains that actual creation-block RPC provenance. Referenced target code is read at each requested block and followed by a canonical recheck.

| Seven-getter, ten-checkpoint fixture | Requests | Median |
| --- | ---: | ---: |
| Block-specific readers | 300 | 5.052 s |
| Verified deployment reuse | 229 | 3.684 s |

This is 23.7% fewer requests and 27.1% shorter in this fixture. It includes cold proof overhead, three repetitions, 10 ms/RPC and a fresh Envio loader every checkpoint with PostgreSQL-persisted effects. The runtime is the manifest's real bytecode, but headers and getter values are controlled fixtures. Warm nine-checkpoint eth_call count falls from 63 to zero. Raw counts: [milestone 3](indexer-rpc-milestone-3.json). This workload starts after deployment and is distinct from the older 324-operation baseline; its savings must not be added arithmetically to earlier fixture percentages.

Verification: all 74 indexer tests and TypeScript checking pass. Regression coverage includes the production getter integration, source hash/runtime binding, history boundaries, an earlier incarnation, persistence, unknown/mutable selector fallback and fork changes. The final ordered repository validation remains pending.

## Review closeout

Review found and fixed two canonical races: target code must refresh before the final reused-fact header checks, and a fresh successful observation must recheck canonicality even when its reusable runtime proof fails. Production RPC fixtures reproduce fork rejection; separate tests prove wrong Kernel runtime/pointer bindings cannot seed reuse. A held-response fixture fills eight active requests plus 256 waiters, rejects the next logical RPC, drains, and recovers on another chain. Raw requests are used because viem's getBlockNumber action coalesces in-flight calls even with cacheTime zero. The current event-reuse timing above was rerun after the fixes, with the same 430 requests.

## Remaining milestones

- Last: aggregate eRPC budget, private revert compatibility and actual proxy/PostgreSQL integration. Keep finite defaults and provider protection.

Worker isolation is not an environment-only toggle in Envio 3.14.1: all current entities use shared cross-chain storage. Enabling per-chain processing changes storage keys and checkpoint sequencing and requires a migration/replay plan. This task does not reset databases or activate workers. HyperSync rate limits already wait/retry their source query; custom RPC effects need the separate recovery boundary implemented above.
