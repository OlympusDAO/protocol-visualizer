# Local indexer RPC milestones

All work stays on the performance branch. Checkpoint frequency and HyperSync remain unchanged. No live variables, existing databases, deployments or PRs are changed.

Milestone verification statements record the status at each commit; the final validation section gives the closeout status.

## Current result after the cache-safety challenge

This section supersedes the ordinary-getter timing and restart claims in the historical milestone entries below. A new production-entry regression demonstrated that a persisted successful getter observation could be accepted after a restart even when its block hash had become orphaned. The underlying fact was still bound to the old hash, but the successful observation had skipped a fresh canonical check.

Successful ordinary/inactive/migrated getter results, unknown-Kernel dependency results, bridge configurations and code verification for metadata/deployment seeding now have a fresh canonical acceptance check outside their persisted effects. Proven active Kernel and immutable-deployment paths retain their existing checks. The regression restarts the actual pinned Envio effect loader, retains persisted old-fork effects, rejects old pins, and verifies new values on the replacement fork. Normal restart still reuses all contract-call and bytecode facts; it now performs fresh header checks.

| Controlled workload | Requests | Median before -> after | Fewer requests / shorter time |
| --- | ---: | ---: | ---: |
| 324-getter production entry point | 1944 -> 1685 | 27.463 -> 25.684 s | 13.3% / 6.5% |
| 13 Kernel pointers + 3 dependency scans over 10 checkpoints | 780 -> 430 | 11.181 -> 4.497 s | 44.9% / 59.8% |
| 7 immutable getters over 10 checkpoints | 300 -> 229 | 5.305 -> 3.259 s | 23.7% / 38.6% |

These are three-repetition fixtures at 10 ms/RPC, with PostgreSQL-backed effects. The ordinary benchmark now uses getControlGetter, the production entry point, and was rerun against the untouched base checkout. Results have identical digests. Previously quoted 1361 requests described the inner effect; the corrected production entry point uses 1685 because its 583 avoided bytecode requests are offset by 324 fresh canonical-header checks. That is 259 fewer requests, or 13.3%. Its restarted run makes zero EVM-call/code requests and 324 header requests. Latency varies with the host; these fresh paired figures replace the older timing comparison for current claims.

Proof work verified eight audited runtime hashes, 43 source-file hash bindings across the Kernel manifests, and all seven public immutable declarations. Seven in-memory mutation tests removed chain isolation, epoch invalidation, inactive fallback, Kernel runtime binding, the deployment boundary, canonical acceptance, or actual event-handler invalidation; every altered version failed an assertion. Production tests also invoke the actual ActionExecuted handler for executor changes and migrations. No production source files were mutated for these negative tests.

All nine required validation commands passed again, the indexer suite passed 79 tests, TypeScript checking passed, and focused independent review had no actionable findings. Raw results are in [the cache proof artifact](indexer-rpc-cache-proof-2026-10-31.json). Full Envio database rollback/entity restoration and a full optimized replay remain untested. RPC honesty and configured chain finality remain assumptions. Existing-database migration planning and disabled worker isolation remain release boundaries; nothing was deployed or changed live.

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

## Aggregate eRPC budget and private errors

The pinned eRPC wildcard request-mode rule counted each method separately. It now uses unit credits and credit count mode, sharing a finite default 50-request/second pool across all methods and chains. Upstream maxAttempts remains one, no hedging is added, and network retries reacquire permits. Cache hits precede upstream admission. The limiter rejects rather than queues; the indexer queue/backoff provides client-side recovery. Existing effect limits, checkpoint frequency, HyperSync and Etherscan limits stay unchanged. No live RPS setting was lifted.

The private-error patch preserves a normalized bare execution-revert signal and safe ABI bytes. It does not equate arbitrary code-3 failures, reasoned reverts or generic RPC failures with empty array bounds. The actual patched image, central client, viem and production dependency reader passed nine cases covering empty bounds, encoded Panic(0x32), other panics, custom/reasoned reverts, generic errors and transport exhaustion. Capacity recovery also passed. Failed observations cannot be accepted as an empty dependency list.

A fresh controlled eRPC/PostgreSQL integration passed in 39.08 s. Seventeen persisted rows survived an eRPC restart. A 20-credit/second mixed-method, mixed-chain burst sent 160 requests, admitted 20 actual upstream requests and returned 140 capacity errors. Counting includes actual retry/poller admissions. A persisted HIT worked during saturation; a later-window request recovered. Credential markers stayed out of responses and logs. The legacy Envio reset checks were explicitly skipped; only new disposable fixtures were created and removed. The initial persistence assertion was a test-readiness race: the corrected test observes the PostgreSQL row after one cold request instead of repeatedly issuing requests during asynchronous cache writes, then requires a HIT without another upstream read.

This milestone corrects protection and recovery. It makes no additional indexing-speed claim. An aggregate cap can admit less traffic than the old independent per-method caps. The original 324-getter comparison remains 1944 -> 1361 requests and 31.660 -> 22.362 s; the cross-block fixture results above describe their own workloads. None is an optimized live replay or a provider billing result.

Run the controlled transport integration with no resets:

```sh
RPC_CACHE_TEST_SKIP_RESET=1 node --test services/rpc-cache/integration.test.mjs
```

Use the repository-pinned Node 24.22.1 and pnpm 11.28.7, and build the local rpc-cache image first. All endpoints and database credentials in these fixtures are disposable test values. Raw integration counters, security results and ordered command statuses are in [milestone 4](indexer-rpc-milestone-4.json).

## Final validation and release boundary

The final nine required commands passed in order after review fixes: runtime check, frozen install, lint, build, local sample snapshots, then indexer/frontend/gateway/publisher image builds. The indexer suite passed 78 tests. Offline code generation and indexer TypeScript checking also passed. Sample snapshots are fixtures, not live indexer output. Nine review lenses completed with the concrete review findings fixed. The original worktree and dependency/frontend source files were unchanged. No push, PR update, deployment, existing database reset or live variable change occurred.

The eRPC image Trivy scan passed the existing ignore policy at MEDIUM/HIGH/CRITICAL. The indexer image scan returned exit 1 with 23 MEDIUM OS advisories in the unchanged Debian base, no HIGH/CRITICAL findings and no Node-package findings. Installed package/CVE details are retained in milestone 4. No ignores or dependency/base versions were changed for this performance work.

The new KernelReadEpoch and KernelReadCache entities are a release compatibility boundary. Envio 3.14.1 preserves entity configuration in envio_info, compares it during resume, and refuses an incompatible configuration. It does not automatically add these tables. A pre-change indexer database therefore cannot resume this code without a separately reviewed migration and retention plan. No such migration or full Envio database rollback was executed here. PostgreSQL-backed fixture adapters demonstrate cache persistence, not an existing-database upgrade. Worker isolation likewise stays disabled because per-chain storage changes require migration/replay planning. A full optimized replay and live before/after rates remain unverified.

Worker isolation is not an environment-only toggle in Envio 3.14.1: all current entities use shared cross-chain storage. Enabling per-chain processing changes storage keys and checkpoint sequencing and requires a migration/replay plan. This task does not reset databases or activate workers. HyperSync rate limits already wait/retry their source query; custom RPC effects need the separate recovery boundary implemented above.
