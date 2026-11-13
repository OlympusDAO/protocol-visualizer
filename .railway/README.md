# Railway project infrastructure

`railway.ts` defines all services, databases, volumes, the bucket, and groups.
It is the project definition; there is no named partial. Removing a resource
can delete it on apply. IaC supplies connection references. Provider URLs and
operator secrets stay in Railway through `preserve()`; optional overrides remain
outside IaC ownership. Configure and verify the cache before routing consumers.
IaC references the cache database's `PGHOST`, `PGPORT`, `PGUSER`, `PGPASSWORD`,
and `PGDATABASE`. eRPC encodes the URI components at runtime, keeping the Railway
dependency visible without copying credentials into a connection string.
Publisher and monitor reference the environment's shared `DISCORD_WEBHOOK_URL`.
Add its value manually in Project Settings → Shared Variables before applying the plan.
Use a separate webhook for preview alerts. Do not commit the webhook URL.

Use the repository-pinned SDK and Railway CLI 5.71.0 or newer:

```bash
railway link
railway status
pnpm run railway:check
umask 077
pnpm run railway:plan
```

Select the intended project and environment, then verify them with `railway status`.
The commands use the linked project and environment. Railway selects the PR
branch from its environment metadata; production always uses `master`. Changing
Git branches does not change the Railway link. Verify the plan target before apply.
For production, pass `--environment production` to both commands.
Metrics, plan, apply, and reset print the selected project and environment names and IDs before proceeding.
Command-line `--environment` takes precedence over `RAILWAY_ENVIRONMENT`, then the current link.
Apply rejects a saved plan for a different target. Reset requires an explicit environment.

After reviewing the saved whole-project plan, apply those exact changes:

```bash
pnpm run railway:apply
```

This can redeploy services and change consumer RPC URLs. Verify the cache before
that switch. The plan is private and ignored by Git.
Use the [manual deployment procedure](../docs/railway-self-hosting.md#manual-iac-plan-and-deployment)
for login, project selection, required validation, and common plan messages.

The Railway workflow plans production changes on PR updates. The final apply job
in `ci.yml` depends on build, lint, security, and dependency jobs, then checks
external CodeQL and commit results for the merge commit. It applies only the saved
plan for that merged PR's exact head. Set one Olympus workspace API token as the GitHub
Actions secret `RAILWAY_TOKEN`. The workflow exports it as `RAILWAY_API_TOKEN`
and selects the project and production environment explicitly. No token per
environment is required. Destructive applies are blocked. Preview infrastructure
still needs an explicit operator apply; application autodeploys remain enabled.

See [the Railway guide](../docs/railway-self-hosting.md) for bootstrap, migration,
variables, plan review, and rollback. Do not commit decrypted plans or secrets.
