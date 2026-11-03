---
name: protocol-visualizer-benchmark
description: Run the Protocol Visualizer indexer's standardized HyperSync benchmark, compare branch results, and prepare benchmark evidence for its PR after indexing or RPC performance changes.
---

# Protocol Visualizer indexing benchmark

Use the repository command and protocol below. Keep implementation milestones, correctness tests and benchmark evidence separate. A fixture microbenchmark does not establish whole-indexer throughput.

## When to run

Run after changes that can affect indexing work or throughput: handlers, getter scheduling, RPC transport or budgets, effects, reusable facts, entity storage, chain/event configuration, or indexer dependencies. Run before a PR containing these changes is prepared for publication. Do not rerun for documentation or unrelated frontend edits unless requested.

Reuse a completed result only when its runtime-input fingerprint still matches the branch and its measurement conditions are suitable. If timing boundaries, normalization rules or fixture semantics change, version the protocol and rerun both sides; do not relabel older measurements.

## Prepare outside the timed run

- Activate the repository-pinned Node and pnpm versions. Install frozen dependencies and follow `AGENTS.md`'s ordered validation when required; benchmarking does not replace it.
- Build `protocol-visualizer/rpc-cache:local` and ensure `postgres:17-alpine` is available before timing. Use the same immutable fixture images for baseline and candidate. The indexer is the component under test; proxy changes need their own controlled validation.
- Provide `ENVIO_API_TOKEN`, `ETHERSCAN_API_KEY` and all nine `UPSTREAM_RPC_URL_<chain>` variables through the environment or a private `--env-file`. Use a nonsecret `--provider-profile` label to identify equivalent provider conditions. Do not fetch or change live variables automatically.
- Benchmark committed snapshots. The runner exports a ref without switching branches or modifying the original worktree. Matching dependencies can be reused; `--install-deps` performs an isolated frozen install when the target lockfile differs. Never silently run a ref against another ref's dependencies.
- Keep builds, other benchmarks and heavy tests out of the timing interval. The runner creates and cleans only its own disposable containers, databases and source copies; never reset an existing database to prepare a benchmark.
- For metadata preparation changes, commit the generated artifact before replay and record preparation coverage and its separate cost. Do not download metadata concurrently with replay; allow source-service quota windows to recover before controls. Record metadata HTTP statuses. Refreshed documentation or proof provenance can change stored state; keep strict comparison withheld when equality fails, even if fresh oracles validate the differences.

## Run and compare

The standard profile uses Ethereum blocks 26,240,000–26,290,000 inclusive, HyperSync events, 10,000-block application observations and an aggregate 50-credit eRPC budget. Native batch size is read from the selected source configuration and recorded as application tuning. Keep the provider profile, images, runtime and event workload equal across comparisons.

```sh
pnpm benchmark:indexer --env-file .env --provider-profile local-private
```

This runs three fresh cold replays and atomically writes **`docs/performance/indexer-benchmark.json`**. Failed or interrupted runs must remain failed/running records, not stale passing evidence. Private diagnostics stay in ignored `benchmarks/` directories and do not belong in a commit or PR.

For an exploratory single run, pass `--runs 1` and call it a scout. Confirm a proposed performance gain with repeated matched runs. Use `--start` and `--end` for a separately identified state-change holdout; never compare different ranges as one workload.

If a base ref has no standard result, run it through the same driver:

```sh
pnpm benchmark:indexer --ref BASE_COMMIT --env-file .env --provider-profile local-private --output docs/performance/indexer-benchmark-baseline.json
pnpm benchmark:indexer --env-file .env --provider-profile local-private
pnpm benchmark:indexer --compare docs/performance/indexer-benchmark-baseline.json
```

When the base branch already has a current standard result:

```sh
pnpm benchmark:indexer:compare BASE_REF
```

The comparison must reject incompatible protocols, stale source fingerprints, incomplete progress, changed event coverage or changed shared entity/provenance contents. It may identify new or removed cache tables separately. Only policy-function ordering has a declared semantic normalization; every other array and verification block remains significant. Do not override a withheld comparison with a success percentage.

Report median committed time and blocks/second, sample count, request counts, capacity/retry behavior and source-service variation. Cached proxy traffic is not upstream traffic or provider billing. Explicitly distinguish cold, warm-state, holdout and synthetic fixture results. Include any unmet target or validation limit.

## Equal-work Robinhood-base comparison

For the performance branch's actual Robinhood base, read the [versioned acceptance protocol](../../docs/performance/indexer-robinhood-benchmark-protocol.md). The old reader can advance after failed RPC reads, and the new reader deliberately retains different proof provenance. Keep the strict v1 result withheld when its criteria fail.

```sh
pnpm exec node scripts/benchmark-indexer-robinhood.mjs --env-file .env --provider-profile local-private --output-prefix benchmarks/indexer-benchmark-robinhood
pnpm exec node scripts/benchmark-indexer-robinhood.mjs --check --output-prefix benchmarks/indexer-benchmark-robinhood
cp benchmarks/indexer-benchmark-robinhood-comparison.json docs/performance/indexer-benchmark-robinhood-comparison.json
```

This fixed profile runs three cold trials per revision in alternating order, with identical benchmark-side capacity recovery and the unchanged aggregate 50-credit cap. The commands above write detailed audit artifacts into the already-ignored `benchmarks/` directory, then copy the accepted comparison to the standard published summary path. Commit that summary and report the raw files' SHA-256 digests. A percentage requires complete repeatable results, an equal canonical event manifest, fresh getter oracles and explicit proof checks for every admitted provenance difference. Both local audit artifacts and private full-state diagnostics must remain available for `--check`.

Use the accepted comparison artifact, rather than manually dividing unrelated rates. Name the queued recovery profile in PR text and distinguish equal verified business state from identical physical proof records. Do not use this narrow profile for a different config/schema change without reviewing its equivalence contract prospectively and rerunning both sides.

## Include comparisons in the branch PR

When PR publication or updating is authorized, include an **Indexer benchmark** section in that branch's PR body. Use its actual base revision and candidate source fingerprint, not a remembered branch name. Include the generated comparison table, sample/profile details, exact artifact links and any caveats about state, coverage, throttling or source latency. Commit the standard result and any freshly generated baseline artifact before linking them.

Preserve the rest of the PR description. Update the existing benchmark section rather than accumulating duplicate reports. Use a structured API body or `gh pr edit --body-file` with the complete intended body; do not interpolate multiline reports into shell commands.

Use repository-relative artifact links and portable commands in PR text. Omit personal filesystem paths, private environment-file locations and diagnostic paths.

If the task forbids PR writes, prepare the comparison locally and report its location. This skill does not authorize a push, PR creation/update or deployment beyond the user's current instructions. If no valid baseline can be produced, state that limitation in the proposed PR text instead of inventing a gain.

## Native worker comparison

Use `--native-workers 1`, `2` or `4` for the separate `protocol-visualizer-native-workers-v2` profile. It fixes four 20,001-block ranges: Ethereum 26,240,000–26,260,000; Arbitrum 516,540,000–516,560,000; Base 52,850,000–52,870,000; Optimism 158,450,000–158,470,000. The command rejects custom ranges and the Ethereum-only getter oracle in this mode.

```sh
pnpm benchmark:indexer --native-workers 1 --ref BASE_COMMIT --env-file .env --provider-profile local-private --output benchmarks/native-parent.json
pnpm benchmark:indexer --native-workers 4 --env-file .env --provider-profile local-private --output benchmarks/native-four.json
pnpm benchmark:indexer --output benchmarks/native-four.json --compare benchmarks/native-parent.json
```

Start with single-run scouts for 1/2/4 configurations. Confirm any proposed winner with repeated alternating baseline/candidate trials. Do not run builds or other replay trials concurrently.

The shared fixture remains one eRPC with aggregate 50-credit protection and the production client retry/concurrency boundary, without the old Robinhood compatibility adapter. PostgreSQL budgets are 2/4/8 connections; Envio selects one process, two workers or four workers respectively. Multiple workers add a supervisor process. This is a coupled configuration comparison, not a constant-database-concurrency experiment. Metadata limits also vary as documented in [the experiment](../../docs/envio-native-workers.md).

Worker treatment stays outside the common workload fingerprint. Only the explicit `disable_default_cross_chain` declaration is excluded from the native profile's workload configuration hash, allowing the shared-storage parent as the one-process baseline. The complete source configuration hash and storage scope remain recorded. Two/four-worker configurations require native storage. Entity contents, every verification block, all selected chain completion rows and per-chain event counts must still match exactly under the existing policy-function ordering rule.

The probe writes one private file per process. Acceptance requires the actual supervisor/worker counts and valid CPU/RSS records. Report **sum of process peak RSS** as an upper bound, not simultaneous peak memory. Results prove only these bounded replay windows; do not extrapolate to full-history indexing, independent restart isolation, multiple replicas or higher Alchemy account capacity.

### Separate finite-capacity experiment

Only when a higher local cap is authorized, add `--rpc-credits 50` or `--rpc-credits 100` to select `protocol-visualizer-native-capacity-v1`. This changes the disposable eRPC container only. Normal native-worker protocol v2 still requires 50 credits/second.

```sh
pnpm benchmark:indexer --native-workers 1 --rpc-credits 50 --ref BASE_COMMIT --env-file .env --provider-profile local-private --output benchmarks/capacity-50.json
pnpm benchmark:indexer --native-workers 1 --rpc-credits 100 --ref BASE_COMMIT --env-file .env --provider-profile local-private --output benchmarks/capacity-100.json
pnpm benchmark:indexer --ref BASE_COMMIT --output benchmarks/capacity-100.json --compare benchmarks/capacity-50.json --compare-capacity
```

Use the same runtime revision and worker treatment on both sides. The capacity comparison permits only the recorded 50→100 budget difference; it rejects changed runtime, worker count, images, provider profile, workload, event counts or entity contents. Ordinary comparison continues to reject unequal budgets. Do not call a capacity gain a worker speedup, change live variables, or infer that Alchemy's account allowance increased. Check capacity/error counters and whether the real client completed after retries.

For a worker comparison at an approved 100-credit cap, use `--rpc-credits 100` on both sides and ordinary `--compare`, without `--compare-capacity`. Hold the source revision and prepared metadata fixed while varying `--native-workers`. This measures worker configuration, including its database and metadata-admission differences; it does not isolate the schema migration against an older shared-storage revision.
