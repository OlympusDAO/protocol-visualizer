# AGENTS

## Validation Skill

When asked to validate this repository, run these commands in order:

1. `pnpm run check:runtime-versions`
2. `pnpm install --frozen-lockfile`
3. `pnpm run lint:check`
4. `pnpm run build`
5. `pnpm run docker:build:indexer`
6. `pnpm run docker:build:frontend`

If a command fails, stop and report the first failure with actionable context.

## Runtime Version Rules

- Node version must align across `package.json` (`engines.node`), `.nvmrc`, `.node-version`, GitHub Actions setup, and Dockerfiles.
- pnpm version must align across `package.json` (`packageManager` and `engines.pnpm`) and Dockerfiles.
