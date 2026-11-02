# Getter reuse and transport follow-up

This work extends the local performance branch. Checkpoint frequency, HyperSync ingestion and finite eRPC/provider protection remain unchanged. The [earlier paired HyperSync replay](indexer-rpc-indexing-sample-2026-10-31.md) measured 201.7 to 280.8 committed Ethereum blocks/second against the original base. The new replay below compares this follow-up against the already optimized branch. The fixture percentages answer narrower questions and must not be added to either replay's percentages.

## Viem retry scheduling and HTTP batching

At this milestone, the shared RPC boundary moved to viem's exported `withRetry` instead of a handwritten retry loop. It retained the then-current eight-active-operation guard, 256-waiter queue, six total proxy attempts, jittered exponential delay and sanitized exhaustion exception. The [later permit experiment](indexer-active-permits-2026-11-01.md) raised the active bound to ten. Permits are released while waiting between attempts. eRPC retains upstream retry and aggregate rate ownership. Native HTTP and outer transport retry counts stay zero, so retry layers are not accidentally multiplied.

The classifier now recognizes JSON-RPC capacity codes 429 and -32007 alongside the existing proxy codes. A regression first failed on the raw JSON-RPC 429 response, then passed with the policy update. Historical-state failures and legitimate reverts remain terminal. Error-chain inspection checks that fixture credentials and private URLs do not escape exhaustion.

HTTP batching was already enabled and remains enabled with no extra collection delay. A partial batch regression proves that one capacity-limited item retries without resending its seven successful siblings. At this milestone, cross-chain tests verified batching with eight in-flight operations; the current bound is ten. Exact batch packing depends on event-loop scheduling.

| Three-run transport fixture | Unbatched | Existing batching |
| --- | ---: | ---: |
| RPC items per run | 128 | 128 |
| Concurrent RPC items | 8 | 8 |
| HTTP envelopes | 128 | 16 |
| Median duration | 230.523 ms | 218.896 ms |

This is 87.5% fewer indexer-to-proxy HTTP envelopes and about 5.0% shorter fixture time, at 10 ms of controlled latency per HTTP envelope. It does not reduce the 128 logical RPC operations or establish provider billing savings. Because batching was already enabled, these numbers demonstrate its existing benefit, not an incremental branch speedup from enabling it now. The retry refactor makes no separate throughput claim. Raw measurements: [HTTP batching artifact](indexer-rpc-http-batching-2026-10-31.json).

Run the fixture with the repository-pinned Node version:

```sh
cd apps/indexer
node --import ./scripts/register-typescript.mjs scripts/benchmark-http-batching.mjs
```

## Kernel reuse is database state

KernelReadCache and KernelReadEpoch are ordinary Envio database entities. They form a materialized cache in the database, persist across restarts and participate in event rollback. Replacing them with a process-global map would lose those properties. Persisted raw-call and deployment effects are separate: they survive rollback and therefore require block/deployment identity and fresh canonical acceptance checks.

Kernel reuse applies to source/runtime-proven active policies and modules whose pointer changes are covered by Kernel actions. Every ActionExecuted invalidates the epoch, including module changes and policy activation/deactivation. Migration disables reuse unless tracking the new Kernel is proven. Inactive policies, unknown implementations, backward observations, changed runtime and noncanonical seed/current blocks fall back to reads. Inactive configureDependencies calls can change pointers without an event, so their state is never inferred from the latest module registry. Read-only dependency scans remain separate from requestPermissions.

## Automatic immutable getter discovery

New contracts no longer need a hand-written immutable getter list. Normal contract metadata processing, the metadata refresh command and the runtime getter path use verified compiler artifacts. Solidity's immutableReferences identify PUSH operands; the compiler source map binds them to public immutable declarations in hash-checked source files. Zero-argument address-returning ABI selectors must match those declarations. This also supports inherited/interface declarations with the public immutable override form. The Sourcify API does not expose the needed AST, so the implementation uses its compiler source maps and immutable references directly. No compiler executable or package dependency was added to the indexer.

Both the actual CoolerV2Migrator artifact (seven getters) and a separately compiled AddedImmutable contract (TOKEN getter, different runtime/address) establish automatic discovery without an address allowlist. The existing generated Cooler descriptor was produced by that same detector. Production code no longer imports the old one-contract deployment manifest; it remains test/benchmark evidence.

An uncatalogued runtime gets one shared source-discovery effect keyed by chain, address and observed runtime hash, limited to five calls per second. Eligible descriptors and verified no-eligible-getter decisions persist. HTTP 404, transport and server failures do not persist, so a later source verification can be discovered on a subsequent batch/restart. Envio coalesces same-input discovery within a batch. Source discovery has cold network/CPU cost and is separate from provider RPC limits.

Discovery runs on the getter path when generated metadata has no immutable descriptor. Its source request can wait up to 30 seconds before ordinary-read fallback. Repeated unresolved proofs can therefore add checkpoint latency during a source-service outage. Existing reader fixtures suppress external source requests; only the actual replay below includes cold source discovery. Moving that work out of the critical path is a remaining performance opportunity.

The runtime proof still requires empty parent-block code, matching ordinary runtime at creation, a requested block at or after creation, allowlisted complete calldata and fresh canonical checks. Source artifacts are trusted Sourcify/compiler inputs; hashing source files checks their binding but does not independently authenticate that service. Proxies, delegation/EOF runtimes, code containing executable CALLCODE/DELEGATECALL/SELFDESTRUCT, and inconclusive mappings fall back to ordinary reads. The scanner now walks the complete runtime and skips only PUSH operands; harmless metadata can therefore cause conservative false negatives. It does not trust arbitrary trailing bytes as a CBOR boundary.

A mid-call fork regression reproduced mixing an old persisted creation proof with a replacement descendant. Requested-pin preflight plus post-effect creation and descendant checks now reject that race. Target code remains block-specific and is checked before final acceptance. The last actual immutable RPC verification block remains the creation block.

| Seven getters over ten checkpoints, three runs | Block-specific effects | Deployment reuse with current safety checks |
| --- | ---: | ---: |
| Header RPC items | 210 | 350 |
| Bytecode RPC items | 20 | 12 |
| Contract-call RPC items | 70 | 7 |
| Total RPC items | 300 | 369 |
| Median fixture duration | 4.347 s | 4.364 s |

This PostgreSQL-effect fixture restarts its Envio loader at every checkpoint and charges every RPC item 10 ms, including headers. The additional canonical checks supersede the earlier 229-request immutable fixture: current total items increase by 23.0%, while contract calls decrease by 90.0%. Timing is effectively flat in this paired run (about 0.4% slower); it is not a latency win. Real eRPC header cache hits have different costs, so provider savings require separate upstream counters. Raw evidence: [automatic immutable fixture](indexer-rpc-automatic-immutables-2026-10-31.json).


## Deterministic ownership and registry events

Ownership facts stay in the existing ContractRelationship database entities. Explicit implementation profiles cover Solmate Owned, OpenZeppelin Ownable v4/v5, OpenZeppelin Ownable2Step, Chainlink ConfirmedOwner and CCIP TokenAdminRegistry. A profile describes full-contract mutation behavior and binds to an exact runtime; importing an ownership library or exposing a similarly named event does not establish eligibility.

The enabled source-reviewed bindings are Ethereum CoolerV2Migrator and CCIPCrossChainBridge (Solmate), plus TokenAdminRegistry on Ethereum, Optimism, Base and Arbitrum. OZ profiles and transfer/renunciation/two-step semantics are implemented and tested, ready for a reviewed OZ runtime binding. No currently tracked verified OZ deployment was found, so no production binding was invented.

Each configured field seeds through an actual canonical getter whose runtime evidence matches its profile. Subsequent ownership, token administrator and pool changes come from subscribed HyperSync events. Transfer requests do not change the accepted owner; acceptance and renunciation clear pending state correctly. Token-scoped registry state is isolated. Private Chainlink pending owner remains unknown until its relevant events are replayed.

The field must have all required subscriptions in the active chain config. Removing a subscription strips eligibility even for persisted proofs. Unknown implementations, unproven runtime, getter-only coverage, changed policy versions and backward reads use ordinary getters. Reused state refreshes referenced code and rechecks seed/current canonical headers outside Envio effect memoization. Event-derived values retain their event provenance; they are marked unperformed with an explicit reason rather than claiming a fresh RPC match at an older block.

A controlled production-reader fixture over ten quiet checkpoints reduced getter operations from ten to one and total RPC items from 69 to 42 (39.1% fewer), including target-code refresh and canonical checks. This is fixture evidence, not a new live indexing rate. Regression tests cover OZ v4/v5 transfers and renunciation, OZ2 acceptance, constructor/truncated seeds, registry token isolation, subscription removal, restart, manual entity rollback and canonical races.

To add a reviewed implementation, add its source/runtime proof to implementations and its chain/address binding to contracts in src/generated/ownership-read-proofs.json. Subscribe the address under Owned for OZ/Solmate or ChainlinkOwned for ConfirmedOwner; TokenAdminRegistry requires its registry subscription too. The common Owned subscription includes OwnershipTransferStarted for OZ2. Metadata must expose and verify the relevant getters; modified/upgradeable implementations retain ordinary reads until their complete mutation and upgrade behavior is supported.

## Actual indexing replay of this follow-up

The repeat used real HyperSync events and configured upstream providers, fresh disposable PostgreSQL and eRPC databases for each run, the same Ethereum range 26,240,000–26,290,000, unchanged 10,000-block checkpoints and the same finite 50-credit eRPC cap. Neither candidate was deployed. Baseline e206f72 already contains the previous performance milestones; candidate production code is bc44616. All 109 sampled indexer/config files matched the final working tree.

| Repeat, 50,001 blocks | Already optimized baseline | This follow-up |
| --- | ---: | ---: |
| Wall time | 173.718 s | 174.323 s |
| Committed blocks/second | 287.8 | 286.8 |
| Indexer-to-proxy RPC items | 22,077 | 24,355 |
| Upstream RPC requests, including health checks | 4,353 | 4,107 |
| Upstream eth_call | 3,426 | 3,097 |
| HyperSync events processed | 523 | 523 |
| Relationships | 579 | 579 |
| Unavailable relationships | 2 | 2 |

This is effectively flat indexing speed (0.35% longer), 5.65% fewer upstream requests and 9.60% fewer upstream contract calls. Extra canonical checks increase proxy RPC items by 10.32%; most header requests hit eRPC's cache. All 577 relationships available in both runs have identical semantic fields. The two unavailable private pending-owner getters remain unavailable in both. One candidate relationship is explicitly event-derived, with unperformed RPC verification, instead of claiming a fresh match. Both databases committed the end block, reported ready and exited successfully. Candidate recovered 35 local budget rejections; upstream outcome counters recorded no provider-capacity/transport error outcome. This does not establish account-wide Alchemy quota compliance.

The candidate made 91 real source requests, all HTTP 200, with 3.220 seconds of summed fetch time. Its database persisted 23 discovered immutable descriptors and 54 no-eligible-getter decisions. These requests are to the source service, not Alchemy. Their summed time can overlap other work and is not an additive wall-time cost.

A preliminary pair measured 179.967 to 194.271 seconds (277.8 to 257.4 blocks/second), with the same semantic results and 5.72% fewer upstream requests. That candidate overlapped validation builds and its 91 source fetches took 44.498 seconds in aggregate. It is retained as evidence of timing variability, not an isolated speed estimate. The repeat had no concurrent validation builds, but public source-service caches and network conditions remained uncontrolled. There is no demonstrated incremental whole-indexer speed gain from this follow-up, nor a measured warm steady-state gain. Both attempts and source fingerprints are in the [replay artifact](indexer-rpc-followup-replay-2026-10-31.json).

The earlier 39.2% throughput increase versus the original base remains a separate historical result. Comparing this run directly to that earlier baseline would mix measurement windows and is not a new paired improvement claim.

## Validation and remaining limits

The final scripts/validate.sh run passed all nine required steps in order using Node 24.22.1 and pnpm 11.28.7. The indexer suite passed 100 tests; strict indexer typechecking and offline code generation passed. An initial build failure exposed an overstrict cross-chain batch-packing assertion; the test now checks actual coalescing while the separate deterministic benchmark still checks exact packing. A later sandbox run stopped at Docker step 6 on a buildx filesystem permission; the complete sequence passed after rerunning with filesystem access.

The actual patched eRPC/PostgreSQL integration passed: 17 cache rows persisted across restart, nine production dependency-reader cases covered both empty and encoded bounds reverts through viem, and recovery worked. A mixed-method/chain burst of 160 items admitted exactly 20 upstream requests under a 20-credit budget and returned 140 capacity errors. Database reset checks were explicitly skipped. These provider responses are controlled fixtures; the indexing replay above uses real upstreams.

Eight review lenses completed with no actionable findings. Manual entity rollback/restart and fork races are covered; a real Envio reorg dispatch/rollback remains untested. Source-outage whole-checkpoint latency remains unmeasured, including the potential 30-second source wait. See the [validation artifact](indexer-rpc-followup-validation-2026-10-31.json).

Fresh Trivy scans used the existing ignore policy without changes. eRPC passed with no unsuppressed MEDIUM/HIGH/CRITICAL findings. The rebuilt indexer image still has the same 23 MEDIUM OS advisories in the unchanged Debian base, no HIGH/CRITICAL findings, no language-package vulnerabilities and no secret findings. Its vulnerability-threshold scan therefore exits 1; the repository build validation is green, but this security scan is not all-clear. No dependencies, frontend code or ignore entries changed.

All commits remain local and unsigned as requested. The original worktree is clean at its supplied base. No push, PR update, deployment, existing database reset, live variable change or worker isolation occurred.
