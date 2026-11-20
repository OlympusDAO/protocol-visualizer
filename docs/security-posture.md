---

title: Visualizer security posture
status: Source policy; deployment acceptance requires separate verification
---

# Security posture

This document describes the intended boundary in [Railway IaC](../.railway/railway.ts) and [local Compose](../docker-compose.yml). It does **not** assert that these changes have been applied or that deployed services are private. Existing public routes require a provider inventory, reviewed removal targets and separately approved changes.

## Service boundaries and authentication

| Service              | Intended Railway exposure                                       | Authentication and trust boundary                                                                                                                                                                                                                                                                                  | Documentation owner                                                              |
| -------------------- | --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------- |
| `frontend`           | Public HTTP, port 8080; no public TCP proxy                     | Anonymous static UI; reads the public snapshot gateway. No provider or bucket credentials in the frontend.                                                                                                                                                                                                         | User-facing UI; links to gateway API documentation                               |
| `snapshot-gateway`   | Public HTTP, port 8080; no public TCP proxy                     | Anonymous read API. Reads the private bucket with server-side credentials; rejects unsupported routes, methods and request bodies. Bucket contents and the publisher remain trusted inputs.                                                                                                                        | Public REST OpenAPI at `/v1/openapi.json`; `GET`/`HEAD /` return 404             |
| `indexer`            | Private HTTP only                                               | Health/readiness, Envio console state and metrics have no independent HTTP authentication. Private networking is the access boundary. It writes Envio PostgreSQL, uses the Hasura admin secret and calls private eRPC with upstream credentials held by eRPC.                                                      | Repository Markdown only; no ingestion docs site, OpenAPI or `llms.txt` endpoint |
| `hasura`             | Private HTTP only                                               | Admin secret for privileged GraphQL/metadata operations. The image sets an anonymous `public` role: its actual permissions depend on metadata. Network isolation must not be replaced by an assumption that every request requires the admin secret. Production console is disabled; local development enables it. | Internal implementation, not the public REST docs owner                          |
| `Postgres` (Envio)   | Private database connection; no HTTP domain or public TCP proxy | PostgreSQL password and template TLS behavior; used by indexer/Hasura. The source prepares PG18.6; resetting main data needs separate approval. Volume identity, capacity floor, production mount and existing passwords are preserved by IaC.                                                                     | Operations runbooks                                                              |
| `rpc-cache-postgres` | Private database connection; no HTTP domain or public TCP proxy | Separate password/database lifecycle for persistent eRPC responses. An Envio reset must leave this cache intact.                                                                                                                                                                                                   | Cache operations runbook                                                         |
| `rpc-cache`          | Private RPC, health and metrics only                            | No client authentication configured in eRPC. Private networking protects upstream quota, credentials and metrics. Error details/logs are restricted to avoid leaking provider URLs.                                                                                                                                | Internal operations only                                                         |
| `snapshot-publisher` | Private scheduled job; no public listener/domain/proxy          | Uses Hasura admin access, RPC, bucket writes and an outbound Discord webhook. Publishes the manifest last.                                                                                                                                                                                                         | Repository publication/operations documentation                                  |
| `snapshot-monitor`   | Private scheduled job; no public listener/domain/proxy          | Uses private metrics/RPC, bucket state and an outbound Discord webhook.                                                                                                                                                                                                                                            | Repository monitoring documentation                                              |
| Railway Bucket       | Private object storage                                          | Bucket credentials are currently shared with gateway/publisher/monitor. Application read methods do not establish provider-enforced read-only IAM. No credential rotation or IAM change is performed by this work.                                                                                                 | Artifact contract and gateway API docs                                           |

Only `frontend` and `snapshot-gateway` may receive generated Railway HTTP domains. Production custom domains are exactly `protocol-visualizer.olympusdao.finance` and `protocol-visualizer-api.olympusdao.finance`; preview custom-domain maps are empty, with generated domains for these same two public services provisioned separately. No public TCP proxy is intended for any service.

The frontend does not call ingestion/Hasura directly. The boundary is browser → gateway → private bucket, with indexer → PostgreSQL/Hasura → publisher → bucket on the ingestion side. Internal HTTP and credential possession remain trust assumptions; network privacy is not per-service authorization.

## Source guards and deployment acceptance

The final post-SDK policy owns networking maps: private HTTP-domain maps are empty,
and explicit TCP `null` tombstones cover known and imported ports. The plan-time
lookup keeps config in memory and rejects incomplete/paginated metadata, unknown
or duplicate identities, unaccounted active config, malformed ports and private
services with live HTTP domains. Existing database passwords and larger volume
capacities are preserved; only confirmed new databases request generated passwords.

SDK/project regression tests and mocked metadata prove source behavior, not native
backend apply or current deployed privacy. Empty HTTP-domain maps cannot remove
existing provider domains. Review removal targets and obtain separate approval,
then verify the provider inventory before planning. Follow the [native operator
procedure](railway-self-hosting.md#manual-iac-plan-and-deployment) for private artifacts,
approval, JSON-result checks, fresh read-only plan and complete HTTP/TCP inventory.
Native exit zero, source maps and scans do not establish deployment acceptance.

## Data and local boundaries

The [PG18 reset/reindex runbook](postgresql18-rebuild.md) owns production image/path
contracts, derived versus non-rebuildable data, backup and separate data-loss
approval. An Envio reset must preserve external metadata/effect caches and Hasura
customizations as required by that inventory; the separate eRPC cache and bucket
are not reset targets. Envio 3.14.1 and its fail-closed adapters remain unchanged.

Every published Compose port binds `127.0.0.1`; containers still communicate on
the Compose network. Loopback does not authenticate local processes. Development
passwords and the local Hasura console are not production policies. See the
[local stack](local-stack.md) for ports and disposable PostgreSQL fixtures.

## Remaining trust limits and validation

The gateway buffers S3 bodies with SDK `Body.transformToString` before returning
`ContentLength`; it has no streaming byte cap or ordinary per-object deadline.
Readiness has separate abort/deadline logic. Bucket reader/write credential
separation requires provider IAM, not application method selection. Changes to
these boundaries require separate review.

The [validation contract](validation.md) owns tools, commands, evidence and image
policy: owned apps block on findings, configured provider PostgreSQL scans are
advisory and local development/test fixtures are excluded. Historical scanner
findings are neither a fresh clean scan nor proof of exploitability; no global
CVE waiver is implied. Image integration checks ingestion docs absence and health;
actual deployed routes must be checked again during approved deployment acceptance.
