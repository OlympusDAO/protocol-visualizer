# Railway project infrastructure

`railway.ts` defines all services, databases, volumes, the bucket, and groups.
It is the project definition; there is no named partial. Removing a resource
can delete it on apply. IaC supplies connection references. Provider URLs and
operator secrets stay in Railway through `preserve()`; optional overrides remain
outside IaC ownership. Configure and verify the cache before routing consumers.

Use the repository-pinned SDK and Railway CLI 5.71.0 or newer:

```bash
railway link --environment protocol-visualizer-pr-82
railway status
pnpm run railway:check
umask 077
pnpm run railway:plan
```

The commands use the linked project and environment. Railway selects the PR
branch from its environment metadata; production always uses `master`. Changing
Git branches does not change the Railway link. Verify the plan target before apply.
For production, pass `--environment production` to both commands.

After reviewing the saved whole-project plan, apply those exact changes:

```bash
pnpm run railway:apply
```

This can redeploy services and change consumer RPC URLs. Verify the cache before
that switch. The plan is private and ignored by Git.
Use the [manual deployment procedure](../docs/railway-self-hosting.md#manual-iac-plan-and-deployment)
for login, project selection, required validation, and common plan messages.

The GitHub workflow plans production changes on PR updates and applies the saved
plan on merge to `master`. Set a production-scoped project token as the GitHub
secret `RAILWAY_TOKEN`. Destructive applies are blocked. Preview infrastructure
still needs an explicit operator apply; application autodeploys remain enabled.

See [the Railway guide](../docs/railway-self-hosting.md) for bootstrap, migration,
variables, plan review, and rollback. Do not commit decrypted plans or secrets.
