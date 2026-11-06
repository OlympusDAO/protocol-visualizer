# AGENTS

## Validation Skill

When asked to validate this repository, run `pnpm validate`. It calls `./scripts/validate.sh`, which executes these commands in order:

1. `pnpm run check:runtime-versions`
2. `pnpm install --frozen-lockfile`
3. `pnpm run lint:check`
4. `pnpm --filter @protocol-visualizer/snapshot-artifacts run build`
5. `pnpm run openapi:check`
6. `pnpm run build`
7. `pnpm run snapshots:generate:local`
8. `pnpm run container:build:indexer`
9. `pnpm run container:build:frontend`
10. `pnpm run container:build:snapshot-gateway`
11. `pnpm run container:build:snapshot-publisher`

If a command fails, stop and report the first failure with actionable context.

Invoke `pnpm validate`, `pnpm run container:build` (all seven images), and individual `pnpm run container:build:<image>` scripts as standalone commands. Avoid shell wrappers, pipes, environment prefixes and output redirection so reusable command approvals can match. Capture output through the execution tool instead.

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
