# Changelog

## 0.1.0

- Add private persistent RPC caching and preserve compatible Envio effect results
  across explicit schema resets. Envio remains pinned to 3.14.1.
- Declare frontend and snapshot gateway as public services; keep ingestion,
  Hasura, RPC cache and databases private in Railway IaC.
- Use trusted merged-master CI for native Railway plan/apply, with required checks
  and a separate approval path for destructive PostgreSQL changes. Live environment
  protection and secret migration remain administrator prerequisites.
- Prepare PostgreSQL 18.6 and fresh ephemeral local volumes, with a separately
  approved production reset/reindex procedure.
- Keep the gateway data API and OpenAPI document while removing its HTML root page.
- Standardize locked tools, source checks, owned-image security scans and required
  integration fixtures. Provider database scans are advisory; local fixtures are
  excluded from the default security gate.

This version identifies repository changes, not a completed production deployment.
