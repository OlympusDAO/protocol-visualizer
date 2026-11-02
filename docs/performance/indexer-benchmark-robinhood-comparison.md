# Indexing comparison against the Robinhood base

The candidate delivers **142.7% higher median throughput (2.43×)** and **58.8% less completion time** against actual Robinhood base `9eb4755be2904f6751a72890ecce134c4c701fef`. This is a controlled, equal-work Ethereum replay under the shared queued-recovery v2 profile. It is not a live deployment result.

| Median metric, three cold runs per revision | Robinhood base | Performance candidate |
| --- | ---: | ---: |
| Durable completion time | 281.051 s | 115.825 s |
| Committed blocks/second | 177.9 | 431.7 |
| Application RPC items before fixture recovery | 20,376 | 6,003 |
| Requests reaching eRPC, including recovery | 20,883 | 6,127 |
| Upstream requests, including proxy probes | 10,504 | 4,319 |
| Fixture capacity retries | 507 | 124 |
| Exhausted fixture requests, every run | 0 | 0 |
| Indexed items, every run | 523 | 523 |

Proxy requests fell **70.7%** and upstream requests fell **58.9%**. These are request counts, not Alchemy compute units or billing measurements. The individual cache layers' speedups are not additive; this comparison measures their combined effect.

## Revisions and measurement conditions

The measured candidate is `fdbaaf8e6650d0e66480a87d954c0221f4bb9633`, with runtime-input fingerprint `02e7efbb15e6f75573f5993b312ac9e1f5ed36f388f73eac42c01bad88f6a5f1`. It has the same indexer runtime as `4198a0a`; subsequent metadata-CLI and documentation fixes do not change that fingerprint. Baseline fingerprint: `a339da04431450b9c9cb113ce349af42b32f67b259bc56b170f1ecddae794901`.

Six fresh cold replays ran in order **base, candidate, candidate, base, base, candidate**. Each covered Ethereum blocks **26,240,000–26,290,000 inclusive**, using HyperSync events, native 5,000-block batches and unchanged 10,000-block checkpoint / 100-block real-time schedules. Node 24.22.1, pnpm 11.28.7, lockfile, provider profile and immutable eRPC/PostgreSQL images matched. Only disposable local resources were created and removed; no existing database was reset.

Baseline durations were **281.051, 279.691 and 281.366 seconds**; candidate durations were **117.664, 115.825 and 115.248 seconds**. Every candidate finished faster than every baseline. Throughput gain is `100 × (baseline median time / candidate median time − 1)`; time reduction uses the baseline duration as its denominator.

The base reader can advance after capacity failures, leaving unavailable observations. A benchmark-side relay therefore gives both revisions the same bounded capacity recovery, preserving original HTTP batches and retrying only rejected members. Its waiting time is included in elapsed time. The eRPC aggregate cap stays at 50 unit credits/second; no direct-provider bypass or live limit change was used. This fixture is not a production retry-policy change to the base.

## Why the results are comparable

Acceptance requires repeatable full state within each revision and equal verified business values across revisions. Both post-timing audits checked **579 relationships**, including two source-proven private pending-owner getters without public getter functions, plus **599 historical seed values** at their actual boundaries. The other 577 relationships were checked through fresh base production readers, including complete dependency scans. These reads bypass indexer effects and entity caches but share eRPC; they are not independent-provider observations.

Independent canonical log queries found the same **14 logs** for both native workloads: ten registry logs concern other tokens, with no effective dynamic registration. The candidate's added ownership topic contributes zero logs in this range. Both native subscriptions and block-handler schedules are checked; the configuration difference is recorded rather than erased.

Physical proof records intentionally differ. Acceptance explicitly validated 74 immutable provenance/seed moves, 87 Kernel verification differences, six ownership replay proofs, seven coverage annotations and three added target-code annotations. It also validated all **97 deployment facts** and **10 Kernel cache facts**. Reused facts retain their actual verification blocks; unknown fields, changed values, missing history and unproven differences fail acceptance. The existing strict v1 comparator remains unchanged and withheld for this pair.

The saved-artifact acceptance check passes. Additional negative probes reject stale baseline refs, stale candidate runtimes, stale acceptance implementations and exhausted recovery. `--check` verifies stored state/audit evidence; it does not repeat external oracle calls.

## Limits and remaining work

This is one historical Ethereum range with few relevant state changes, not a nine-chain production, long-run storage or existing-database upgrade test. External service and network variation remain uncontrolled. Candidate source-service request durations summed 21.207, 3.843 and 45.075 seconds; requests overlap, so those sums are not additive wall-time components. The earlier native-profile 404.7 blocks/s result and its missed 430.2 target remain historical evidence; this different recovery profile does not retroactively change them.

Three new entity tables require a separately reviewed migration or reindex plan before an existing deployment can adopt the schema. Event reuse remains limited to proven implementations and complete subscriptions. Unknown or incomplete proofs fall back to reads. No per-chain workers or live provider-budget increases were deployed.

CodeRabbit's first pass reported four minor findings. Two evidence-wording defects and metadata CLI startup were fixed; its follow-up found one historical limit reference, now explicitly marked historical. A reviewed performance follow-up remains: complete immutable proofs with no eligible public address getter are not persisted as negative discoveries. They can repeat source-service work after eviction or restart; getter correctness still falls back safely. Incomplete proofs must remain retryable, so broadly caching every negative result would be unsafe.

The nine ordered validation steps, 17 focused benchmark checks and actual patched eRPC/PostgreSQL integration passed before measurement. Publication validation passed all nine steps again after formatting the metadata CLI fix; its first attempt stopped at step 3 for that formatting issue. The real proxy fixture verifies cache restart persistence, nine dependency-reader error cases, capacity recovery and aggregate mixed-method/chain admission; existing-database reset checks were explicitly skipped. Local image scans using the October 31 vulnerability database found no HIGH/CRITICAL or secrets; the indexer retains 24 MEDIUM and nine LOW findings, while eRPC has one LOW and six UNKNOWN findings. No ignore entry was added.

The first PR CI run exposed a fixture-only failure when resuming eRPC after the rate-limit probes: Docker had reassigned its ephemeral host port, while the test polled the old URL. The fixture now refreshes that mapping and exercises resume even with database resets disabled. Its separate reset assertion also takes a fresh cache-row baseline after the intervening cacheable probes. These test changes do not change the measured indexer runtime or benchmark acceptance implementation; full database-reset checks remain outside local validation.

## Reproduce and inspect

```sh
./scripts/validate.sh
pnpm exec node scripts/benchmark-indexer-robinhood.mjs --env-file .env --provider-profile local-private --output-prefix benchmarks/indexer-benchmark-robinhood
pnpm exec node scripts/benchmark-indexer-robinhood.mjs --check --output-prefix benchmarks/indexer-benchmark-robinhood
cp benchmarks/indexer-benchmark-robinhood-comparison.json docs/performance/indexer-benchmark-robinhood-comparison.json
```

The [versioned protocol](indexer-robinhood-benchmark-protocol.md) defines acceptance. The committed [accepted comparison](indexer-benchmark-robinhood-comparison.json) records source fingerprints, medians, acceptance implementation and common-state digest. Detailed baseline/candidate audit files and full-state diagnostics remain local and ignored; all are required for `--check`. Their SHA-256 digests are `96c4fdabe3e2b74c4a38c12f341cfdf4f7af6641d40f47d5b588481bd86e0023` (baseline) and `b60571098ead32cb9106e953d656ec14365dab15c0a2706c2d966e7bffc9f008` (candidate). The [repository skill](../../skills/protocol-visualizer-benchmark/SKILL.md) defines when to benchmark and how to report evidence in the PR.
