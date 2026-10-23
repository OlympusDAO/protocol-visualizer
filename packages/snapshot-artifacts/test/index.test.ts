import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createOpenApiDocument,
  deploymentArtifactKey,
  parseEnvioMetricsReadiness,
  parseDeploymentId,
  restProtocolPath,
  sanitizeManifestForPublic,
  SCHEMA_VERSION,
  readSnapshotData,
  type SnapshotManifest,
} from "../src/index.js";

test("reads 1.0 and 1.1 additions and rejects unsupported versions clearly", () => {
  const data = { contracts: [], roles: [], roleAssignments: [] };
  assert.deepEqual(readSnapshotData({ schemaVersion: "1.0.0", data }), {
    ...data,
    periodicTasks: [],
    additionalContracts: [],
    contractStates: [],
    relationships: [],
    observation: null,
  });
  const additionalContracts = [
    {
      id: "1:0xabc",
      chainId: 1,
      address: "0xabc",
      name: "External",
      category: "external" as const,
      provenance: { source: "inventory" as const },
    },
  ];
  const extended = { ...data, additionalContracts };
  assert.deepEqual(
    readSnapshotData({ schemaVersion: "1.1.0", data: extended })
      .additionalContracts,
    additionalContracts
  );
  assert.throws(
    () => readSnapshotData({ schemaVersion: "2.0.0", data }),
    /Unsupported snapshot schema version: 2.0.0/
  );
  assert.throws(
    () => readSnapshotData({ schemaVersion: "invalid", data }),
    /Unsupported snapshot schema version: invalid/
  );
});

test("OpenAPI snapshot references resolve within the shared document", () => {
  const document = createOpenApiDocument();
  const snapshot = document.components.schemas.ProtocolSnapshot as Record<
    string,
    unknown
  >;
  assert.equal(
    snapshot.$id,
    undefined,
    "embedding cannot change the reference base URI"
  );
  const walk = (value: unknown): void => {
    if (!value || typeof value !== "object") return;
    const ref = (value as { $ref?: string }).$ref;
    if (ref) {
      const target = ref
        .slice(2)
        .split("/")
        .reduce<unknown>(
          (object, key) => (object as Record<string, unknown>)?.[key],
          document
        );
      assert(target, `unresolved reference: ${ref}`);
    }
    for (const nested of Object.values(value)) walk(nested);
  };
  walk(document);
});

test("builds deployment-scoped artifact keys and REST paths", () => {
  assert.equal(
    deploymentArtifactKey("abc123", 1),
    "v1/deployments/abc123/chain/1/protocol.json"
  );
  assert.equal(restProtocolPath(1), "/v1/chains/1/protocol");
});

test("validates deployment ids before they become object keys", () => {
  assert.equal(parseDeploymentId("abc-123_4.5"), "abc-123_4.5");
  assert.throws(() => parseDeploymentId(""), /required/);
  assert.throws(() => parseDeploymentId("../bad"), /may contain only/);
  assert.throws(() => parseDeploymentId("bad/slash"), /may contain only/);
});

test("removes internal handover details from public manifest", () => {
  const manifest: SnapshotManifest = {
    schemaVersion: SCHEMA_VERSION,
    generatedAt: "2026-06-05T00:00:00.000Z",
    schemas: {
      openapi: "/v1/openapi.json",
      manifest: "/v1/manifest",
      protocolSnapshot: "/v1/chains/{chainId}/protocol",
    },
    chains: [],
    indexerDeploymentId: "secret",
    artifacts: { "1": "v1/deployments/secret/chain/1/protocol.json" },
  };

  assert.deepEqual(sanitizeManifestForPublic(manifest), {
    schemaVersion: SCHEMA_VERSION,
    generatedAt: "2026-06-05T00:00:00.000Z",
    schemas: manifest.schemas,
    chains: [],
  });
});

test("generates the REST OpenAPI document", () => {
  const openapi = createOpenApiDocument();
  assert.equal(openapi.openapi, "3.1.0");
  assert.deepEqual(Object.keys(openapi.paths).sort(), [
    "/healthz",
    "/ready",
    "/v1/bounds",
    "/v1/chains",
    "/v1/chains/{chainId}/protocol",
    "/v1/manifest",
    "/v1/openapi.json",
  ]);
  const healthz = openapi.paths["/healthz"] as Record<
    string,
    { summary: string; responses: Record<string, unknown> }
  >;
  for (const method of ["get", "head"]) {
    assert.equal(healthz[method]?.summary, "Liveness check");
    assert.deepEqual(healthz[method]?.responses["200"], {
      description: "JSON response",
      content: {
        "application/json": {
          schema: { $ref: "#/components/schemas/Ready" },
        },
      },
    });
  }
});

test("parses Envio metrics readiness for supported chains", () => {
  const readiness = parseEnvioMetricsReadiness(
    `
      hyperindex_synced_to_head 1
      envio_progress_ready{chainId="1"} 1
      envio_progress_block{chainId="1"} 25272069
      envio_progress_block_time_seconds{chainId="1"} 1780876800
      envio_progress_events{chainId="1"} 193
      envio_progress_ready{chainId="10"} 1
      envio_progress_block{chainId="10"} 152657692
      envio_progress_block_time_seconds{chainId="10"} 1780876800
    `,
    [
      { key: "Mainnet", chainId: 1 },
      { key: "Optimism", chainId: 10 },
    ],
    new Date("2026-06-08T00:00:00.000Z")
  );

  assert.equal(readiness.ready, true);
  assert.equal(readiness.syncedToHead, true);
  assert.deepEqual(readiness.missingChainIds, []);
  assert.deepEqual(readiness.notReadyChainIds, []);
  assert.deepEqual(readiness.readyChainIds, [1, 10]);
  const mainnetProgress = readiness.indexingProgress.chains.Mainnet;
  assert.ok(mainnetProgress);
  assert.equal(mainnetProgress.block, 25272069);
  assert.equal(mainnetProgress.timestamp, 1780876800);
});

test("uses Envio per-chain progress timestamps when present", () => {
  const readiness = parseEnvioMetricsReadiness(
    `
      hyperindex_synced_to_head 1
      envio_progress_ready{chainId="1"} 1
      envio_progress_block{chainId="1"} 25272069
      envio_progress_block_time_seconds{chainId="1"} 1780491216
      envio_progress_ready{chainId="10"} 1
      envio_progress_block{chainId="10"} 152657692
      envio_progress_block_time_seconds{chainId="10"} 1684540529
    `,
    [
      { key: "Mainnet", chainId: 1 },
      { key: "Optimism", chainId: 10 },
    ],
    new Date("2026-06-08T00:00:00.000Z")
  );

  assert.equal(
    readiness.indexingProgress.chains.Mainnet?.timestamp,
    1780491216
  );
  assert.equal(readiness.indexingProgress.chains.Mainnet?.date, "2026-06-03");
  assert.equal(
    readiness.indexingProgress.chains.Optimism?.timestamp,
    1684540529
  );
  assert.equal(readiness.indexingProgress.chains.Optimism?.date, "2023-05-19");
});

test("missing progress timestamps cannot use observation time as chain coverage", () => {
  const readiness = parseEnvioMetricsReadiness(
    `hyperindex_synced_to_head 1
envio_progress_ready{chainId="1"} 1
envio_progress_block{chainId="1"} 123`,
    [{ key: "Mainnet", chainId: 1 }],
    new Date("2026-10-22T00:00:00.000Z")
  );
  assert.equal(readiness.ready, false);
  assert.equal(readiness.indexingProgress.chains.Mainnet?.timestamp, 0);
  assert.deepEqual(readiness.missingChainIds, [1]);
});

test("blocks readiness when Envio metrics are missing or not ready", () => {
  const readiness = parseEnvioMetricsReadiness(
    `
      hyperindex_synced_to_head 0
      envio_progress_ready{chainId="1"} 1
      envio_progress_block{chainId="1"} 25272069
      envio_progress_block_time_seconds{chainId="1"} 1780876800
      envio_progress_ready{chainId="10"} 0
      envio_progress_block{chainId="10"} 152657692
      envio_progress_block_time_seconds{chainId="10"} 1780876800
    `,
    [
      { key: "Mainnet", chainId: 1 },
      { key: "Optimism", chainId: 10 },
      { key: "Arbitrum", chainId: 42161 },
    ]
  );

  assert.equal(readiness.ready, false);
  assert.equal(readiness.syncedToHead, false);
  assert.deepEqual(readiness.missingChainIds, [42161]);
  assert.deepEqual(readiness.notReadyChainIds, [10, 42161]);
  assert.deepEqual(readiness.readyChainIds, [1]);
});

test("ignores long malformed metrics without regex backtracking", () => {
  const readiness = parseEnvioMetricsReadiness(
    `
      ${"A".repeat(20_000)}{chainId="${"A".repeat(20_000)}"} ${"0".repeat(20_000)}
      envio_progress_ready{chainId="${"00".repeat(20_000)}"} 1
      envio_progress_block{chainId="1"} 123
      envio_progress_block_time_seconds{chainId="1"} 1780876800
      envio_progress_ready{chainId="1"} 1
      hyperindex_synced_to_head 1
    `,
    [{ key: "Mainnet", chainId: 1 }]
  );

  assert.equal(readiness.ready, true);
  assert.equal(readiness.indexingProgress.chains.Mainnet?.block, 123);
});
