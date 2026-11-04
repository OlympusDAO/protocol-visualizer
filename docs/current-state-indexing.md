# Current-state indexing

The visualizer needs current protocol state. Routine historical getter sweeps are
being replaced by full verification at catch-up and bounded live refreshes.
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

## Remaining work

Remove obsolete cross-block deployment/Kernel proof reuse and write-only history
entities. Replace broad creation/checkpoint sweeps with necessary initialization
and complete catch-up/live verification. Gate publication on a committed full
verification and measure the final current-state workload under a new explicit
acceptance protocol.
