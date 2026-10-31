# Getter reuse and transport follow-up

This work extends the local performance branch. Checkpoint frequency, HyperSync ingestion and finite eRPC/provider protection remain unchanged. The [paired HyperSync replay](indexer-rpc-indexing-sample-2026-10-31.md) remains the recorded actual indexing comparison: 201.7 to 280.8 committed Ethereum blocks/second. The fixtures below answer narrower questions and must not be added to that replay's percentages.

## Viem retry scheduling and HTTP batching

The shared RPC boundary now uses viem's exported `withRetry` instead of a handwritten retry loop. The existing eight-active-operation guard, 256-waiter queue, six total proxy attempts, jittered exponential delay and sanitized exhaustion exception remain. Permits are released while waiting between attempts. eRPC retains upstream retry and aggregate rate ownership. Native HTTP and outer transport retry counts stay zero, so retry layers are not accidentally multiplied.

The classifier now recognizes JSON-RPC capacity codes 429 and -32007 alongside the existing proxy codes. A regression first failed on the raw JSON-RPC 429 response, then passed with the policy update. Historical-state failures and legitimate reverts remain terminal. Error-chain inspection checks that fixture credentials and private URLs do not escape exhaustion.

HTTP batching was already enabled and remains enabled with no extra collection delay. A partial batch regression proves that one capacity-limited item retries without resending its seven successful siblings. Cross-chain tests verify batching while respecting eight in-flight operations; exact batch packing depends on event-loop scheduling.

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

## Automatic immutable getter discovery

New contracts no longer need a hand-written immutable getter list. Normal contract metadata processing, the metadata refresh command and the runtime getter path use verified compiler artifacts. Solidity's immutableReferences identify PUSH operands; the compiler source map binds them to public immutable declarations in hash-checked source files. Zero-argument address-returning ABI selectors must match those declarations. This also supports inherited/interface declarations with the public immutable override form. The Sourcify API does not expose the needed AST, so the implementation uses its compiler source maps and immutable references directly. No compiler executable or package dependency was added to the indexer.

Both the actual CoolerV2Migrator artifact (seven getters) and a separately compiled AddedImmutable contract (TOKEN getter, different runtime/address) establish automatic discovery without an address allowlist. The existing generated Cooler descriptor was produced by that same detector. Production code no longer imports the old one-contract deployment manifest; it remains test/benchmark evidence.

An uncatalogued runtime gets one shared source-discovery effect keyed by chain, address and observed runtime hash, limited to five calls per second. Eligible descriptors and verified no-eligible-getter decisions persist. HTTP 404, transport and server failures do not persist, so a later source verification can be discovered on a subsequent batch/restart. Envio coalesces same-input discovery within a batch. Source discovery has cold network/CPU cost and is separate from provider RPC limits.

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
