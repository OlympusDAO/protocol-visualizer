# AGENTS

## Validation contract

Use the canonical [validation commands, prerequisites and policy](docs/validation.md). Invoke scripts unchanged with tool-level cwd/output/polling; do not add wrappers, redirection, tee or environment prefixes merely to manage output.

Before committing run `pnpm validate`; before requesting a push run `pnpm validate:all`. Stop at the first failed command and report it before independent diagnostics. Missing tools/images/databases fail; required integration cannot skip reset isolation. Source validation has no Docker dependency.

Scripts save command/log/exit/timing/revision receipts under ignored `.validation/`. Native test/scanner output is evidence; receipts do not reconstruct test counts, inventory or scanner reports. Report counts/policy/skips from actual output and blockers. Never call unrun images, excluded fixtures or live checks passed. Historical detailed receipts remain historical.

## History and publication

Ask before rewriting, collapsing, discarding or publishing history, including rebase, reset, push and PR actions. Before creating/describing commits or pushing, run the privacy-gate skill and stop on findings. Never bypass hooks. Before PR operations use github-account; before pushing/updating PRs also use coderabbit-local-review. Publication and live infrastructure apply require explicit approval.


## Indexer Benchmark

For indexing or RPC performance changes, use the [Protocol Visualizer benchmark skill](skills/protocol-visualizer-benchmark/SKILL.md). `pnpm benchmark:indexer` writes the standard branch result to `docs/performance/indexer-benchmark.json`; `pnpm benchmark:indexer:compare BASE_REF` compares current results. Follow the skill's criteria for when to run and include comparisons in an authorized branch PR. Local-only tasks prepare evidence without publishing it.

After removing historical sweeps/archive entities, use `pnpm benchmark:indexer:current --baseline BASE_REF --env-file .env --provider-profile LABEL`. It writes the current-state comparison to `docs/performance/indexer-current-state-comparison.json`. Use the actual PR base ref; recent optimization commits are diagnostic controls.

## Runtime Version Rules

- Node version must align across `package.json` (`engines.node`), `.nvmrc`, `.node-version`, GitHub Actions setup, and Dockerfiles.
- pnpm version must align across `package.json` (`packageManager` and `engines.pnpm`) and Dockerfiles.
- `@types/node` should stay consistent across root and workspace packages that declare it.

## Service environment variables

Treat service environment variables as required unless the runbook explicitly
marks them optional and states their default or behavior when absent.
Validate required values at service startup before network or database requests.
Exit nonzero on missing or invalid configuration. Log the variable name or a
fixed diagnostic, never its value. Validate optional values when supplied.

## Image security policy

- Gate every owned image with native Trivy. The root `trivy.yaml` excludes unfixed vulnerabilities by default. Keep owned scan commands free of CLI overrides for this setting. Fixable vulnerabilities and secret findings at MEDIUM, HIGH and CRITICAL fail the gate, as do scan execution errors.
- Fix vulnerable packages, base images or configuration where practical. Any CVE exception requires explicit user approval and a comment documenting the affected package, installed version and rationale. Use a native `.trivyignore` entry in the form `ID exp:YYYY-MM-DD`. Remove the entry when fixed. Trivy enforces the expiration.
- Keep provider advisories separate. Include unfixed vulnerabilities in vulnerability-only reports, return zero for findings and fail on scan execution errors. Report local fixture exclusions, unrun scans and historical results distinctly from current passes.

## Maintenance conventions

- Configure Dependabot daily with `open-pull-requests-limit: 0`: security updates only, no routine version-update PRs.
- Schedule weekly image security scans for Monday at 00:00 UTC.
- Write documentation as the current repository contract; avoid temporary phrases such as “this branch”.
- Keep Markdown table cells unpadded to avoid alignment-only churn.
- Use the existing Biome package.json sorting action for manifest keys.

## Package commands and indexer monitoring

- Name repository commands action-first: `dev:indexer`, `start:indexer`,
  `build:docker:indexer`, `scan:docker`, `plan:railway`, and `check:openapi`.
  Keep native package-manager lifecycle names such as `pretest` unchanged.
  Update every tracked caller when renaming a command; do not retain duplicate aliases.
- Run the repository-level `pnpm lint` for formatting and manifest sorting.
- Keep the indexer monitor in `apps/indexer-monitor`, with its own compiled
  TypeScript app and dedicated non-root Docker image. Use the same pinned Alpine
  multi-stage `pnpm --filter indexer-monitor deploy --prod /deploy` packaging;
  do not include the indexer runtime or development tools in its production image.
- Give the monitor its own private `monitor-state` bucket and native bucket
  credential references. Keep alert state separate from application artifacts.
- Discord routing uses the actual Railway environment name: exactly `production`
  selects the production service webhook and omits the environment label; every
  other named environment requires the preview webhook and keeps its name.
  Do not add production-ID or renamed-environment exceptions to Discord routing.
  Preserve the documented explicit local mode when Railway identity is absent.

## Error reasons

Give thrown errors meaningful, nonempty reasons. Use fixed descriptions or
configuration names; never include credentials or private request values.
The existing Biome checks enforce `suspicious/useErrorMessage` as an error
within their configured source scopes. This policy also applies to scripts
outside those scopes; do not add empty messages to satisfy the rule.

## Infrastructure release eligibility

Use the same visible CI labels across the indexing repositories: `Release images
and integration`, `Dependency audit`, `<service> image`, and `Railway infrastructure
apply`. Preserve job IDs and gate ordering when changing display names.

When CI automatically applies infrastructure, keep event, ref, repository and
merged-commit eligibility checks inline in the workflow. Checked-out scripts
must not grant their own apply eligibility. Gate later helpers on the eligibility
output and keep provider credentials behind the required status checks.
Production IaC applies inside the same CI workflow after source, image/integration
and required external checks. Fail closed for direct or untrusted production
pushes. Do not automatically cancel production workflows or active applies.
Keep Railway GitHub sources on `checkSuites: true`; verify live Wait for CI before
activation. Native apply can itself trigger builds, so use compatible staged
service changes. Preserve separately approved database reset/rebuild procedures.
Manual maintenance apply still requires explicit operator approval.
