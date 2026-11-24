# Railway project infrastructure

`railway.ts` defines all services, databases, volumes, the bucket, and groups.
It is the project definition; there is no named partial. Removing a resource
can delete it on apply. IaC supplies connection references. Provider URLs and
operator secrets stay in Railway through `preserve()`; optional overrides remain
outside IaC ownership. Configure and verify the cache before routing consumers.
IaC sets `rpc-cache.RPC_CACHE_DATABASE_URL` to a reference to
`rpc-cache-postgres.DATABASE_URL`, matching the indexer's database linkage.
Publisher and monitor reference the environment's shared `DISCORD_WEBHOOK_URL`.
Add its value manually in Project Settings → Shared Variables before applying the plan.
Use a separate webhook for preview alerts. Do not commit the webhook URL.

Both `Postgres` and `rpc-cache-postgres` use the create-only password policy in
[`railway.ts`](railway.ts):
`${{ secret(64, "0123456789abcdef") }}` as a template `defaultValue`, matching
Railway's official Postgres template. Bare `secret(...)` text is not a generated
password. New databases request a random, URL-safe password;
existing passwords use `preserve()`.
The config reads target-environment service names and volume capacities through `railway api` before
planning. A failed or incomplete lookup aborts the plan. Offline checks without
an environment ID preserve passwords instead of requesting generation.
Before applying the cache URL reference in an existing environment, ensure its
database password is URL-safe. Existing credentials require a coordinated database
role and Railway variable update; changing `POSTGRES_PASSWORD` alone is insufficient.
Automatic production release checks this password policy once after fresh planning, before apply
and stops if rotation is still required. This check does not modify credentials
or verify that a PostgreSQL role rotation has been completed.
Automatic whole-project apply requires the cache to be provisioned and verified
first. Bootstrap it through a separate reviewed cache-only plan; an absent
database must keep automatic apply blocked until that prerequisite is complete.

Both database volumes target 20,000 MB in production and previews. Existing
larger capacities are retained: the requested capacity is the greater of
20,000 MB and the live volume capacity. Plans can grow smaller volumes without
requesting a shrink or data migration. The cache volume is
`rpc-cache-postgres-volume`; the detached legacy `postgres-volume` is not declared.

Main database source-image changes are blocked from automatic apply. The
[production rebuild procedure](../docs/indexer-operations.md#database-major-version-rebuild) requires separate approval;
cache data and production mounts remain unchanged.

See the [automatic CI gates and release recovery](../docs/railway-self-hosting.md#automatic-plan-and-apply)
for planning/apply on every reviewed merge into `master`, environment-only deployment credentials,
activation prerequisites and queued-release recovery. PRs have no production token
or live plan; source policy does not prove live GitHub protections or deployed privacy.

For local native plan/review/apply, private artifact permissions and deployment
acceptance, use the [operator runbook](../docs/railway-self-hosting.md#manual-iac-plan-and-deployment).
Native exit zero alone does not establish success. Bootstrap, public-domain
provisioning, troubleshooting and rollback remain in that guide.
