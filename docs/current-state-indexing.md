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

Performance evidence for this milestone is pending the separate current-state
benchmark. The old exact-20-table profile remains unchanged and cannot certify
this intentional schema/observation-policy change.
