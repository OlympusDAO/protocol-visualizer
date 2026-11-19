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
[`postgres-policy.ts`](postgres-policy.ts):
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
Automatic production apply checks this password policy before applying the plan
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

For local plan/apply, project/environment selection, private plan permissions and native JSON-result verification, use the [manual deployment procedure](../docs/railway-self-hosting.md#manual-iac-plan-and-deployment). It is the authoritative operator runbook; native exit zero alone is not deployment acceptance.

The prepared main PG18 image transition is blocked from automatic apply. Its [reset/reindex release](../docs/postgresql18-rebuild.md) requires separate approval; cache data and production mounts remain unchanged.

The Railway workflow plans production changes on PR updates. The final apply job
in `ci.yml` depends on build, lint, security, and dependency jobs, then checks
external CodeQL, check runs and reported non-deployment commit statuses for the
merge commit. The latest status per context must succeed. Railway deployment
statuses are excluded because those deployments wait for this CI workflow;
they must be checked after deployment. It applies only the saved
plan for that merged PR's exact head and matching merged `.railway` tree. An
older queued release is rejected if `master` has advanced. Integrations absent
from the merge commit, such as PR-only Snyk statuses, are not required; native
security jobs and CodeQL remain mandatory. Set one Olympus workspace API token as the GitHub
Actions secret `RAILWAY_TOKEN`. The workflow exports it as `RAILWAY_API_TOKEN`
and selects the project and production environment explicitly. No token per
environment is required. Destructive applies are blocked. Preview infrastructure
still needs an explicit operator apply; application autodeploys remain enabled.

If a queued apply is rejected after `master` advances, the merged infrastructure
change remains pending. Generate and review a fresh production plan from current
`master`, then use the documented manual apply procedure. Re-running the old workflow
keeps its original commit and cannot recover the rejected release.

See [the Railway guide](../docs/railway-self-hosting.md) for bootstrap, migration,
variables, plan review, and rollback. Do not commit decrypted plans or secrets.
