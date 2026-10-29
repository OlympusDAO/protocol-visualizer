# Railway project infrastructure

`railway.ts` defines all services, databases, volumes, the bucket, and groups.
It is the project definition; there is no named partial. Removing a resource
can delete it on apply. IaC supplies connection references. Provider URLs and
operator secrets stay in Railway through `preserve()`; optional overrides remain
outside IaC ownership. Configure and verify the cache before routing consumers.

Use the repository-pinned SDK and Railway CLI 5.71.0 or newer:

```bash
export RAILWAY_ENVIRONMENT=protocol-visualizer-pr-82
export RAILWAY_SOURCE_BRANCH=feat/robinhood-chain
pnpm run railway:check
pnpm run railway:plan
```

For production, use `RAILWAY_ENVIRONMENT=production`; its source branch is always
`master`. Preview source branches must be explicit.

The GitHub workflow plans production changes on PR updates and applies the saved
plan on merge to `master`. Set a production-scoped project token as the GitHub
secret `RAILWAY_TOKEN`. Destructive applies are blocked. Preview infrastructure
still needs an explicit operator apply; application autodeploys remain enabled.

See [the Railway guide](../docs/railway-self-hosting.md) for bootstrap, migration,
variables, plan review, and rollback. Do not commit decrypted plans or secrets.
