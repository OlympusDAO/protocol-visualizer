# Current-state indexing

The visualizer needs current protocol state. Routine historical getter sweeps are
replaced by full verification at catch-up and bounded live refreshes.
HyperSync event processing remains necessary to reconstruct current memberships,
roles, ownership and dynamically discovered contracts. eRPC caching, provider
protection and canonical block checks remain.

## Milestone 1: remove the raw-call effect layer

Commit `d3f84c8` removes the 75-line raw-call cache/client wrapper, its 100-line
feature test and obsolete raw-cache assertions in the PostgreSQL suite. Three
domain readers use the existing shared RPC client. No replacement abstraction,
dependency or schema entity was added. Domain effects, hash pins, bounded client
concurrency/retries and the finite 100-credit eRPC cap are unchanged.

One cold scout per revision used the fixed Berachain 780,011–1,530,001 profile:
749,991 blocks and 7,610 events, one process, two PostgreSQL connections, identical
images/metadata and fresh disposable databases. Baseline: `31f32ee`.

| Metric | Parent | Without raw-call effect |
| --- | ---: | ---: |
| Committed time | 79.309s | 73.714s |
| Blocks/second | 9,456.6 | 10,174.4 |
| Proxy requests | 4,265 | 4,317 |
| Upstream requests | 2,527 | 2,581 |
| Upstream `eth_call` | 1,949 | 2,001 |

All 20 exact table digests matched. Both runs completed and cleaned up. Neither
recorded capacity rejections or rate-limit outcomes; missing optional counters
do not prove spare provider capacity. The 230 call failures per run were
execution reverts. All nine ordered validation steps passed. Astra reviewed
correctness and Ponytail reviewed simplification.

The observed throughput difference is +7.59%, but these single scouts establish
feasibility only. Shared provider traffic and source-service latency remain
uncontrolled. No repeatable speedup is claimed. The deletion increases proxy
traffic by 1.22% and upstream traffic by 2.14%; eRPC cannot replace every
block-hash cache hit when finality is unknown. Keeping the smaller read path is
a code-maintenance decision with this measured traffic trade-off.

Raw results remain private, outside tracked source. Their SHA-256 hashes will
accompany the completed comparison. Historical benchmark protocols still require
their original exact state/provenance equality; they are not relaxed to accept
the subsequent schema and observation changes.

## Milestone 2: current observations and a smaller schema

Historical 10,000-block callbacks no longer sweep getters. Creation callbacks
only initialize the core contracts born at that boundary, after constructor
logs. A bounded replay performs a full observation at its exact endpoint. An
unbounded run retains the 100-block cadence, observes only within 99 blocks of
the current RPC head, and skips older callbacks after one head lookup. This also
works before native readiness in the final cold backfill batch. Preload does not
advance eligibility. A stationary, nonaligned tip can wait for the next cadence
block; Envio exposes no public transactional catch-up callback.

Full observations read getters, dependencies and target bytecode at the canonical
block. Cross-block deployment/immutable and Kernel reuse are removed, together
with their compiler proof pipeline and generated descriptors. The raw-call layer
was already removed in milestone 1. Verified ABI/NatSpec preparation, runtime-hash
binding, exact block-hash bytecode effects, eRPC caching, bounded retries and
provider admission remain. Ownership events still maintain current state between
observations, including Solmate, OZ and Chainlink dialects; a full observation
always checks their readable getters again.

The native schema has **12 entities instead of 20 (40% fewer)**. Removed tables:
`ActionExecutedEvent`, `ContractEvent`, `KernelExecutorEvent`, `RoleEvent`,
`ContractStateSeed`, `VerifiedDeployment`, `KernelReadEpoch`, and `KernelReadCache`.
The first five had no runtime readers. `ControlTransition` remains necessary for
event deduplication and pool discovery. Current `seed`, `lastChange` and provenance
fields remain necessary for ordering, rollback checks and honest presentation.
This incompatible schema requires an explicitly approved rebuild on deployment;
no existing database was reset for this work.

Only the top-level completed canonical observation writes a versioned
`ChainObservation`. Birth initialization and individual reader families cannot
mark the entire chain complete. The publisher requires native readiness plus a
recent canonical marker, checking its header/hash/timestamp and head distance
through the private proxy. Missing, stale, future, orphaned or old-version markers
withhold publication. A complete observation is a canonical attempt across all
families: unsupported getters and mismatches remain visible rather than being
relabeled successful. The freshness check precedes uploads; it is not an atomic
check at manifest promotion.

Native Envio fixtures exercise bounded and cold near-head callbacks, exhausted
429 recovery, fork rejection without committed partial state, and resuming the
same block. A real disposable PostgreSQL test verifies current entities, marker
rollback, chain isolation and three process lifetimes. Publisher checks cover
missing/stale/version/fork/capacity failures. All nine ordered validation steps passed. The rebuilt indexer image loads every
handler with networking disabled, and the real patched eRPC/PostgreSQL integration
passes its three checks. Trivy reports no unfixed medium/high/critical findings
under the existing ignore policy. OpenAPI consistency and final lint pass. The
image import fixture uses development configuration defaults; the separate
controlled startup/reset integration exercises the deployed image configuration.
These fixtures do not establish live nine-chain throughput.

The final performance comparison uses the actual Robinhood base `9eb4755`, not
the recent optimization commits. That base has 17 entities; this milestone has
12 (29.4% fewer). The 20-to-12 count above describes the preceding performance
iteration. Earlier raw-call scouts remain diagnostic only.

The accepted Robinhood-base comparison below measures this intentional
schema/observation-policy change. The old exact-20-table profile remains unchanged
and cannot certify current-only indexing.

## Simplification review before publication

Astra reviewed correctness and Ponytail reviewed unnecessary complexity. The
follow-up removes 2,566 net lines: unused compiler-proof fixtures, the superseded
Robinhood auditor/comparator, and obsolete `verifiedAt` plumbing. The retired
auditor imported removed caching modules. Its historical results and source refs
remain available; new comparisons use the current-state command.

Fresh getter and dependency results can no longer supply an older verification
block. Full observations record their actual block. The regression check also
rejects the effect of an injected legacy reuse annotation.

| Decision | Reason and remaining cost |
| --- | --- |
| Remove cross-block immutable/deployment and Kernel reuse | Current-only verification removes most repeated sweeps. Deployment lifetime, custom proxy and event-invalidation assumptions no longer justify a separate reuse system. New contracts receive fresh reads; immutable detection is no longer a runtime optimization. |
| Remove the raw-call effect layer | eRPC and existing domain effects already cache calls. The earlier scout recorded a small traffic increase after deletion; maintenance simplicity justified keeping the smaller path. |
| Keep block-hash bytecode/domain effects | Their cache identity and opening/closing canonical checks protect against forks. Failures do not become reusable successful observations. |
| Keep bounded RPC recovery and HTTP batching | They cap private-proxy pressure and prevent exhausted capacity reads from being committed as missing values. Long outages can still exhaust recovery and require restart. |
| Keep the two-subject scheduler | It overlaps independent I/O while preserving same-address ordering and draining sibling work on failure. No generic worker scheduler is added. |
| Keep ownership dialects and proof provenance | OZ, Solmate and Chainlink have different pending-owner semantics; some nominees have no public getter. This is now correctness/provenance code, not a getter-saving claim. Readable getters are checked at every full observation. |
| Keep metadata prefetch/cache and admission | Source-service quotas remain independent of RPC capacity. Metadata admission depends on Envio's internal worker description and the pinned maximum of four workers. Recheck that compatibility on Envio upgrades or topology changes. |

The static review found no demonstrated correctness blocker in the retained
runtime. It did not attribute the whole-branch timing gain to individual retained
optimizations. Earlier worker gains used historical sweeps; they do not establish
a current-only worker benefit. The matched primary replay uses one process.

One remaining liveness limit is a deep head regression below the remembered live
eligibility threshold. Verification can wait until callbacks reach that threshold
again. Publisher freshness/canonical checks withhold stale publication. A quiet,
nonaligned tip can also wait for the next 100-block callback. These are freshness
delays, not evidence that an older cached value becomes a new RPC observation.

## Kernel rollback follow-up

A focused follow-up reproduced an inherited rollback bug in the process-local
current-module map. Envio restored the canonical entity, but the map returned the
discarded fork's module. Module lookups now use native entity reads directly.

Five Kernel/policy effects now persist by canonical block hash, including creation
seeds. Event-derived reads must match the event hash; all reads pass opening and
closing canonical checks. Versioned effect names isolate old height-only cache
entries. The permissions process cache and historical-to-latest fallbacks are
removed. Missing or invalid KEYCODE cannot create an `UNKNOWN` module identity.

Required reads now fail closed if the provider lacks the requested archive state
or EIP-1898 hash support. They do not substitute latest state. This can expose a
provider capability gap that the previous fallback concealed; an archive-capable
private upstream is required to resume those historical handlers. Transport
retry/backpressure remains separate and unchanged.

The getter-admission scout held eRPC at 100 credits/second and changed only the
getter effect from 35 to 100 calls/second. The two cold runs took 26.023s and
24.516s respectively, with identical 12-table digests, 902 proxy requests, 898
upstream requests and no exhausted recovery. This single-pair result did not
clear the predeclared 10% qualification threshold; it does not establish a gain.
The getter limit is restored to 35. Bytecode remains 25/s, dependency/bridge
effects 10/s, metadata 5/s, client admission 10 active/256 queued with six attempts,
and eRPC 100 aggregate credits/s. No live budget was changed. The 100/s treatment
was not retained or promoted to a worker holdout.

## Robinhood-base benchmark

The earlier accepted numbers below predate the Kernel pinning follow-up. Refresh
the comparison against the actual Robinhood base before publishing this follow-up.

The [accepted generated result](performance/indexer-current-state-comparison.json)
compares Robinhood base `9eb4755` with candidate `1178165`. Protocol v4 uses three
cold replays per revision in A/B, B/A, A/B order over Ethereum
26,240,000–26,290,000 inclusive: 50,001 blocks and 14 canonical logs. Both sides
use HyperSync, one process, two PostgreSQL connections, identical images/providers,
100 aggregate eRPC credits/second and the same bounded queued-recovery fixture.
Waiting counts toward elapsed time; independent oracle RPC happens afterward.

| Median | Robinhood base | Current branch |
| --- | ---: | ---: |
| Committed time | 167.843s | 25.272s |
| Blocks/second | 297.9 | 1,978.5 |
| Requests reaching eRPC | 20,383 | 896 |
| Upstream requests, including health probes | 10,491 | 897 |

Throughput improved **564.16% (6.64×)**; elapsed time fell **84.94%**. Requests
reaching eRPC fell **95.60%**, and upstream requests fell **91.45%**. These are
whole-branch results, not separate causal estimates for each retained optimization.
Base times were 181.619s, 167.843s and 166.869s; candidate times were 25.541s,
24.573s and 25.272s. Every candidate was faster than every base trial.

All six audits passed, canonical logs matched, and each revision repeated its
exact entity contents. The candidate has 12 current tables versus the base's 17.
Native processed counts differ intentionally: 509 scheduled callbacks plus 14
logs on the base, versus two callbacks plus 14 logs on the candidate. Getter
observations, seeds and archive work are deliberately reduced; this is not equal
historical work. The [protocol](performance/indexer-current-state-protocol.md)
defines the narrow provenance differences that passed independent checks.

The audit checked 579 relationships, including two explicitly unavailable private
Chainlink nominees supported only by observed events or an unknown null value.
One pre-window Kernel executor record retains its creation-time value and
configured timestamp. Fresh creation and endpoint reads expose the differing
endpoint executor and 1,200-second timestamp discrepancy. That initialization
record is compared exactly and excluded from endpoint-state certification.

No run exhausted recovery. The baseline fixture recorded 11, seven and four
capacity retries; the candidate recorded none. Candidate optional proxy-capacity
counters were absent, so this is not proof that Alchemy never throttled or had
spare capacity. The real eRPC/Postgres tests separately exercise 429 recovery,
exhaustion, two-provider failover, reverts and aggregate mixed-method budgeting.

This bounded cold fixture does not establish full-history, live nine-chain,
current-only worker or provider-billing improvements. The four-chain current-only
holdout was not run. Existing deployments need an explicitly approved database
rebuild for the smaller schema; only disposable fixture databases were reset.

The nine ordered validation steps, 45 focused checks, three real-image
eRPC/Postgres integration tests and the fresh Trivy scan under the existing CI
policy passed. Astra and Ponytail reviewed the implementation and simplification.
Local CodeRabbit review was retried but rejected Git-provider
authentication; its local auth-status check alone was insufficient.

The measured runtime-input fingerprint is
`63e35286b0831d4590c4ccc4d2e817abdcd56929cf956d250ab8396a23e059b8`.
Later documentation/evidence commits retain this fingerprint. The generated
result records trial hashes and image/runtime identities. Reproduce with
`pnpm benchmark:indexer:current --baseline 9eb4755be2904f6751a72890ecce134c4c701fef --env-file .env --provider-profile local-private`.
