# AGENTS

## Validation contract

Use the canonical [validation commands, prerequisites and policy](docs/validation.md). Invoke scripts unchanged with tool-level cwd/output/polling; do not add wrappers, redirection, tee or environment prefixes merely to manage output.

Before committing run `pnpm validate`; before requesting a push run `pnpm validate:all`. Stop at the first failed command and report it before independent diagnostics. Missing tools/images/databases fail; required integration cannot skip reset isolation. Source validation has no Docker dependency.

Scripts save command/log/exit/timing/revision receipts under ignored `.validation/`. Native test/scanner output and per-build IID files are evidence; receipts do not reconstruct test counts, inventory or scanner reports. Report counts/policy/skips from actual output, immutable IDs and blockers. Never call unrun images, excluded fixtures or live checks passed. Historical detailed receipts remain historical.

## History and publication

Ask before rewriting, collapsing, discarding or publishing history, including rebase, reset, push and PR actions. Before creating/describing commits or pushing, run the privacy-gate skill and stop on findings. Never bypass hooks. Before PR operations use github-account; before pushing/updating PRs also use coderabbit-local-review. Publication and live infrastructure apply require explicit approval.

## Crit reviews

For explicit Crit requests use crit-review for diff-mode, Tailscale and standing authorization preferences.

## Indexer Benchmark

For indexing or RPC performance changes, use the [Protocol Visualizer benchmark skill](skills/protocol-visualizer-benchmark/SKILL.md). `pnpm benchmark:indexer` writes the standard branch result to `docs/performance/indexer-benchmark.json`; `pnpm benchmark:indexer:compare BASE_REF` compares current results. Follow the skill's criteria for when to run and include comparisons in an authorized branch PR. Local-only tasks prepare evidence without publishing it.

After removing historical sweeps/archive entities, use `pnpm benchmark:indexer:current --baseline BASE_REF --env-file .env --provider-profile LABEL`. It writes the current-state comparison to `docs/performance/indexer-current-state-comparison.json`. Use the actual PR base ref; recent optimization commits are diagnostic controls.

## Runtime Version Rules

- Node version must align across `package.json` (`engines.node`), `.nvmrc`, `.node-version`, GitHub Actions setup, and Dockerfiles.
- pnpm version must align across `package.json` (`packageManager` and `engines.pnpm`) and Dockerfiles.
- `@types/node` should stay consistent across root and workspace packages that declare it.

## Trivy Ignore Policy

- Do not add new CVEs/packages to `.trivyignore` when a practical remediation exists (package update, base image update, or config change).
- If no practical remediation exists, ask for explicit user approval before adding to `.trivyignore`.
- Every `.trivyignore` entry must document the affected package and installed version.
