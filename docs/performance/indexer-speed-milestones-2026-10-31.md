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

## Verified deployment code in entity state

VerifiedDeployment is a regular Envio entity. It binds chain/address to the creation block/hash, runtime hash, proof version and original verification block. A successful hit avoids code/source RPCs and the effect loader. Native effect contexts and unproven deployments keep exact block-hash effects.

Ordinary deployment discovery is independent of immutable getter discovery. Empty-parent code, exact ordinary runtime at creation and canonical creation/current anchors establish eligibility. Delegate execution, selfdestruct, delegation/EOF, proxies, empty code and precreation requests cannot become lifetime facts. Referenced target code needs its own proof. Missing provenance, wrong identity/version or orphaned anchors take the exact proof path.

Public code reads and getter source verification now use the entity path. Cold Kernel verification forwards the already verified source hash into its getter effect. Module verification includes the observation height. Conclusive unsafe/proxy/no-immutable decisions persist; incomplete compiler/source proof and outages remain retryable. Metadata accepts an additive ordinary deployment descriptor without invalidating otherwise valid older metadata entries.

| Controlled public code-reader fixture, ten checkpoints | Exact block-specific code | Deployment entity |
| --- | ---: | ---: |
| Code RPC items | 10 | 3 |
| Header RPC items | 30 | 50 |
| Total RPC items | 40 | 53 |
| Calls through the effect interface | 10 | 3 |

The three code reads establish current code, empty parent and creation runtime. Subsequent hits enter no effect. Code reads fall 70%, but total items rise 32.5% while repeated numeric canonical checks remain. No latency or whole-indexer speed gain is claimed for this intermediate stage. The next milestone shares those checks within a validated observation phase. [Fixture counts](indexer-speed-deployment-state-2026-10-31.json).

Initial regressions failed before implementation. Eight deployment tests now cover persistence/restart, simulated entity rollback, identity/provenance rejection, deployment boundaries, forks, empty target code, source recovery and negative-cache persistence. The public code-reader regression also demonstrated effect entry before wiring and zero entry on a verified entity hit afterward. The integrated focused suite passed 36 tests; strict typechecking passed.

Astra reviewed this stage, identified three remaining performance bypasses and a malformed-provenance fallback issue, then reviewed their fixes with no remaining actionable findings. The fixes were applied; its independent eight-test rerun passed. Ponytail and five simplification lenses retained existing helpers and every safety check, removed four narrating comments, and declined a cold metadata micro-optimization that would widen the proof API.

The ordered validation first stopped on two lint warnings, which were corrected without weakening tests. The next run passed steps 1–5 and stopped on Docker buildx filesystem permissions. The complete sequence restarted with approved access and passed all nine steps. Strict typechecking also passed. This stage's unit fixtures adapt entity/effect storage; real PostgreSQL replay/schema evidence is recorded in the later integrated measurement.

## Shared canonical observation phases

Each checkpoint/seed invocation now owns an explicit phase. It fetches a fresh opening header, shares each distinct numeric-height header inside that invocation, and freshly rechecks every used historical anchor before checking the current block last. Final checks run in groups of four. Missing, malformed or changed headers, swallowed lookup errors and incomplete completion callbacks abort the handler. Preload and execution use separate phases; no phase enters an effect key, persisted result or ambient async context.

Persisted getter effects now return hash-bound facts. Their public outer reader performs canonical acceptance and independently classifies target code through the deployment entity path. Standalone pinned-reader APIs keep their original before/after checks. The duplicate canonical-code effect wrapper was removed: code facts already have a 25-call/second effect limit, and the public code reader still checks canonical acceptance. The eight-active/256-waiter guard, all remaining leaf limits and eRPC's shared 50-credit cap remain unchanged.

The phase callback must explicitly complete. Failed preflights and the previously ignored expanded-relationship failure now throw instead of returning normally. Envio's existing write frontier supplies atomic entity commit; no extra write buffer was introduced. Hash-bound effects may persist independently, but they do not represent accepted canonical observations.

Proof-first reader tests reduced twelve header requests to two for repeated getter/code observations in one phase. Standalone readers still request fresh acceptance headers. A separate source/target entity fixture first demonstrated an unnecessary target code read, then passed with zero code RPCs and six header checks covering current, source creation and target creation anchors. Twelve phase tests cover isolation, valid current/historical fork hashes, missing/malformed headers, swallowed failures, transient identity and over 256 anchors without overflowing the RPC queue.

The actual EventHandlers and native Envio TestIndexer processing/write machinery were also exercised. A fork injected only at execution's final current-header check rejected the batch; committed ChainObservation, ContractState, ContractRelationship, KernelReadCache, VerifiedDeployment and ControlTransition tables remained identical to their initial snapshot. Stable retry of the same block committed successfully. This uses Envio's memory storage adapter; persisted effect caches and real PostgreSQL rollback are separate evidence. The checkpoint is 26,294,068 because Envio's intervals are relative to Mainnet's configured start, not absolute multiples of 10,000.

Astra reviewed the phase and found no production correctness issue. Its test finding was corrected: historical fork tests now use valid alternate 32-byte hashes. Ponytail retained one explicit phase wrapper and one internal fact/observation mode, avoiding a second transaction layer or ambient cache. Five simplification lenses found only two redundant internal comment blocks, which were removed; every proof test and trust check remains. Module/bridge inner checks remain until measurement justifies more changes.

All 125 indexer tests, strict typechecking and all nine ordered validation steps passed. The sandbox attempt stopped at Docker step 6; the complete sequence then passed with approved buildx access. The whole-indexer measurement follows after this commit, with no builds running alongside it.

The phase retains the existing provider-finality assumption: eRPC can permanently cache numeric headers the provider declared finalized. Unfinalized fork fixtures prove phase rejection; these checks do not establish protection against a finalized-chain reversal. Native onBlock callbacks expose only height, so opening RPC headers and existing event-provenance anchors retain the prior HyperSync/RPC synchronization boundary.
