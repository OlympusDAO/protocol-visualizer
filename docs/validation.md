# Validation

Use the repository pins in `mise.toml`/`mise.lock`: Node 24.22.3, pnpm 11.28.13, native Railway CLI 5.75.0, Trivy 0.76.2, jactionlint 2.4.0 and Zizmor 1.32.0. Install with `mise install node pnpm railway trivy jactionlint zizmor --locked`. CI pins Mise 2026.11.9 and caches these six tools through the same locked bootstrap. The Railway SDK is separately pinned at 3.16.0. TypeScript 7.0.2 compiles the workspace; `@typescript/typescript6` 6.0.2 remains necessary for contract-metadata AST APIs. Envio is pinned to 3.18.1; native startup owns compatibility checks and exits nonzero on refusal without automatically resetting storage.

<!-- biome-ignore format: keep table cells unpadded -->
| Command | Coverage |
| --- | --- |
| `pnpm validate` | Eight ordered stages: frozen install, runtime alignment, offline codegen, read-only check, typecheck, artifact build, ordinary tests and moderate audit. No Docker/provider connection. |
| `pnpm validate:images` | All seven owned builds and local-tag image scans, every Dockerfile, then offline deployment inventory and required external scans. |
| `pnpm test:integration` | Actual PG18 state/rollback, eRPC persistence/restart, native reset/cache isolation and ingestion docs404/health checks. Docker required; prerequisites cannot skip. |
| `pnpm validate:all` | Source, then image validation, then required integration. Stops at first failure. |
| `pnpm docker:scan:provider` | Optional native provider vulnerability report only; findings advisory, execution/registry errors fail. No builds/local fixtures/Docker daemon. |

GitHub `CI` exposes five independent matrix checks: Runtime versions, Format and lint, Typecheck, Build and Tests. `pnpm check` runs read-only formatting, Biome Assist, code lint and workflow checks once; `pnpm lint` applies safe code fixes, formatting and Assist before workflow lint. `pnpm typecheck` includes IaC and workspace types, preparing dependency declarations through native Turbo ordering. `pnpm build` produces artifacts without ordinary tests; gateway build checks committed OpenAPI drift without changing the specification. Use `pnpm --filter snapshot-gateway run openapi:generate` to regenerate it explicitly. `pnpm test` covers workspace suites, root config/CI fixtures, monitor tests, sample snapshots and ABI checks. Generate offline types before typecheck/tests and build artifacts before tests; the Tests CI cell does both in its isolated checkout. Local `validate` calls the same roles in order. The dedicated dependency audit uses the pinned pnpm audit action for same-repository PR findings/comments; fork audit jobs are skipped before checkout/token use. Non-PR audits remain native, including Monday 00:00 UTC. The seven application images use independent matrix cells with fail-fast disabled. The Cache + integration cell adds one existing indexer build and runs full required integration after successful builds even if scanning fails. This is eight app builds total, with one cheap indexer duplicate and no second Go build or image transfer. Each row checks its Dockerfile; runtime image policy is checked once in the cache cell.

Workflow lint runs native jactionlint correctness/offline checks with explicit excessive-permissions and untrusted-checkout errors, then Zizmor offline strict collection of workflows/actions at auditor persona, medium severity and low confidence. Online audits are not run. Biome rejects focused tests only on test paths; root tests and the RPC integration test receive a native focused-test/self-comparison lint pass alongside workspace lint. Intentional optional PostgreSQL skips remain unchanged; noSkippedTests is not enabled globally.

The source PostgreSQL cases are deliberately deferred to integration: native state/rollback across process restarts. Codegen uses loopback interpolation fixtures, not live RPCs. Missing prerequisites fail; `RPC_CACHE_TEST_SKIP_RESET=1` is rejected. An independently requested integration run may follow a failed security gate, but the fail-fast aggregate does not do this automatically.

## Image policy

The fixed owned list is rpc-cache, indexer, frontend, hasura, snapshot-gateway, snapshot-publisher and snapshot-monitor. Existing builds and scanners use their normal `protocol-visualizer/<service>:local` tags. Owned images must already exist locally; native Trivy uses only Docker/Podman image sources, with no registry fallback, archive export or identity handoff. Avoid concurrent local worktree builds using the same tags. Trivy gates owned MEDIUM/HIGH/CRITICAL vulnerability and secret findings with native table output. Indexer/Hasura explicitly set `--ignore-unfixed=true`; all other owned/external scans set false. Dockerfiles use native misconfiguration scanning. No new CVE exceptions are added.

Podman scans require its local API socket, even though CLI builds do not. On Linux,
start the rootless socket with `systemctl --user start podman.socket` as the same
user that built the images. For another store/socket, set `image.podman.host` in
the repository-root `trivy.yaml` to that socket path. This is
[Trivy's native configuration](https://trivy.dev/docs/v0.76/guide/references/configuration/config-file/#image-options),
read by the validation command without extra CLI arguments. A missing socket
fails with Trivy's native diagnostic; these
scripts do not start services or change the host's socket configuration.

The inventory evaluates the existing SDK definition offline for a context with **no environmentId**; `existingResources` returns before any provider lookup. It examines normalized resource type/engine/source, so SDK default images are included without a custom source interpreter. Repository services must match the fixed builds. Unsupported sources fail, and owned use wins a reference shared with provider/local uses.

Configured Railway PostgreSQL template resources retain their exact pinned reference and resource names as `advisory-provider/not-run` by default. Upstream maintains image contents; this repository selects the pin; findings are reviewed separately, not owned-app failures. Optional provider reporting uses native remote Trivy on linux/amd64, vulnerability-only, MEDIUM/HIGH/CRITICAL including unfixed findings and advisory vulnerability exit 0. Scanner/registry execution errors still fail.

Compose PG18.6, MinIO and MC are each a **local development/test fixture, not deployed by Railway IaC, excluded by explicit user policy**. Inventory output retains refs/origins/reasons. Neither provider advisories nor local exclusions mean scanned/clean. Native output is the report; no raw ImageConfig/environment/history JSON is retained. The scanner cleans only disposable exports, never shared caches.

## Integration and evidence

Integration prepares only its exact official PG18.6 fixture if absent. Prebuilt indexer/eRPC `:local` tags are required; missing owned images fail rather than being pulled. Owned fixture containers use `--pull=never`. No IID files, image maps or historical receipt lookup are used.

Fixtures own uniquely named containers/volumes, including disposable anonymous mounts. Real tests preserve native SQL/effect behavior and every original eRPC cache key/value across reset, allowing legitimate appended rows. Ingestion `/docs`, `/openapi.json`, `/llms.txt` must return 404; health must return 200 and readiness JSON remain available. Gateway OpenAPI belongs to the separate public service. No project volume or production database is reset by validation.

Canonical scripts write `output.log` and a small `result.json` under ignored `.validation/<timestamp>-<group>-<pid>/`, recording command, exit, timing and revision/dirty filenames. They preserve child failure status. Read native test/scanner output directly; no counter/schema/event protocol reconstructs them. Do not add command wrappers/redirection to collect logs. Earlier detailed receipts and scans remain historical, not fresh validation of later edits.

The approved picomatch advisory remains under `audit.ignore`; zero audit exit is not zero advisories. No new advisory waiver is added. Source/image tests do not prove live deployment privacy or successful apply. See [security posture](security-posture.md) and the [native operator runbook](railway-self-hosting.md#manual-iac-plan-and-deployment).
