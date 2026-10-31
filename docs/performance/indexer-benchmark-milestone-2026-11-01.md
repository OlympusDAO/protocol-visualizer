# Standard indexing benchmark

`pnpm benchmark:indexer` exports a committed source revision, runs three cold Ethereum replays in disposable PostgreSQL/eRPC instances, and writes `docs/performance/indexer-benchmark.json`. The standard profile covers blocks 26,240,000–26,290,000, preserves HyperSync and the 10,000-block checkpoint interval, and holds eRPC at 50 aggregate credits/second.

`pnpm benchmark:indexer:compare BASE_REF` reads the standard result from another ref. `pnpm benchmark:indexer --compare FILE` supports a baseline measured through the same driver when that ref predates the command. Both reject incompatible inputs, incomplete progress, changed event counts, stale runtime fingerprints, or different shared entity values and verification provenance. Policy-function ordering is the only declared semantic normalization; added cache tables are reported separately.

The driver records actual source, dependency, native-batch, runtime and image identities. Matching installed lockfiles permit dependency reuse; explicit `--install-deps` prepares an isolated frozen install outside timing. Diagnostics are private and ignored. Public results contain counters and digests, without provider URLs, calldata or provider-authored errors. Unavailable mandatory metrics fail the measurement rather than becoming zero traffic.

The [repository skill](../../skills/protocol-visualizer-benchmark/SKILL.md) defines when to benchmark and how to include comparisons in an authorized branch PR. It is linked from `AGENTS.md`; no global skill is installed. `./scripts/validate.sh` selects the installed nvm runtime pinned in `.node-version` and runs all nine required checks through one reusable command.

Twelve focused benchmark checks and the complete nine-step validation passed. Astra reviewed the stage in an existing high-effort advisor context after fresh sessions hit the agent limit; all three findings were fixed and re-reviewed. Ponytail removed unused state and required dependency-free atomic result invalidation. Actual replay measurements follow this tooling milestone; the command itself makes no runtime speed claim. The separate approved 8→10 active-request experiment still needs measurement.

All changes and evidence remain local. No PR, push, deployment, existing database reset or live-variable change is part of this milestone.
