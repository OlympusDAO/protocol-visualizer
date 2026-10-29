# Private RPC cache

Provision **two new Railway resources manually**: `rpc-cache` (this repository,
config `/railway-rpc-cache.json`) and `rpc-cache-postgres` (a separate Postgres
service with persistent storage). Do not reuse the Envio database or role.
No infrastructure resources or live variables are created by this change.

## Image and request behavior

`Dockerfile-rpc-cache` builds the checksum-verified
[eRPC 0.5.0 source release](https://github.com/erpc/erpc/releases/tag/0.5.0)
(commit `204f98cb`) as `0.5.0-pv1`. The upstream image was verified at manifest
`sha256:1d0687aa7b8eb13253a5802e0d56e23a39a0add25b4defd22eeb4985ef654c5c`.
A local source build is necessary because the unmodified release can echo
provider credentials in client RPC errors and contains older Go dependencies.
`services/rpc-cache/private-errors.patch` makes `includeErrorDetails: false`
replace error messages with `RPC request failed`, discard provider text/object
data, and preserve only validated hex revert bytes and numeric RPC codes. A fixed
`historical state is not available` message preserves existing indexer fallback
classification without forwarding provider text.
Rebase/review that patch whenever upgrading eRPC. No cache behavior is patched.

Go 1.26.10, `golang.org/x/crypto` 0.57.0 and `golang.org/x/net` 0.60.0 are pinned
security updates scoped to this service. The final image contains only the
binary, JS config, and pinned nonroot distroless static runtime; it omits the
profiler binary and config SDK. Monorepo dependency versions are unchanged.
The JS configuration uses the release's
[configuration types](https://github.com/erpc/erpc/blob/0.5.0/common/config.go),
[cache implementation](https://github.com/erpc/erpc/blob/0.5.0/architecture/evm/json_rpc_cache.go),
and [finality implementation](https://github.com/erpc/erpc/blob/0.5.0/architecture/evm/evm_state_poller.go).
It uses eRPC's embedded JS loader; no Node runtime or config SDK is needed.

One project, `pv`, serves `/pv/evm/<chainId>`. Cache keys include the chain,
method, and all parameters, including block references, log bounds, topics,
addresses, state overrides, and full-transaction flags. JSON object key order
and equivalent hex casing are normalized by eRPC. JSON-RPC request IDs do not
identify cache entries. Successful eligible misses go to the configured archive
provider and are asynchronously written to Postgres. Cache hits avoid provider
calls. New requests pass through; persistence is shared across eRPC restarts and
consumer redeployments. Postgres expiry is NULL for the immutable policies.

Only the explicitly listed read methods in `services/rpc-cache/erpc.js` are
cacheable. Numeric historical reads require an observed provider `finalized`
head at or above their block. Log caching requires **both explicit numeric bounds**, with the upper bound
finalized. Missing, hash-only, or tagged log bounds bypass cache. Hash lookups need a resolvable block number; unknown finality bypasses
storage. EIP-1898 calls that cannot establish finality also pass through.
`latest`, `pending`, `safe`, moving `finalized` tags, and unfinalized reads bypass
cache. Interpolation is disabled so moving tags cannot become permanent keys.
RPC errors and transport failures are never cached. Missing block/transaction
results are excluded; legitimate `0x`, `0x0`, and empty log arrays are allowed
only for finalized blocks. Large log requests may be split sequentially by eRPC;
subrequests retain their own bounds. The release's default maximum accepted log
range is 30,000 blocks; wider requests fail clearly instead of incurring an
unbounded scan. Split wide rebuild queries at the caller or deliberately tune
that limit in eRPC after checking provider limits.

### Finality per chain

No shared confirmation-depth assumption is used. eRPC 0.5.0 otherwise infers
finality when a provider does not support `finalized`. The configured
`fallbackFinalityDepth=9007199254740991` exceeds practical EVM heights, preventing
that fallback from authorizing storage. This is a release-specific workaround,
covered by an actual-image test with a high head and an unsupported finalized
tag. Keep that regression test when upgrading eRPC.

| Chain | ID | Required finality signal and verification boundary |
| --- | --- | --- |
| Ethereum | 1 | Execution RPC `finalized`, from Ethereum consensus |
| Optimism | 10 | OP Stack finalized L2 head derived from finalized L1 data |
| Arbitrum | 42161 | Nitro finalized batch inherited from Ethereum finality |
| Base | 8453 | OP Stack finalized L2 head derived from finalized L1 data |
| Berachain | 80094 | Provider's finalized execution head backed by BeaconKit consensus |
| Robinhood | 4663 | Verify the deployed chain/provider's Nitro parent-finality configuration before relying on its tag |
| Sepolia | 11155111 | Execution RPC `finalized`, from Sepolia consensus |
| Arbitrum Sepolia | 421614 | Nitro finalized batch inherited from Sepolia finality |
| Base Sepolia | 84532 | OP Stack finalized L2 head derived from finalized Sepolia data |

See [Arbitrum's finality guidance](https://developer.arbitrum.io/how-arbitrum-works/reference/finality-and-reorgs),
[OP Stack finality](https://specs.optimism.io/protocol/derivation.html),
and [BeaconKit](https://github.com/berachain/beacon-kit).
A provider returning a tag is evidence of API support, not proof that the tag
has correct consensus semantics. Confirm archive depth, EIP-1898 support, and
finalized-tag semantics for **each selected provider** before cutover, especially
Robinhood. Unsupported or unavailable finality leaves numeric requests uncached;
it does not cause recent blocks to be guessed final. A previously observed
finalized watermark remains safe if a provider later becomes unavailable.

## Railway variables and private networking

On `rpc-cache` (Required):

```text
PORT=4000
RPC_CACHE_DATABASE_URL=${{rpc-cache-postgres.DATABASE_URL}}
UPSTREAM_RPC_URL_1=<Ethereum archive provider URL>
UPSTREAM_RPC_URL_10=<Optimism archive provider URL>
UPSTREAM_RPC_URL_42161=<Arbitrum archive provider URL>
UPSTREAM_RPC_URL_8453=<Base archive provider URL>
UPSTREAM_RPC_URL_80094=<Berachain archive provider URL>
UPSTREAM_RPC_URL_4663=<Robinhood archive provider URL>
UPSTREAM_RPC_URL_11155111=<Sepolia archive provider URL>
UPSTREAM_RPC_URL_421614=<Arbitrum Sepolia archive provider URL>
UPSTREAM_RPC_URL_84532=<Base Sepolia archive provider URL>
```

Optional: `RPC_CACHE_MAX_RPS=50`. This is one aggregate upstream request budget
per second per eRPC instance, shared by all nine providers, including polling.
Start with **one replica**; multiple replicas multiply the provider budget.
Tune it to the provider account's actual allowance. Cache hits do not spend this
budget. eRPC polls state every 30 seconds, including idle chains. Finality may
lag and reduce hit rate; this is conservative. Retries have two sequential
network attempts and one attempt per upstream; empty and pending retries are
disabled. No hedging, consensus fan-out, or public provider fallbacks are
configured. Add approved failover providers only inside eRPC, with their own
budgets. Envio may still retry its own failed ingestion requests; the proxy
owns the provider budget and retries for each request.

On `indexer`, set all existing `ENVIO_RPC_URL_<chainId>` variables to:

```text
ENVIO_RPC_URL_1=http://${{rpc-cache.RAILWAY_PRIVATE_DOMAIN}}:4000/pv/evm/1
ENVIO_RPC_URL_10=http://${{rpc-cache.RAILWAY_PRIVATE_DOMAIN}}:4000/pv/evm/10
ENVIO_RPC_URL_42161=http://${{rpc-cache.RAILWAY_PRIVATE_DOMAIN}}:4000/pv/evm/42161
ENVIO_RPC_URL_8453=http://${{rpc-cache.RAILWAY_PRIVATE_DOMAIN}}:4000/pv/evm/8453
ENVIO_RPC_URL_80094=http://${{rpc-cache.RAILWAY_PRIVATE_DOMAIN}}:4000/pv/evm/80094
ENVIO_RPC_URL_4663=http://${{rpc-cache.RAILWAY_PRIVATE_DOMAIN}}:4000/pv/evm/4663
ENVIO_RPC_URL_11155111=http://${{rpc-cache.RAILWAY_PRIVATE_DOMAIN}}:4000/pv/evm/11155111
ENVIO_RPC_URL_421614=http://${{rpc-cache.RAILWAY_PRIVATE_DOMAIN}}:4000/pv/evm/421614
ENVIO_RPC_URL_84532=http://${{rpc-cache.RAILWAY_PRIVATE_DOMAIN}}:4000/pv/evm/84532
```

On **both** `snapshot-publisher` and
`snapshot-monitor`, set the same nine paths under `RPC_URL_<chainId>`:

```text
RPC_URL_1=http://${{rpc-cache.RAILWAY_PRIVATE_DOMAIN}}:4000/pv/evm/1
RPC_URL_10=http://${{rpc-cache.RAILWAY_PRIVATE_DOMAIN}}:4000/pv/evm/10
RPC_URL_42161=http://${{rpc-cache.RAILWAY_PRIVATE_DOMAIN}}:4000/pv/evm/42161
RPC_URL_8453=http://${{rpc-cache.RAILWAY_PRIVATE_DOMAIN}}:4000/pv/evm/8453
RPC_URL_80094=http://${{rpc-cache.RAILWAY_PRIVATE_DOMAIN}}:4000/pv/evm/80094
RPC_URL_4663=http://${{rpc-cache.RAILWAY_PRIVATE_DOMAIN}}:4000/pv/evm/4663
RPC_URL_11155111=http://${{rpc-cache.RAILWAY_PRIVATE_DOMAIN}}:4000/pv/evm/11155111
RPC_URL_421614=http://${{rpc-cache.RAILWAY_PRIVATE_DOMAIN}}:4000/pv/evm/421614
RPC_URL_84532=http://${{rpc-cache.RAILWAY_PRIVATE_DOMAIN}}:4000/pv/evm/84532
```

Use the service's actual private domain if its name differs. Do not create a
public Railway domain or TCP proxy. No authentication is configured: this
service trusts the private environment network. HTTP listens on `[::]:4000`
(dual stack) for Railway private IPv6 and local IPv4. `/healthcheck` is an HTTP
liveness endpoint; it does **not** certify all providers or Postgres availability.
Verify a real miss and repeat hit after readiness, plus database health.
Metrics are private on port 4001. No Docker shell, curl, or Node is available in
the eRPC image; Railway supplies the HTTP health probe.

The Docker build needs no secrets. Runtime config rejects missing database or
any of the nine upstream settings with the variable name only. Keep upstream
URLs exclusively on eRPC; they must never appear in `VITE_*`, public chain
catalogs, snapshots, Docker build args, or committed files. `includeErrorDetails`
is false. Runtime eRPC logging is disabled because lower-level transport errors
or provider bodies can contain URLs; use metrics and private health checks.
The startup loader still reports missing/invalid variable names. Do not enable
debug/config dumps with real credentials. The local source patch also sanitizes
provider-origin RPC error messages and
non-hex error data. Fixture errors deliberately echo URL path/query secrets to
verify they never reach clients or logs; numeric codes and hex revert data
remain available to callers.

HyperSync remains the indexer's event source when `ENVIO_API_TOKEN` is set and
`ENVIO_RPC_MODE` is empty/`fallback`. eRPC serves JSON-RPC only. No new HyperSync
or provider credentials belong on the publisher, monitor, or frontend. Existing
Envio handler clients require their configured endpoint and perform no viem
retry or public fallback; `ENVIO_RPC_URL_FALLBACK_*` is no longer used.

## Indexer resets and cache persistence

Normal indexer deployments resume compatible state. Deliberate resets and the
manual SSH procedure are documented in [indexer-operations.md](indexer-operations.md).
The cache uses its own database and survives Envio schema resets. Leave the
cache service and its database intact during an indexer rebuild.

## Local operation and validation

Copy `.env.compose.sample` to `.env` and supply the nine `UPSTREAM_RPC_URL_*`
values, Envio token, and Etherscan key. Compose routes consumers to eRPC without
requiring per-consumer URL edits. `rpc-cache-postgres-data` is a new named volume;
existing `postgres-data` and `minio-data` are unchanged. `docker compose down`
keeps all volumes; do not use `down --volumes` for this stack.

```bash
pnpm run docker:build:rpc-cache
pnpm run docker:build:indexer
pnpm run test:rpc-cache
```

The integration check uses the real pinned images, disposable Postgres
containers, and a counted HTTP fixture upstream. It checks chain/parameter/block
isolation, permanent rows, legitimate empties, mixed log ranges, unfinalized and
unknown-finality bypass, RPC/transport errors, restart persistence, new queries,
and an actual distroless Envio reset against a separate disposable database
(with a fixture Hasura metadata endpoint). A canary table proves the reset
clears Envio's schema while cache rows and hits remain intact.
It removes only containers/networks created by that test and creates no project
volumes. Fixture evidence does not establish live provider behavior.

## Security validation boundary

The original official image scan reported 29 unique MEDIUM/HIGH advisory IDs
(58 occurrences across its normal and profiling binaries). Rebuilding with the
pinned compiler/modules above and omitting the profiler reduced the final image
to **one HIGH advisory**: `CVE-2026-32286` in
`github.com/jackc/pgproto3/v2` 2.3.3. Trivy 0.76.1 reports no fixed version.
A malicious or compromised PostgreSQL server can send a malformed DataRow that
panics this client. The dedicated private database narrows exposure but does
not remediate the vulnerable dependency.

A seven-day repository-wide exception was approved on 2026-10-29. The root
`.trivyignore` suppresses this advisory across all image scans until
**2026-11-05 at 00:00 UTC**. All other findings retain their existing handling.
Trivy enforces the expiration date; the next scan after expiry reports the
advisory and fails if the dependency remains vulnerable. Existing weekly scans
and scans on PR changes still run. Expiry does not stop a running service.

Before expiry, recheck upstream for a fix and rebuild the image if one exists.
Remove the exception after remediation. Any extension needs explicit approval
and a new deadline; do not renew it automatically. A passing scan during this
window means the known risk is temporarily accepted, not fixed.

## Deployment order and rollback checklist

- Confirm the image security finding is fixed or the approved exception above
  remains valid before cutover.
- Provision `rpc-cache-postgres` with a dedicated role/database and persistent
  volume; configure backups, monitor disk growth, and confirm the DSN targets it.
- Create `rpc-cache`, select `/railway-rpc-cache.json`, set the variables above,
  keep it private, deploy one replica, and check database initialization.
- For each chain, verify the real provider's chain ID, finalized head, archive
  reads, and log limits. Send a numeric finalized historical request twice and
  check `X-ERPC-Cache: MISS` then `HIT`. Check `/healthcheck` and private metrics.
- Update all nine consumer URLs on indexer, publisher, and monitor. Keep the
  Envio DB, token, and HyperSync mode. Deploy the consumer images with the resume
  wrapper. Verify progress advances and snapshots publish normally.
- On proxy problems, stop consumers, restore their previous server-side provider
  URLs, and restart with the **resume-capable image**. Keep the cache DB intact.
  Do not roll back to the old automatic-reset wrapper. Rolling back eRPC requires
  checking cache-schema compatibility or restoring a cache backup; never discard
  Envio state to recover the proxy. Cache deletion is a separate deliberate
  operation, not part of a normal rollback.

## Recorded local validation (2026-10-29)

Node 24.22.1 and pnpm 11.28.7 were used. The required sequence passed in order:
runtime version check, frozen install, lint, build, sample snapshots, indexer
image, frontend image, gateway image, publisher image. The first lint attempt
stopped on an unused import introduced by this change; it was removed and the
sequence restarted from step 1. No required command was skipped.

The actual `0.5.0-pv1` service image passed fixture integration on all nine
routes, including 17 distinct non-expiring Postgres rows, repeat hits, block and
parameter isolation, restart persistence, unknown/unfinalized/moving-tag bypass,
numeric and mixed log ranges, pending/safe/omitted log bounds, error bypass,
credential-echo suppression, valid hex revert data, and new queries. The actual
distroless indexer image ran `local db-migrate setup` twice through its wrapper;
a canary proved Envio schema reset, while cache rows and hits survived. Hasura
metadata responses were a fixture. Existing startup tests prove default resume
arguments and explicit restart arguments; no full live indexing run was made.

Compose interpolation verified all 27 consumer URLs. eRPC startup without
required settings failed with a variable-name-only message. Dockerfile Trivy
checks passed. Without the exception, the final-image Trivy scan reports the
one HIGH advisory above. With the approved exception, Trivy 0.76.1 returns zero.
A control scan with an expired copy returns exit code 1 and reports the same
advisory. The underlying vulnerability remains. Local source review found and
closed the two regressions reproduced against the original image (tagged log caching and
credential echo). No live archive providers were tested: no configured RPC
credentials were found in the session or local indexer/root env files. All nine
real providers, especially Robinhood's finality semantics and archive/EIP-1898
support, still need verification before cutover. Hash-bound calls with unknown
finality remain deliberately uncached and may limit rebuild savings.
