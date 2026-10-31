# AGENTS

## Validation Skill

When asked to validate this repository, run `./scripts/validate.sh`. It executes these commands in order:

1. `pnpm run check:runtime-versions`
2. `pnpm install --frozen-lockfile`
3. `pnpm run lint:check`
4. `pnpm run build`
5. `pnpm run snapshots:generate:local`
6. `pnpm run docker:build:indexer`
7. `pnpm run docker:build:frontend`
8. `pnpm run docker:build:snapshot-gateway`
9. `pnpm run docker:build:snapshot-publisher`

If a command fails, stop and report the first failure with actionable context.

## Indexer Benchmark

For indexing or RPC performance changes, use the [Protocol Visualizer benchmark skill](skills/protocol-visualizer-benchmark/SKILL.md). `pnpm benchmark:indexer` writes the standard branch result to `docs/performance/indexer-benchmark.json`; `pnpm benchmark:indexer:compare BASE_REF` compares current results. Follow the skill's criteria for when to run and include comparisons in an authorized branch PR. Local-only tasks prepare evidence without publishing it.

## Runtime Version Rules

- Node version must align across `package.json` (`engines.node`), `.nvmrc`, `.node-version`, GitHub Actions setup, and Dockerfiles.
- pnpm version must align across `package.json` (`packageManager` and `engines.pnpm`) and Dockerfiles.
- `@types/node` should stay consistent across root and workspace packages that declare it.

## Trivy Ignore Policy

- Do not add new CVEs/packages to `.trivyignore` when a practical remediation exists (package update, base image update, or config change).
- If no practical remediation exists, ask for explicit user approval before adding to `.trivyignore`.
- Every `.trivyignore` entry must document the affected package and installed version.
