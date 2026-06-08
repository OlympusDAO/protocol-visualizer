# Railway configuration

This project defines its Railway infrastructure in code.

```txt
.railway/railway.ts
```

Use this file to describe the Railway project: services, Postgres, the
snapshot bucket, groups, Docker builds, cron jobs, healthchecks, restart
policies, resource limits, and environment variables.

## Common commands

Evaluate the TypeScript graph locally:

```bash
pnpm run railway:iac:check
```

Preview what Railway would change in the linked environment:

```bash
pnpm run railway:iac:plan
```

Apply the planned changes after reviewing the plan:

```bash
railway config apply
```

Import the linked Railway project's current configuration if the SDK supports
the live resource shape:

```bash
railway config pull
```

Deploy this directory:

```bash
railway up
```

If `.railway/railway.ts` has pending project changes, `railway up` previews them and asks before applying them.

## Notes

- `railway config plan` is safe and does not change Railway.
- `railway config apply` asks before applying unless you pass `--yes`.
- `railway up` deploys this directory when the service has no GitHub or image
  source.
- The old per-service `railway-*.json` files have been removed. This directory
  is the only repo-owned Railway configuration.
- The GitHub source branch is one value per environment and is derived from the
  Railway environment name.
- `.railway/railway.ts` fails fast if Railway does not provide an environment
  name. The offline `railway:iac:check` script supplies `local` explicitly for
  local graph validation.
- The snapshot bucket resource name is generated per environment as
  `snapshots-<environment-slug>-<stable-id>`.
- Use `replicas` for scaling; advanced placement can still specify region names.
- Use `group("Name", [resources])` to keep large projects organized on the Railway canvas.
- Required secrets and external service values use `preserveExisting: true` with
  `isOptional: false`. This keeps existing Railway values intact without
  weakening the required-variable contract.
