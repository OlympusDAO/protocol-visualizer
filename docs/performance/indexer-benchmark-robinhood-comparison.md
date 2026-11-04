# Indexing performance against the Robinhood base

Three cold replays per revision over 50,001 Ethereum blocks measured **142.7% higher median throughput (2.43×)** and **58.8% less completion time** against Robinhood base `9eb4755`.

| Median | Robinhood base | Candidate |
| --- | ---: | ---: |
| Committed blocks/second | 177.9 | 431.7 |
| Durable completion | 281.051 s | 115.825 s |
| Application RPC items before fixture recovery | 20,376 | 6,003 |
| Requests reaching eRPC, recovery included | 20,883 | 6,127 |
| Upstream requests, probes included | 10,504 | 4,319 |

Proxy requests fell **70.7%** and upstream requests fell **58.9%**. These request counts do not establish Alchemy compute-unit or billing savings.

Both revisions used the same bounded queued-recovery fixture, aggregate 50-credit cap, Node 24.22.1, pnpm 11.28.7, lockfile and immutable proxy/database images. HyperSync, native 5,000-block batches, 10,000-block checkpoints and 100-block real-time observations stayed unchanged. Queue waits count toward elapsed time. Trials alternated base/candidate/candidate/base/base/candidate over Ethereum blocks 26,240,000–26,290,000.

Baseline times were 281.051, 279.691 and 281.366 seconds; candidate times were 117.664, 115.825 and 115.248 seconds. Every run completed 523 indexed items, reached readiness, exited normally and exhausted zero recovery requests.

Acceptance checked repeatable state, 579 relationships, 599 historical seeds, the same 14 canonical logs, 97 deployment facts and ten Kernel cache facts. Two source-proven private pending-owner getters remain explicit exceptions; the other 577 relationships were checked through fresh base production readers. Physical proof records intentionally differ and were individually audited. The oracle bypasses indexer effects and entities but shares eRPC; strict v1 output identity is not claimed.

This is one historical Ethereum range with few relevant state changes, not a live multichain, long-run storage or existing-database upgrade result. External network/source-service variation remains uncontrolled. Three new entity tables need a reviewed migration or reindex plan before an existing deployment adopts the schema. Missing or inconclusive reuse proofs fall back to reads.

The measured candidate `fdbaaf8` has runtime-input fingerprint `02e7efbb15e6f75573f5993b312ac9e1f5ed36f388f73eac42c01bad88f6a5f1`. Later documentation, CLI, fixture and benchmark-history cleanup changes retain that indexer fingerprint. [Accepted summary](indexer-benchmark-robinhood-comparison.json) records exact revisions, medians and acceptance hashes; the [protocol](indexer-robinhood-benchmark-protocol.md) defines equivalence.

The nine ordered validation steps, 17 focused benchmark checks and patched eRPC/PostgreSQL integration passed. Local integration leaves database resets disabled. CI additionally verified the disposable reset fixture after correcting its stale Docker port and cache-row baseline.

The commands used for this historical result live at tooling commit `002988c`.
The current branch has retired that auditor and its removed-cache dependencies.
For new measurements, use `pnpm benchmark:indexer:current`; see the
[current-state protocol](indexer-current-state-protocol.md).

Detailed baseline/candidate audits and full-state diagnostics stay under the existing ignored `benchmarks/` directory and were required for the historical `--check` command. Raw artifact SHA-256: `96c4fdabe3e2b74c4a38c12f341cfdf4f7af6641d40f47d5b588481bd86e0023` (baseline), `b60571098ead32cb9106e953d656ec14365dab15c0a2706c2d966e7bffc9f008` (candidate). The [repository skill](../../skills/protocol-visualizer-benchmark/SKILL.md) defines when to benchmark and publish comparisons.
