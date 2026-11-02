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
pnpm exec node scripts/benchmark-indexer-robinhood.mjs --env-file .env --provider-profile local-private
pnpm exec node scripts/benchmark-indexer-robinhood.mjs --check
```

This fixed profile runs three cold trials per revision in alternating order, with identical benchmark-side capacity recovery and the unchanged aggregate 50-credit cap. It writes the standard `docs/performance/indexer-benchmark-robinhood-{baseline,candidate,comparison}.json` artifacts. A percentage requires complete repeatable results, an equal canonical event manifest, fresh getter oracles and explicit proof checks for every admitted provenance difference. Private full-state diagnostics must remain available for `--check`; they stay in ignored `benchmarks/` directories.

Use the accepted comparison artifact, rather than manually dividing unrelated rates. Name the queued recovery profile in PR text and distinguish equal verified business state from identical physical proof records. Do not use this narrow profile for a different config/schema change without reviewing its equivalence contract prospectively and rerunning both sides.

## Include comparisons in the branch PR

When PR publication or updating is authorized, include an **Indexer benchmark** section in that branch's PR body. Use its actual base revision and candidate source fingerprint, not a remembered branch name. Include the generated comparison table, sample/profile details, exact artifact links and any caveats about state, coverage, throttling or source latency. Commit the standard result and any freshly generated baseline artifact before linking them.

Preserve the rest of the PR description. Update the existing benchmark section rather than accumulating duplicate reports. Use a structured API body or `gh pr edit --body-file` with the complete intended body; do not interpolate multiline reports into shell commands.

Use repository-relative artifact links and portable commands in PR text. Omit personal filesystem paths, private environment-file locations and diagnostic paths.

If the task forbids PR writes, prepare the comparison locally and report its location. This skill does not authorize a push, PR creation/update or deployment beyond the user's current instructions. If no valid baseline can be produced, state that limitation in the proposed PR text instead of inventing a gain.
