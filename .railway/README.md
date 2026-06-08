# Railway configuration

This project defines its Railway infrastructure in code.

```txt
.railway/railway.ts
```

Use this file to describe the Railway project: services, Postgres, the
snapshot bucket, groups, Docker builds, cron jobs, healthchecks, restart
policies, resource limits, and environment variables.

## Common commands

Select the Railway environment before planning or applying IaC changes:

```bash
railway environment <environment-name>
```

Make sure the local checkout is on the Git branch this environment should
build, then push the changes:

```bash
git branch --show-current
git push
```

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

Use `railway config apply` only when `.railway/railway.ts` changes service,
bucket, variable, build, deploy, healthcheck, cron, or resource-limit
configuration. Ordinary application code changes should be pushed and deployed
by Railway from GitHub; they do not need a config apply.

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
- Run `railway environment <environment-name>` first so the plan/apply targets
  the intended environment.
- The GitHub source branch is one value shared by every service in the
  environment. `.railway/railway.ts` derives it from the local Git checkout, so
  run plan/apply from the branch Railway should build.
- `railway up` deploys this directory when the service has no GitHub or image
  source.
- The old per-service `railway-*.json` files have been removed. This directory
  is the only repo-owned Railway configuration.
- `.railway/railway.ts` fails fast if Railway does not provide an environment
  name or if the source branch cannot be determined from the local Git checkout.
- The snapshot bucket resource name is generated per environment as
  `snapshots-<environment-slug>-<stable-id>`.
- Use `replicas` for scaling; advanced placement can still specify region names.
- Use `group("Name", [resources])` to keep large projects organized on the Railway canvas.
- Required secrets and external service values use `preserveExisting: true` with
  `isOptional: false`. This keeps existing Railway values intact without
  weakening the required-variable contract.
