# Railway Self-Hosted Snapshot Architecture

This project runs the Envio indexer, private Hasura, private Railway Bucket,
snapshot publisher, snapshot monitor, public REST API, and frontend on Railway.
Hasura, the indexer, publisher, monitor, bucket, and cache use private networking.
Both databases remain private, without public TCP proxies. The only public
application services are `snapshot-gateway` and `frontend`.

The private RPC proxy and its independent Postgres are described in
[rpc-cache.md](rpc-cache.md), including variables, finality limits,
deployment order, and rollback. Provision those two resources before routing
consumers through the proxy.

## Infrastructure as Code

[`.railway/railway.ts`](../.railway/railway.ts) defines the whole project:
all seven application services, both databases, both volumes, the storage bucket,
production domains, and canvas groups. Both database image pins now target PG18.6;
the main database transition requires the separately approved [reset/reindex release](postgresql18-rebuild.md).
Volume names and production mount paths remain unchanged. IaC supplies service connections through Railway references.
Provider URLs and operator secrets use `preserve()`; their values stay in Railway.
Optional operator settings listed in `variables.ignore` remain outside IaC ownership.

| Resource                                           | Role                                                  |
| -------------------------------------------------- | ----------------------------------------------------- |
| `Postgres` / `destruction-volume`                  | Envio data and Hasura metadata; prepared PG18.6 reset |
| `rpc-cache-postgres` / `rpc-cache-postgres-volume` | Independent RPC cache; PG18.6, preserved data         |
| `hasura`                                           | Private GraphQL for publisher and monitor             |
| `indexer`                                          | Private Envio indexer                                 |
| `rpc-cache`                                        | Private JSON-RPC cache                                |
| `snapshot-publisher`                               | Hourly bucket publisher                               |
| `snapshot-monitor`                                 | Daily indexing monitor                                |
| `snapshot-gateway`                                 | Public REST API                                       |
| `frontend`                                         | Public UI                                             |
| `storage`                                          | Private snapshot bucket in `sjc`                      |

Both database volumes target 20,000 MB in production and previews. IaC reads
their live capacities and retains any existing capacity above this target.
This capacity policy never requests a shrink. It does not authorize the separate
main database reset; preserve the cache and existing larger volumes.
With `allowOnlineResize: true`, Railway normally expands the mounted filesystem
without downtime; a full volume can require an offline resize and restart.
See [Railway volume resizing](https://docs.railway.com/volumes/reference).
This change does not reset the database or remove cached effects. Review the
production plan and obtain approval before applying the resize.

The detached legacy `postgres-volume` is no longer declared. The cache uses
`rpc-cache-postgres-volume`. Removing the legacy declaration does not itself
clean up the live detached volume; any deletion requires a separate reviewed
operation. Preserve the attached database volumes during this capacity change.

## Bootstrap and migration

Use the repository-pinned native Railway CLI 5.75.0, Node and pnpm from this repository, and the
pinned Railway SDK installed by `pnpm install --frozen-lockfile`.

The local migration used Railway's `config migrate --show` preview and
`config pull --environment production --force --variables unmanaged` import.
The preview found no active legacy Config File settings. The import retained
storage and resource names; the repository's Docker, healthcheck, restart, and
cron settings were then moved into the IaC file. The legacy JSON files are removed.
Do not run `config pull --force` over the reviewed file during a normal rollout.

For each existing environment, check migration state before deploying this change:

```bash
railway link
railway config migrate status
```

Select the intended project and environment when linking. If the status lists
legacy file readers, use the reversible cutover command before deploying the
commit that removes those files:

```bash
railway config migrate cutover
```

That command changes live Config File settings and saves a local rollback
snapshot. It is separate from the filesystem-only `config migrate --apply`
generator. Keep the snapshot locally; `railway config migrate undo` restores
its settings if needed. Neither operation resets application databases.
The initial migration preparation did not run cutover, undo, or apply.
Cache deployment and recovery are documented in [rpc-cache.md](rpc-cache.md).

Verify the effective `ServiceInstance.railwayConfigFile` field after cutover.
In PR 84, CLI 5.71.0 reported no legacy readers, but six service instances still
referenced deleted `railway-*.json` files. Deployment failed at `SNAPSHOT_CODE`
before Docker started. Clear those paths in the target environment's service
settings, then read them back before retrying. The CLI's cutover mutation uses
an empty string; sending `null` leaves the old value unchanged. For a preview,
verify its `sourceEnvironment` and compare other environments before and after
the update. Do not clear production settings as part of preview recovery.

Before activating automatic production releases:

1. Create/configure the GitHub environment **`production`** with deployment branches explicitly limited to **`master`**. Configure repository/branch protection for reviewed merges and required source, image, dependency-audit and CodeQL checks; restrict bypasses, repository write/admin access and deployment permissions. For unattended releases, configure no required reviewer approvals; `deployment: false` is incompatible with custom deployment-protection apps. Master-only deployment branches and environment-only secrets remain required. A YAML environment reference does not establish these live protections.
2. Add **`RAILWAY_DEPLOY_TOKEN` only as a secret of that environment**, with the least Railway workspace/API privileges needed for this project. Do not create a repository secret with that name. Separately approve and remove the old repository **`RAILWAY_TOKEN`** secret before activation; the workflow never falls back to it. Existing GitHub secret values cannot be retrieved to copy them: supply the credential securely through the authorized operator process. No secret/environment/ruleset changes are performed by this source edit.
3. Provision and verify the private cache service and its separate database first.
4. Supply all nine `UPSTREAM_RPC_URL_<id>` values on `rpc-cache` and verify its `RPC_CACHE_DATABASE_URL` reference to `rpc-cache-postgres.DATABASE_URL`. Existing databases must have URL-safe passwords before applying this reference; see [the password policy](../.railway/README.md).
5. Preserve the other operator secrets listed below. Confirm the environment restrictions, secret placement and branch protections independently before enabling the token; repository code alone does not prove live settings or deployed privacy.

IaC supplies all nine consumer RPC URLs. The production rollout must wait until
the cache service passes private-network and provider checks. Otherwise, a whole-project
apply switches consumers to an unready proxy. Do not merge the automatic apply
workflow before this prerequisite is complete.

For a new environment, provision the cache resources first through a reviewed,
cache-only IaC plan or the Railway dashboard. Supply provider credentials manually
on `rpc-cache`. Configure its Dockerfile as `Dockerfile-rpc-cache`, its healthcheck
as `/healthcheck`, and its database references as shown in [rpc-cache.md](rpc-cache.md).
Verify the proxy before the whole-project apply routes consumers through it.

The scheduled/manual ABI sync runs only on `master` and declares the existing
GitHub `production` environment with `deployment: false`. Read-only verification
found no protection rules or deployment branch policy on that environment;
environment-secret migration remains **unperformed**. In addition to the Railway
setup above, an authorized administrator must securely provision `ETHERSCAN_API_KEY`
and all nine `ENVIO_RPC_URL_<id>` secrets used by `abis-sync.yml` in `production`.
Verify all ten names in that environment's secret list and a sync on `master`,
then remove their repository-scoped copies and verify another sync. A successful
sync before removal alone can use repository-secret fallbacks. Existing secret
values cannot be retrieved from GitHub; use the authorized credential source.
The source job condition does not prove environment-secret storage or live
restrictions.

## Automatic variables and manual secrets

| Destination          | Supplied by IaC                                                                                        | Manual values retained in Railway                                 |
| -------------------- | ------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------- |
| `rpc-cache`          | `PORT=4000`; `RPC_CACHE_DATABASE_URL` references `rpc-cache-postgres.DATABASE_URL`                     | Nine `UPSTREAM_RPC_URL_<id>` values; optional `RPC_CACHE_MAX_RPS` |
| `indexer`            | Nine `ENVIO_RPC_URL_<id>` paths through `rpc-cache`; Envio database and Hasura references; `PORT=9898` | `ENVIO_API_TOKEN`, `ETHERSCAN_API_KEY`; optional `ENVIO_RPC_MODE` |
| `snapshot-publisher` | Nine `RPC_URL_<id>` paths; bucket, Hasura, indexer metrics, and shared webhook references              | Shared `DISCORD_WEBHOOK_URL` value; optional operator overrides   |
| `snapshot-monitor`   | Nine `RPC_URL_<id>` paths; bucket, indexer metrics, and shared webhook references                      | Shared `DISCORD_WEBHOOK_URL` value; optional operator overrides   |
| `snapshot-gateway`   | Five bucket references; `PORT=8080`                                                                    | Optional operator overrides                                       |
| `hasura`             | Envio database reference; shared admin-secret reference; `PORT=8080`                                   | The shared `HASURA_GRAPHQL_ADMIN_SECRET` value                    |
| `frontend`           | HTTPS URL from `snapshot-gateway.RAILWAY_PUBLIC_DOMAIN`                                                | None for these connections                                        |

The bucket references use `storage.BUCKET`, `storage.ACCESS_KEY_ID`,
`storage.SECRET_ACCESS_KEY`, `storage.REGION`, and `storage.ENDPOINT`.
Railway resolves them separately in each environment. Do not copy bucket credentials
into source or frontend variables. The frontend receives only the public gateway URL.

`preserve()` retains an existing value. It does not generate a missing provider URL,
API token, or webhook. Supply required secrets in Railway before deploying the service.
The RPC cache fails clearly at runtime when a required upstream value is absent.
Builds and IaC evaluation do not need provider credentials.

Add `DISCORD_WEBHOOK_URL` once per environment in Project Settings → Shared Variables.
IaC sets both snapshot jobs to `${{shared.DISCORD_WEBHOOK_URL}}`; it does not create or overwrite the shared value.
Use a separate webhook for preview environments. Keep the URL out of source and frontend variables.
Add the shared value before generating the plan, then review and apply that plan to deploy the references.
Variable changes require a deployment to reach the jobs. Apply the staged changes to deploy the affected services together.
Both jobs require the webhook. Missing or blank values are logged as errors and
fail pre-deploy checks and job startup before network or storage access.
See [Discord notification examples](discord-notifications.md) for summaries, warnings, and deployment lifecycle messages.

The PR 82 bootstrap copied existing indexer provider URLs into the cache's upstream
variables through the authenticated CLI. It did not print or commit their values.
This bootstrap does not supply credentials to production or future environments.
Before any consumer switch, retain the previous provider values for rollback.

## SSH key registration

Use the repository-pinned native Railway CLI 5.75.0.
To use your personal login, unset local `RAILWAY_TOKEN` and `RAILWAY_API_TOKEN` values first.
Then sign in:

```bash
railway login
railway whoami
railway ssh keys list
```

If a suitable key already exists on your computer, register its public `.pub` file.
For a dedicated key, first make sure that these filenames do not already exist:

```bash
ls "$HOME/.ssh/id_ed25519_railway" "$HOME/.ssh/id_ed25519_railway.pub"
```

If both files are absent, create the key. Enter a passphrase when prompted:

```bash
ssh-keygen -t ed25519 -f "$HOME/.ssh/id_ed25519_railway" -C railway
```

Register only the public key with Railway:

```bash
railway ssh keys add --key "$HOME/.ssh/id_ed25519_railway.pub" --name railway-local
railway ssh keys list
```

Keep the private key on your computer. Do not put either key in repository files or Railway service variables.
Registration grants account-level SSH access. It does not deploy or restart services.
With a workspace API token, Railway manages workspace keys instead. Workspace key registration requires Admin access.
Project tokens in `RAILWAY_TOKEN` do not support SSH key management. Use `railway login` or workspace API authentication.
See [Railway SSH](https://docs.railway.com/cli/ssh) for key removal and workspace access.

For private eRPC metrics, use [the browser script](rpc-cache.md#open-private-metrics-from-your-computer).
The script can use the key without an SSH agent. Set `RAILWAY_SSH_IDENTITY_FILE` as shown in those instructions.
OpenSSH prompts for the private key passphrase.
The script does not register keys automatically.

## Automatic plan and apply

[`.github/workflows/ci.yml`](../.github/workflows/ci.yml) owns routine production
releases in its existing `railway-apply` job. PRs run offline IaC/typechecks and
source/image checks with **no Railway production credential or live plan**.
Native plan previews infrastructure changes, but evaluating the authoring code
runs repository JavaScript with its token. A preview operation is not a safe
place to execute untrusted PR code with production credentials.

On a `master` push, after all five source checks and Image security and integration
succeed, the job selects a reviewed PR merged at that exact SHA into this repository's
`master`. A reviewed fork PR is trusted after merge too. Direct pushes, unmerged
PRs skip infrastructure release. Every reviewed merge, including application-only
and Markdown-only changes, reconciles the current configuration; unchanged
infrastructure produces a native no-op. The job then:

1. Waits for the newest exact-SHA Dependency Audit **push** run, managed CodeQL **dynamic** run (workflow `255339919`), and reported external checks/statuses. Missing/pending results time out; failed/cancelled/skipped required runs block release. It then rejects an outdated `master` SHA before checkout, dependency installation or Railway token use; the final pre-apply current-master check remains.
2. Checks out the exact merged SHA and uses the locked shared bootstrap with dependencies for SDK evaluation. A missing deployment token fails before the native plan or any other provider command.
3. Runs native `railway config plan --environment "$RAILWAY_ENVIRONMENT_ID" --out <temporary-plan>` under umask 077, capturing stdout/stderr privately. The plan reads/evaluates/previews; it does not apply infrastructure changes. No PR plan, uploaded/downloaded artifact or cross-run state is used.
4. After the fresh plan captures its ETag, checks the cache-password prerequisite once, before apply. Validates the plan shape/main database image-transition policy and rejects an outdated queued release if current `master` differs. Native saved-plan apply binds the environment, source tree, revision/ETag and hash; CI does not duplicate those checks in JavaScript.
5. Applies that fresh local plan with the native CLI and accepts only `applied`/`noop` at the top level and for every change, never exit zero alone. No `--confirm-destructive` is supplied. The existing main PostgreSQL source-image transition gate still requires the separately approved [PG18 reset/reindex release](postgresql18-rebuild.md).

Plan and apply remain inside the CI dependency graph, serialized together with
`railway-infrastructure-production`, without cancelling an active release. Both
use the repository-pinned native CLI 5.75.0. The single job references GitHub
environment name `production` with `deployment: false`: secrets and branch policy
still apply, without GitHub deployment records for skipped releases. Railway owns
actual application deployment status. The job maps only the environment-only
`RAILWAY_DEPLOY_TOKEN` to native `RAILWAY_API_TOKEN`; it never uses the old repository secret. The
[activation prerequisites above](#bootstrap-and-migration) must be configured live.
The target project is `d733dd5c-7076-48ad-ac8b-a147cb428300` and production environment
`1b61e496-b565-42b4-9e5d-8096e28e13cd`. Both native plan and apply pass this exact environment ID from
`RAILWAY_ENVIRONMENT_ID`, rather than the mutable name `production`, matching the
cache precondition. IaC recognizes this pinned production ID even if Railway renames the environment; the name `production` still works for offline/self-hosted evaluation. These IDs select the destination; they do not restrict token permissions. Production application sources use `master`.

Apply can change infrastructure **and** service/build/source/environment/network
settings. Some changes trigger builds, deployments or restarts; this is not merely
a file upload. It performs no automatic database migration/reset. Application code
continues through Railway GitHub autodeploys and watch patterns with `checkSuites: true`;
verify effective "Wait for CI" settings and actual deployment health after release.
The CI success message is not proof of live HTTP/TCP privacy or application readiness.

The external gate retains latest-per-context commit-status checks, excluding
Railway deployment statuses that wait for CI and its own workflow suite to avoid
waiting on itself. Other workflow suites remain checked. The wait step allows
35 minutes (the polling loop stops after about 30); the full release job allows
60 minutes. Dependency Audit remains standalone, with same-repository PR comments
and no fork token use. Routine production release is automatic; the native manual
procedure below is only for separately approved maintenance/recovery, not a bypass
for missing or failed release gates.

Before a manual production apply or operator redeploy, inspect the exact merge SHA:

```bash
gh run list --commit <merge-sha> --limit 100 --json workflowName,event,status,conclusion
gh api repos/OlympusDAO/protocol-visualizer/commits/<merge-sha>/check-runs --paginate --jq '.check_runs[] | {name,status,conclusion}'
gh api "repos/OlympusDAO/protocol-visualizer/commits/<merge-sha>/statuses" --paginate --jq '.[] | {context,state}'
```

Require all five `CI` source checks and the Image security and integration gate,
plus no pending or failed external commit checks. For the exact production merge
SHA, identify the newest `audit.yml` **push** run and managed CodeQL workflow
`255339919` **dynamic** run; both must be completed with conclusion `success`.
A successful scheduled/manual run or `workflow_dispatch` is not a substitute.
For the separately approved PG18 reset/rebuild, automatic `railway-apply` is
intentionally blocked: do not require that job or whole-workflow success as a
circular prerequisite. All source/image/external gates and the reviewed manual
release procedure still apply. Previews use equivalent source checks for their
target revision; they do not relax these production event requirements.
Commit statuses are newest first: review the first entry for each lowercase context and require
`success`, excluding only contexts whose lowercase name starts with
`protocol-visualizer - ` because those deployments wait for CI.
Missing required runs are not a pass; obtain matching event/commit results
before production release.
Preview infrastructure/domain bootstrap requires separately approved operator
work; PRs do not run authenticated production planning.

If a queued release is rejected after `master` advances, follow the latest reviewed
`master` push CI run, or re-run that exact latest push run after its gates pass.
Every reviewed merge is eligible for reconciliation, including application-only
and Markdown-only merges, so the latest run can reconcile a superseded change.
Re-running an older revision cannot recover the superseded release. Local native
operations remain separately approved maintenance/recovery only.

Preview branches follow Railway's PR metadata. No production custom domains are attached to
previews. Operator secrets and generated Railway domains remain on Railway.
A PR environment's databases survive ordinary redeploys and disappear when
Railway deletes that temporary environment.

### First-use public domains for PR environments

Once `frontend` and `snapshot-gateway` exist in a new PR environment, generate a
Railway public domain for each, targeting port **8080**, before the first frontend
build. Keep frontend deployment paused while provisioning these prerequisites.
In each service's Settings → Networking, choose **Generate Domain** and port 8080,
or use the CLI with explicit project and environment selectors:

```bash
railway domain --project d733dd5c-7076-48ad-ac8b-a147cb428300 --environment protocol-visualizer-pr-82 --service snapshot-gateway --port 8080
railway domain --project d733dd5c-7076-48ad-ac8b-a147cb428300 --environment protocol-visualizer-pr-82 --service frontend --port 8080
```

Replace the environment name when setting up a different PR. Reuse existing
generated domains rather than creating replacements on every deployment.
The IaC `domains` field manages custom domains only; it does not create these
generated Railway domains. Generate domains only for these two public services;
leave Hasura, the indexer, snapshot jobs, RPC cache, and databases private.

The frontend's `VITE_PROTOCOL_SNAPSHOT_BASE_URL` is set to
`https://${{snapshot-gateway.RAILWAY_PUBLIC_DOMAIN}}`. Confirm that Railway resolves
this reference to a complete HTTPS URL with the gateway's actual hostname.
Deploy the gateway and verify that its `/v1/manifest` endpoint returns JSON after
the publisher has produced a snapshot, then build/deploy the frontend.
Vite embeds this URL at build time, so a frontend built before domain creation
must be rebuilt afterward. A missing gateway domain resolves the URL to `https://`;
protocol requests can then reach frontend Nginx and return HTML instead of JSON.

## Manual IaC plan and deployment

Routine production releases use CI above. Use this procedure only for separately
approved maintenance/recovery, including the deliberate PG18 rebuild.

Run these commands from the repository root on your local machine.
Use the repository-pinned native Railway CLI 5.75.0 and the repository-pinned Node and pnpm versions.
The target Railway environment must already exist.

A plan reads Railway configuration without changing resources or service variables.
An apply changes the whole environment described by `.railway/railway.ts`.
It can create resources, update variables, and trigger application deployments.
It does not upload local application code. Application builds use their configured GitHub branch.

### 1. Prepare the local checkout and login

```bash
nvm use
pnpm run check:runtime-versions
pnpm install --frozen-lockfile
railway --version
railway login
railway whoami
```

If a valid CLI login already exists, omit `railway login`.
If using a workspace token locally, set `RAILWAY_API_TOKEN` and leave `RAILWAY_TOKEN` unset.
The production CI job maps its environment-only `RAILWAY_DEPLOY_TOKEN` secret to `RAILWAY_API_TOKEN`; local maintenance uses separately authorized operator credentials.
The same workspace credential can access different environments; the CLI's link or explicit selectors choose the destination.

### 2. Select the environment

Link this directory once to the intended project and environment:

```bash
railway link --environment protocol-visualizer-pr-82
railway status
```

Select `protocol-visualizer` if prompted. Verify the project and environment names.
Native plan/apply commands use the linked project and an explicit target environment.
The retained metrics/reset helpers print the project and environment names and IDs before their operation.
For these helpers, the selector order is `--environment`, then `RAILWAY_ENVIRONMENT`, then the linked environment.
Reset still requires an explicit selector because it removes indexer data.
Railway gets the source branch from its PR environment metadata when creating services.
Existing preview services retain their configured branch. Production sources always use `master`.
No PR number or source branch export is required by the scripts.
Changing Git branches does not change the Railway link. Link again when switching deployment targets.

### 3. Generate a plan without deploying

Before planning, inventory generated/custom HTTP domains and active TCP proxies
for every service/database in the selected environment, including unexpected
resources without decrypting variables. Check the frontend/gateway public allowlist.
Existing private HTTP domains need separately approved native removal and a fresh
inventory before planning because config apply cannot delete them. Leave imported
TCP proxies in the inventory for the native plan's explicit `null` removals.

```bash
pnpm run railway:check
set +x
umask 077
touch railway-plan.json
chmod 600 railway-plan.json
railway config plan --environment <target-environment> --out railway-plan.json
```

Set this umask in the **current operator shell** before the first plan. Precreate the artifact with `touch` under 077 and restrict any pre-existing file with `chmod 600` before a native write; stop if these commands fail. CLI 5.75 uses ordinary file writes and does not itself establish owner-only permissions. Keep shell tracing/session logging disabled when handling private artifacts.

The native CLI saves `railway-plan.json` for the explicitly selected environment.
To select production explicitly, use `railway config plan --environment production --out railway-plan.json`.
Pass the same environment to apply. Verify the target in the plan before continuing.

For a terminal-only preview, run `railway config plan --environment <target-environment>`.
For a different artifact path, pass `--out <path>` to the same native command.
The saved artifact pins the proposed changes and environment revision for the later apply.
`railway-plan.json` is ignored by Git; Gitignore is not filesystem protection. Treat it as private even though terminal values are redacted. Archive only with owner-readable/writable file permissions (600) inside an owner-only directory (700).
Do not commit, share, or force-add the artifact.

### 4. Review the plan

Verify the target environment, resource changes, and variable changes.
Stop for unexpected deletions, database image changes, volume changes, or unrelated service changes.

This is a whole-project plan. There is no `--service` or `--target` selector for this apply.
It is not the cache-only bootstrap procedure. A reusable cache-only bootstrap command is not yet provided.
The full apply also routes the indexer, publisher, and monitor through eRPC.
Before that switch, supply all nine upstream credentials and verify the cache.
The manual values and automatic references are listed in [Automatic variables and manual secrets](#automatic-variables-and-manual-secrets).

Variable diffs show the current value before the arrow and the desired value after it:

```text
Update variable indexer.ENVIO_RPC_URL_1
  indexer.ENVIO_RPC_URL_1 (preserve() → «hidden»)
```

Here, `preserve()` represents the hidden current value. The update replaces it with the reference declared in IaC.
`«hidden»` means that the CLI redacts the desired value. It does not mean that the variable stays unchanged.
An explicit `preserve()` in the service's `env` definition retains its existing value.
Provider URLs and API tokens use that explicit form.
The snapshot jobs use a shared reference for `DISCORD_WEBHOOK_URL`.
Set the shared value in the target environment before deployment.
Shared references, connection references, and consumer RPC URLs do not use `preserve()`.

Warnings such as `variables.ignore pattern "RPC_CACHE_MAX_RPS" matches no variable` describe absent optional operator variables.
If an operator supplies those variables later, the ignore rules retain their values.
They do not create values or disable automatic connection references.

### 5. Apply the reviewed plan

Before applying, complete the repository validation sequence in [AGENTS.md](../AGENTS.md).
Publish required application and Dockerfile changes to the configured GitHub branch before its builds start.
Commit intended IaC changes before generating the final plan.
If the configuration, checkout revision, or live environment changes, generate and review a fresh plan.

Only after reviewing the saved plan, run:

```bash
umask 077
railway_apply_directory="$(mktemp -d)"
railway config apply --environment <target-environment> --plan railway-plan.json --json >"$railway_apply_directory/result.json" 2>"$railway_apply_directory/stderr.txt"
```

For an explicit production plan, use `--environment production` with the same private output capture.

The equivalent package command is `pnpm railway:apply production --json`, with the same private output capture; a target value is mandatory. Pass `--json` explicitly: it bypasses native confirmation, so review the plan first. The alias itself does not enable JSON. Automatic merge apply blocks an existing main database source-image transition even when the native plan labels it safe. Use the separately approved [PG18 reset/reindex procedure](postgresql18-rebuild.md) and direct native apply for that release.
Keep the target environment unchanged between plan and apply.
Before calling native apply, use `railway status` to verify the linked project and selected environment. Match that environment ID against the saved artifact's `environmentId`; CLI 5.75 saved plans have no `projectId`. Keep the reviewed artifact unchanged. CI retains the main database transition/current-master guards; native saved-plan validation enforces environment/source-tree/revision binding.
The command applies the saved changes without re-evaluating the authoring file.
If Railway rejects a stale plan, generate a fresh plan and review it again.
Do not add `--confirm-destructive` to bypass an unexpected destructive change.
A manual production apply can invalidate an in-flight CI plan; coordinate separately approved maintenance with automatic releases.

#### Verify native apply results

CLI 5.75's saved-plan path can exit zero and print success for failed or partial provider results. The native command/explicit environment remains the interface; no custom mutation wrapper is required. With native `--json`, inspect the top-level result in the restricted private directory above. Its `status` must be `applied` or `noop`, `changes` must be an array, and every change must have status `applied` or `noop`. Reject `failed`, `partially_applied`, `applying`, `staged`, missing/malformed or unknown statuses at either level, even when the process exits zero. A nonzero process exit is also failure. Do not retry a failed/uncertain apply blindly.

Raw results, outputs, diagnostics and stderr can contain sensitive values. Do not print them to shared terminal/GitHub logs, commit them or upload them as artifacts. Keep them private and share only sanitized status/count evidence. The existing CI apply step captures both streams only in memory and checks the same accepted statuses before reporting success; it retains the exact native saved-plan/environment arguments.

After an accepted result, generate a fresh **read-only plan** for the same project, environment and reviewed revision. Keep its artifact/output private too, for example with native `railway config plan --environment <target-environment> --out "$railway_apply_directory/verification-plan.json"` and private stdout/stderr capture. Review all remaining drift; do not infer convergence from the apply result alone.

Then complete the provider **HTTP/TCP** inventory for every service/database in that exact environment, including unknown/unexpected resources: generated HTTP domains, custom HTTP domains and TCP proxies/ports. Match frontend/gateway against the public allowlist and verify no private service has public domains/proxies. Verify actual public/private reachability and database mounts, effective PGDATA, TLS and persistence. After services are running, verify indexer `/docs`, `/openapi.json`, `/llms.txt` and `/llms-full.txt` return 404, `/healthz` returns 200 and readiness/indexing progress are appropriate for the deployment. Readiness may return 503 during normal reindexing; the [PG18 rebuild sequence](postgresql18-rebuild.md) controls when writers resume. See [security posture](security-posture.md) for trust boundaries. Source empty maps, a clean plan, process exit zero and success text cannot replace this verification. No native plan/apply/provider action is performed by this documentation change.

### 6. Verify the application deployments

```bash
railway deployment list --service rpc-cache
railway deployment list --service indexer
railway logs --service indexer --latest --lines 50
```

Verify the healthchecks, advancing indexer blocks, and cache hits through private-network access.
An accepted IaC apply does not prove that indexing works.
See [Deployment checks](#deployment-checks) and [the cache checks](rpc-cache.md#deployment-order-and-rollback-checklist).

### Troubleshooting

| Message                                             | Action                                                                                                                                                                      |
| --------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Set RAILWAY_SOURCE_BRANCH to the target PR branch` | Update the checkout. Current IaC follows Railway's PR branch metadata without this export.                                                                                  |
| No linked project or wrong environment              | Run `railway link` and verify `railway status`, or pass `--environment <name>` to both scripts.                                                                             |
| `Invalid RAILWAY_TOKEN` with a workspace token      | Use `RAILWAY_API_TOKEN` for workspace authentication. The current workflow maps the existing Actions secret correctly; publish this fix before starting a new workflow run. |
| `variables.ignore pattern ... matches no variable`  | If the optional operator variable is absent, no action is required.                                                                                                         |
| `preserve() → «hidden»`                             | Read this as a hidden current value changing to the value declared in IaC.                                                                                                  |
| `CI check suite failed` / deployment `SKIPPED`      | Fix the failing GitHub check and publish the fix to the configured source branch. An IaC apply uses published application code; local fixes are not uploaded.               |
| Stale saved plan or environment revision mismatch   | Generate and review a fresh plan for the same target environment.                                                                                                           |
| Service still managed by a repository config file   | Follow [Bootstrap and migration](#bootstrap-and-migration) before applying.                                                                                                 |

## Rollback

Restore previous application settings through a reviewed IaC change. Keep both
databases, volumes, and the bucket in the definition. Omitting a resource from
this whole-project file proposes deletion; the workflow blocks destructive
applies. Never change the Envio database image major during this migration.
Do not restore an old indexer image that resets the database at startup.
For proxy failures, restore prior consumer RPC URLs while keeping cache storage.

## Handover Model

The publisher writes snapshots under deployment-scoped internal keys:

```text
v1/deployments/<deploymentId>/chain/<chainId>/protocol.json
```

It publishes `v1/manifest.json` last. The manifest is the public blue/green
handover boundary. During a deliberate indexer rebuild, `snapshot-gateway`
keeps serving the previous active manifest.
Public REST responses never expose deployment ids or S3 object keys.

## Public REST API

```text
GET /healthz
GET /ready
GET /v1/openapi.json
GET /v1/bounds
GET /v1/manifest
GET /v1/chains
GET /v1/chains/{chainId}/protocol
```

GET/HEAD `/` serve a static API catalogue without JavaScript or external assets; HEAD has no body. There is no separate `/docs` route; `/v1/openapi.json` remains the JSON API specification. See the [PG18.6 reset/reindex preparation](postgresql18-rebuild.md) before changing the main database major version.

`/v1/bounds` includes `indexingProgress.chains[*] = { chainId, date,
timestamp, block }`. Static JSON paths such as `/v1/manifest.json` and
`/v1/chain/{chainId}/protocol.json` are not public routes.

## Railway Variables

Required variables are uncommented in the examples below. Optional variables are
commented.

Set on `hasura`:

```bash
PORT=8080
HASURA_GRAPHQL_DATABASE_URL=${{Postgres.DATABASE_URL}}
HASURA_GRAPHQL_ADMIN_SECRET=${{shared.HASURA_GRAPHQL_ADMIN_SECRET}}
```

Hasura should stay on `PORT=8080` because the private URLs used by the indexer
and publisher target `hasura.railway.internal:8080`. If this port changes,
update `HASURA_GRAPHQL_ENDPOINT` on `indexer` and `HASURA_GRAPHQL_URL` on
`snapshot-publisher`.

Set on `indexer`:

```bash
PORT=9898
DATABASE_URL=${{Postgres.DATABASE_URL}}
HASURA_GRAPHQL_ENDPOINT=http://${{hasura.RAILWAY_PRIVATE_DOMAIN}}:8080/v1/metadata
HASURA_GRAPHQL_ADMIN_SECRET=${{shared.HASURA_GRAPHQL_ADMIN_SECRET}}
ENVIO_RPC_URL_1=http://${{rpc-cache.RAILWAY_PRIVATE_DOMAIN}}:4000/pv/evm/1
ENVIO_RPC_URL_10=http://${{rpc-cache.RAILWAY_PRIVATE_DOMAIN}}:4000/pv/evm/10
ENVIO_RPC_URL_42161=http://${{rpc-cache.RAILWAY_PRIVATE_DOMAIN}}:4000/pv/evm/42161
ENVIO_RPC_URL_421614=http://${{rpc-cache.RAILWAY_PRIVATE_DOMAIN}}:4000/pv/evm/421614
ENVIO_RPC_URL_84532=http://${{rpc-cache.RAILWAY_PRIVATE_DOMAIN}}:4000/pv/evm/84532
ENVIO_RPC_URL_4663=http://${{rpc-cache.RAILWAY_PRIVATE_DOMAIN}}:4000/pv/evm/4663
ENVIO_RPC_URL_8453=http://${{rpc-cache.RAILWAY_PRIVATE_DOMAIN}}:4000/pv/evm/8453
ENVIO_RPC_URL_80094=http://${{rpc-cache.RAILWAY_PRIVATE_DOMAIN}}:4000/pv/evm/80094
ENVIO_RPC_URL_11155111=http://${{rpc-cache.RAILWAY_PRIVATE_DOMAIN}}:4000/pv/evm/11155111
ENVIO_API_TOKEN=<envio-api-token>
ETHERSCAN_API_KEY=<etherscan-api-key>
# ENVIO_RPC_MODE=
```

`ENVIO_API_TOKEN` should be set for production deployments. When
`ENVIO_RPC_MODE` is left blank, the indexer wrapper derives `fallback` from the
token so Envio uses HyperSync with RPC fallback. Running without a token falls
back to RPC-only indexing and is materially slower for cold backfills.
`ETHERSCAN_API_KEY` is required so the indexer can fetch contract metadata that
is not already precomputed or available in local ABI/source-code files.

Do not set `ENVIO_PG_SCHEMA` on Railway. The indexer wrapper fails fast if it is
set. Railway start commands run `envio start` and resume compatible state.
Envio rejects incompatible changes; it does not automatically wipe data.
For an intentional reset, follow [indexer-operations.md](indexer-operations.md),
including the manual SSH reset in the existing indexer service.

The publisher and monitor read Envio's private `/metrics` endpoint to decide
whether a deployment is ready. The indexer Railway service must set `PORT=9898`
so the health wrapper exposes `/healthz`, `/ready`, and proxied `/metrics` on
`indexer.railway.internal:9898`. If that port is changed, update
`INDEXER_METRICS_URL` on both `snapshot-publisher` and `snapshot-monitor` to
match the indexer's `PORT`.

Set all nine `RPC_URL_<chainId>` variables on both snapshot jobs to the private
proxy paths documented in [rpc-cache.md](rpc-cache.md).

Set on `snapshot-publisher`:

```bash
HASURA_GRAPHQL_URL=http://${{hasura.RAILWAY_PRIVATE_DOMAIN}}:8080/v1/graphql
HASURA_GRAPHQL_ADMIN_SECRET=${{hasura.HASURA_GRAPHQL_ADMIN_SECRET}}
RAILWAY_ENVIRONMENT_NAME=<provided by Railway>
INDEXER_METRICS_URL=http://${{indexer.RAILWAY_PRIVATE_DOMAIN}}:9898/metrics
BUCKET=${{storage.BUCKET}}
ACCESS_KEY_ID=${{storage.ACCESS_KEY_ID}}
SECRET_ACCESS_KEY=${{storage.SECRET_ACCESS_KEY}}
REGION=${{storage.REGION}}
ENDPOINT=${{storage.ENDPOINT}}
# INDEXER_DEPLOYMENT_ID=${{shared.INDEXER_DEPLOYMENT_ID}}
DISCORD_WEBHOOK_URL=${{shared.DISCORD_WEBHOOK_URL}}
# MONITOR_STALE_CHAIN_HOURS=24
```

`RAILWAY_ENVIRONMENT_NAME` is provided automatically by Railway. Do not add a
custom replacement variable; `snapshot-publisher` fails fast if the Railway
environment name is missing.

`INDEXER_DEPLOYMENT_ID` is a manual artifact namespace override. When it is not
set, Railway's `RAILWAY_GIT_COMMIT_SHA` is used. The publisher watches
`/apps/indexer/**`, so normal indexer code changes redeploy both indexer and
publisher from the same commit and produce a new namespace. Publisher-only code
changes also produce a new namespace for the same indexed data; this is
acceptable and simply creates a fresh snapshot manifest. For a same-commit
manual indexer redeploy, reset, or backfill, set `INDEXER_DEPLOYMENT_ID` to a new
safe value before running `snapshot-publisher` if the active manifest should
handover to a fresh bucket prefix.

Set on `snapshot-monitor`:

```bash
DISCORD_WEBHOOK_URL=${{shared.DISCORD_WEBHOOK_URL}}
RAILWAY_ENVIRONMENT_NAME=<provided by Railway>
INDEXER_METRICS_URL=http://${{indexer.RAILWAY_PRIVATE_DOMAIN}}:9898/metrics
BUCKET=${{storage.BUCKET}}
ACCESS_KEY_ID=${{storage.ACCESS_KEY_ID}}
SECRET_ACCESS_KEY=${{storage.SECRET_ACCESS_KEY}}
REGION=${{storage.REGION}}
ENDPOINT=${{storage.ENDPOINT}}
# INDEXER_DEPLOYMENT_ID=${{shared.INDEXER_DEPLOYMENT_ID}}
# MONITOR_STATE_KEY=v1/monitor-state.json
# MONITOR_STALE_CHAIN_HOURS=24
```

`snapshot-publisher` and `snapshot-monitor` require `DISCORD_WEBHOOK_URL` for their notifications.
Set the shared webhook value in Railway before deployment. IaC supplies the reference to both snapshot jobs.
Use a separate Discord webhook for PR environments to keep test alerts out of production channels.
Both pre-deploy checks and job startup log and reject a missing or blank webhook
without sending a notification. Local publisher file exports do not send notifications.
The monitor also fails fast if `RAILWAY_ENVIRONMENT_NAME` is missing.

Set on `snapshot-gateway`:

```bash
BUCKET=${{storage.BUCKET}}
ACCESS_KEY_ID=${{storage.ACCESS_KEY_ID}}
SECRET_ACCESS_KEY=${{storage.SECRET_ACCESS_KEY}}
REGION=${{storage.REGION}}
ENDPOINT=${{storage.ENDPOINT}}
```

Set on `frontend`:

```bash
VITE_PROTOCOL_SNAPSHOT_BASE_URL=https://protocol-visualizer-api.olympusdao.finance
```

Use `BUCKET` for S3 API calls, not `RAILWAY_BUCKET_NAME`.

## Railway Policies

Long-running services use Railway's default `ON_FAILURE` policy and an explicit
`restartPolicyMaxRetries: 1`: `rpc-cache`, `hasura`, `indexer`, `snapshot-gateway`, and `frontend`.
IaC omits the default policy type. Railway omits it from configuration snapshots,
but CLI 5.71.0 does not normalize an explicit `ON_FAILURE` declaration to that omission.
Declaring it explicitly therefore produces a false change on every plan and can trigger unnecessary redeployments.
This omission does not disable restarts. The service API and deployment manifests report the effective `ON_FAILURE` policy.
See [Railway's documented restart default](https://docs.railway.com/guides/multi-region-api-failover#what-failover-you-get).

Cron services use `restartPolicyType: NEVER`:

- `snapshot-publisher`: `0 * * * *`
- `snapshot-monitor`: `5 0 * * *`

Healthchecks:

- `hasura`: `/healthz`
- `indexer`: `/healthz`
- `snapshot-gateway`: `/healthz`
- `frontend`: `/`

The snapshot gateway uses `/healthz` for storage-independent deployment health.
This keeps the gateway running while the indexer rebuilds and the publisher waits to create the first manifest.
`/ready` returns 503 until the active manifest and its referenced artifacts are accessible.
`/ready` also returns 503 if the gateway did not load the ABI registry.
After publication, the next readiness request succeeds without a gateway restart.
Use `/ready` for data-availability monitoring. A successful deployment does not prove that snapshots are available.
Readiness failures emit sanitized logs with provider error codes, affected chain ids, and check duration.

## Deployment checks

After the initial apply, configure and verify the RPC cache, then check indexer
progress, publisher and monitor configuration, gateway `GET /ready`,
`GET /v1/bounds`, and `GET /v1/chains/1/protocol`. An infrastructure apply does
not prove that every application deployment or provider is healthy.

## Cloudflare

Cache eligible `GET` and `HEAD` routes under `/v1/` and `/`. Bypass `/ready`.
Block non-`GET`/`HEAD`/`OPTIONS` methods, request bodies on `GET`/`HEAD`, and
paths outside the public REST surface. Let Cloudflare handle edge compression.

## Validation

Run `pnpm validate` for the source-only sequence in `AGENTS.md`. It checks
OpenAPI drift during gateway build; explicit regeneration first builds shared
snapshot artifacts from current source. `pnpm validate:all` then builds/scans all seven images and Dockerfiles and runs required container integration. See [validation.md](validation.md) for prerequisites and evidence.


## Recorded initial migration checks (2026-10-29)

These checks preceded the PR 82 cache bootstrap and later variable wiring.
Railway CLI 5.71.0 and SDK 3.16.0 evaluated the complete definition. Read-only
plans show 3 additions and 12 build/deploy updates in production, and 1 addition
and 12 build/deploy updates in PR #82. Both have zero deletions and no changes
to existing databases, volumes, bucket, groups, or service variables.
The PostgreSQL images remain 16 for Envio and 18 for the separate cache.

All nine required repository validation steps passed in order. Native SDK tests
cover the resource inventory, database images, capacities, branch/domain rules,
variable ownership, and merge workflow guards. Checksum-verified Actionlint
1.7.12 validated the workflow. The workflow itself has not run against GitHub.
The current GitHub credential received HTTP 403 when listing secret names, so
that historical secret configuration was not verified. It is not evidence for
today's environment-only deployment secret or master-only protections.
These initial checks were read-only. Later PR 82 cache creation, upstream variable
setup and deployment follow [rpc-cache.md](rpc-cache.md).
No production apply was run.
