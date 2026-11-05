# Current-state indexing

The visualizer needs current protocol state. Routine historical getter sweeps are
replaced by full verification at catch-up and bounded live refreshes. HyperSync
still supplies events to reconstruct memberships, roles, ownership and discovered
contracts. eRPC, provider protection and canonical block checks remain.

## Observation and storage

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
is also removed. Verified ABI/NatSpec preparation, runtime-hash
binding, exact block-hash bytecode effects, eRPC caching, bounded retries and
provider admission remain. Ownership events still maintain current state between
observations, including Solmate, OZ and Chainlink dialects; a full observation
always checks their readable getters again.

The schema has **12 entity types versus the Robinhood base's 17**. Historical
archive rows and cross-block reuse tables are removed. `ControlTransition`
remains for event deduplication and pool discovery; current seeds, event changes
and verification provenance remain for ordering, rollback and presentation.
The incompatible schema requires an explicitly approved database rebuild.

Only the top-level completed canonical observation writes a versioned
`ChainObservation`. Birth initialization and individual reader families cannot
mark the entire chain complete. Envio's native readiness is the publisher's
catch-up authority. The publisher separately checks the completed marker's
exact canonical block number, hash, timestamp and verification version through
the private proxy. Missing, orphaned or old-version markers and unavailable
blocks withhold publication. It does not query the latest head or impose a
second block-age limit. A complete observation is a canonical attempt across all
families: unsupported getters and mismatches remain visible rather than being
relabeled successful. Canonical validation precedes uploads; it is not an atomic
check at manifest promotion.

## Decisions and limits

| Decision | Reason and remaining cost |
| --- | --- |
| Remove cross-block immutable/deployment and Kernel reuse | Current-only verification removes most repeated sweeps. Deployment lifetime, custom proxy and event-invalidation assumptions no longer justify a separate reuse system. New contracts receive fresh reads; immutable detection is no longer a runtime optimization. |
| Remove the raw-call effect layer | eRPC and existing domain effects already cache calls. Deletion trades a small increase in proxy traffic for a simpler read path; eRPC cannot absorb every hash-bound call when finality is unknown. |
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
again. A quiet, nonaligned tip can also wait for the next 100-block callback.
Observation scheduling is separate from publication readiness: the publisher
trusts Envio's catch-up decision and validates the marker's canonical integrity.
An older observation keeps its actual verification block.

## Kernel rollback and canonical reads

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

The getter effect remains 35/s. A single 35→100 scout improved throughput by
about 6%, below its 10% qualification threshold, so the higher limit was rejected.
Bytecode effects remain 25/s, dependency/bridge effects 10/s, and metadata 5/s.
The client allows 10 active requests, 256 queued requests and six attempts;
eRPC uses 100 aggregate credits/s. These finite budgets do not increase provider
account allowances. Long outages can exhaust recovery and require a restart.

## Robinhood-base benchmark

The refreshed comparison includes the Kernel hash-pinning follow-up and the
restored 35/s getter limit.

The [accepted generated result](performance/indexer-current-state-comparison.json)
compares Robinhood base `9eb4755` with candidate `01dc547`. Protocol v4 uses three
cold replays per revision in A/B, B/A, A/B order over Ethereum
26,240,000–26,290,000 inclusive: 50,001 blocks and 14 canonical logs. Both sides
use HyperSync, one process, two PostgreSQL connections, identical images/providers,
100 aggregate eRPC credits/second and the same bounded queued-recovery fixture.
Waiting counts toward elapsed time; independent oracle RPC happens afterward.
Both revisions used the same recorded proxy image. The later pgx v5 security
migration has separate integration/security validation; these numbers do not
measure a speed change from that driver upgrade.

| Median | Robinhood base | Current branch |
| --- | ---: | ---: |
| Committed time | 170.550s | 25.035s |
| Blocks/second | 293.2 | 1,997.3 |
| Requests reaching eRPC | 20,385 | 902 |
| Upstream requests, including health probes | 10,491 | 898 |

Throughput improved **581.26% (6.81×)**; elapsed time fell **85.32%**. Requests
reaching eRPC fell **95.58%**, and upstream requests fell **91.44%**. These are
whole-branch results, not separate causal estimates for each retained optimization.
Base times were 169.592s, 170.866s and 170.550s; candidate times were 25.035s,
31.218s and 24.850s. Every candidate was faster than every base trial.

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

No run exhausted recovery. The baseline fixture recorded eight, nine and ten
capacity retries; the candidate recorded none. Candidate optional proxy-capacity
counters were absent, so this is not proof that Alchemy never throttled or had
spare capacity. The real eRPC/Postgres tests separately exercise 429 recovery,
exhaustion, two-provider failover, reverts and aggregate mixed-method budgeting.

This bounded cold fixture does not establish full-history, live nine-chain,
current-only worker or provider-billing improvements. The four-chain current-only
holdout was not run. Existing deployments need an explicitly approved database
rebuild for the smaller schema; only disposable fixture databases were reset.

The nine ordered validation steps, Kernel rollback/hash-pinning regressions,
three real-image eRPC/Postgres integration tests and the fresh Trivy scan under
the existing CI policy passed. Eighteen creation-block reads across all nine
configured chains also passed through a fresh local proxy using the actual private
upstreams; this was a read-only provider capability check, not a live indexing benchmark. Astra and Ponytail reviewed the implementation and simplification.
CodeRabbit was skipped at the user's request after repeated authentication failures,
including the normal interactive CLI command. Its auth-status check alone was insufficient.

The measured runtime-input fingerprint is
`e160ce413ef43a7fd8c5bd83d1a0d629d56d7033f0eddfecc6c920114bd179fd`.
Later documentation/evidence commits retain this fingerprint. The generated
result records trial hashes and image/runtime identities. Reproduce with
`pnpm benchmark:indexer:current --baseline 9eb4755be2904f6751a72890ecce134c4c701fef --env-file .env --provider-profile local-private`.
