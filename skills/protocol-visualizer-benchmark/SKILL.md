---
name: protocol-visualizer-benchmark
description: Run the Protocol Visualizer indexer's standardized HyperSync benchmark, compare branches, and prepare indexing-performance evidence for an authorized PR update.
---

# Protocol Visualizer indexing benchmark

## When to run

Run after changes to handlers, observation scheduling, RPC transport/budgets,
effects, entity storage, chain configuration or indexer dependencies, before
publishing a performance claim. Documentation-only changes do not need a replay.
Reuse a result only when its runtime fingerprint and measurement conditions still
apply. Proxy changes need separate controlled validation; never attribute an old
measurement to a new proxy image.

## Prepare

- Use the repository-pinned Node/pnpm and frozen dependencies. Follow `AGENTS.md`
  validation; a benchmark does not replace it.
- Build `protocol-visualizer/rpc-cache:local`; make `postgres:17-alpine` available.
  Use identical immutable proxy/database images for both revisions.
- Supply `ENVIO_API_TOKEN`, `ETHERSCAN_API_KEY` and the nine
  `UPSTREAM_RPC_URL_<chain>` variables through an authorized private env file.
  Do not print credentials or fetch/change live variables without authorization.
- Benchmark committed snapshots. The runner exports refs without switching the
  original checkout. The current-state campaign requires matching lockfiles.
  Only the lower-level driver supports `--install-deps`; do not pass that option
  to `benchmark:indexer:current` or reuse another revision's dependencies.
- Keep builds, metadata downloads and other heavy checks outside timing. The
  runner resets only its own disposable databases. Commit prepared metadata
  before timing and report preparation cost separately.

## Current-state comparison

Read the [acceptance protocol](../../docs/performance/indexer-current-state-protocol.md)
when running or interpreting this comparison. Use the actual PR base, not a recent
optimization commit. For the Robinhood PR:

```sh
pnpm benchmark:indexer:current --baseline 9eb4755be2904f6751a72890ecce134c4c701fef --env-file .env --provider-profile local-private
```

This runs three cold trials per revision in ABBAAB order, Ethereum
26,240,000–26,290,000 inclusive, HyperSync events, one process, two PostgreSQL
connections and 100 aggregate eRPC credits/s. Both revisions receive the same
bounded queued-recovery fixture. Waiting counts toward committed completion;
independent oracle reads happen afterward.

The standard file is **`docs/performance/indexer-current-state-comparison.json`**.
The first baseline trial qualifies the campaign before any candidate starts.
Running/failed status replaces stale passing output. Keep trial states, logs,
audits and failed runs in ignored `benchmarks/`; commit only the compact accepted
result and maintained protocol. Do not add experiment reports for each scout.

The auditor requires complete durable progress, matching canonical logs,
per-revision repeatability, readable current values and the protocol's explicit
provenance exceptions. Removing historical sweeps intentionally changes callback
counts and archive work; never claim equal historical coverage.

`--scout --output benchmarks/current-qualification.json` is an optional baseline
qualification. A single-ref diagnostic uses the lower-level driver:

```sh
pnpm benchmark:indexer --current-state --oracle-ref BASE_COMMIT --runs 1 --env-file .env --provider-profile local-private --output benchmarks/current-scout.json
```

Scouts are diagnostics, not a PR speed percentage. Use `--profile four-chain
--output benchmarks/current-four-chain.json` on the current-state command for the
one-process holdout, keeping refs, providers, images and cap unchanged.

## Other profiles

The lower-level `pnpm benchmark:indexer` and `benchmark:indexer:compare BASE_REF`
commands retain historical equal-work protocols. Their default result is
`docs/performance/indexer-benchmark.json`; they do not certify the current-state
schema. Do not compare their percentages with the current-state report.

Native-worker and capacity modes are experimental controls. Follow
[worker configuration and limits](../../docs/envio-native-workers.md), qualify a
protocol for the current schema, and hold all non-treatment settings fixed.
Report changed database connections and metadata allocation with worker counts.
A local proxy-cap change does not increase a provider's account allowance.

## PR reporting

For an authorized PR update, include the actual base/candidate refs, median
committed time and blocks/s, trial count, proxy/upstream requests, retry outcomes
and validation status. Include current-state versus historical-work differences,
explicit audit exceptions and unrun holdouts. Link the accepted standard result
and [readable comparison](../../docs/current-state-indexing.md).

Do not invent a percentage when comparison is withheld. A local bounded replay
does not establish live multichain speed, full-history performance, independent
worker recovery or provider billing savings. RPC requests reaching eRPC differ
from requests billed upstream. Local-only tasks prepare evidence without
publishing; this skill grants no additional push, PR or deployment authority.
