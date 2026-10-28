import {
  assertRpcConfiguration,
  resolveEnvioProgressTimestamps,
} from "../src/indexer-progress.js";
import assert from "node:assert/strict";
import { test } from "node:test";
import { Ajv2020 } from "ajv/dist/2020.js";
import {
  createOpenApiDocument,
  deploymentArtifactKey,
  parseEnvioMetricsReadiness,
  parseDeploymentId,
  restProtocolPath,
  sanitizeManifestForPublic,
  SCHEMA_VERSION,
  readSnapshotData,
  protocolSnapshotSchema,
  indexingProgressSchema,
  type SnapshotManifest,
} from "../src/index.js";

test("snapshot schemas preserve the legacy contract while keeping 1.1 strict", () => {
  const document = createOpenApiDocument();
  const schemas = [
    protocolSnapshotSchema,
    {
      components: document.components,
      $ref: "#/components/schemas/ProtocolSnapshot",
    },
  ];
  const legacy = {
    schemaVersion: "1.0.0",
    generatedAt: "2026-10-26T00:00:00.000Z",
    chainId: 1,
    recordCounts: { contracts: 1, roles: 1, roleAssignments: 1 },
    data: {
      contracts: [{ legacyContract: true }],
      roles: [{ legacyRole: true }],
      roleAssignments: [{ legacyAssignment: true }],
    },
  };
  const current = {
    ...legacy,
    schemaVersion: "1.1.0",
    recordCounts: { contracts: 0, roles: 0, roleAssignments: 0 },
    data: { contracts: [], roles: [], roleAssignments: [] },
  };
  for (const schema of schemas) {
    const ajv = new Ajv2020({ strict: false, validateFormats: false });
    const validate = ajv.compile(schema);
    for (const payload of [
      legacy,
      { ...legacy, legacyEnvelope: true },
      { ...legacy, recordCounts: { ...legacy.recordCounts, legacyCount: 1 } },
      { ...legacy, data: { ...legacy.data, legacyData: true } },
      current,
    ]) {
      assert.equal(validate(payload), true, ajv.errorsText(validate.errors));
    }
    for (const payload of [
      { ...current, legacyEnvelope: true },
      { ...current, recordCounts: { ...current.recordCounts, legacyCount: 1 } },
      { ...current, data: { ...current.data, legacyData: true } },
      { ...current, data: legacy.data },
      { ...legacy, data: { ...legacy.data, contracts: ["not an object"] } },
      { ...current, schemaVersion: "2.0.0" },
    ]) {
      assert.equal(validate(payload), false, JSON.stringify(payload));
    }
    for (const payload of [legacy, current]) {
      for (const required of ["generatedAt", "recordCounts"]) {
        const missing = { ...payload } as Record<string, unknown>;
        delete missing[required];
        assert.equal(validate(missing), false, JSON.stringify(missing));
      }
    }
  }
});

test("reads 1.0 and 1.1 additions and rejects unsupported versions clearly", () => {
  const data = { contracts: [], roles: [], roleAssignments: [] };
  assert.deepEqual(readSnapshotData({ schemaVersion: "1.0.0", data }), {
    ...data,
    bridgeConfigurations: [],
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
    ]
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
    ]
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

test("missing optional timestamps neither block readiness nor invent chain coverage", () => {
  const readiness = parseEnvioMetricsReadiness(
    `hyperindex_synced_to_head 1
envio_progress_ready{chainId="1"} 1
envio_progress_block{chainId="1"} 123`,
    [{ key: "Mainnet", chainId: 1 }]
  );
  assert.equal(readiness.ready, true);
  assert.equal(readiness.indexingProgress.chains.Mainnet?.timestamp, null);
  assert.equal(readiness.indexingProgress.chains.Mainnet?.date, null);
  assert.deepEqual(readiness.missingChainIds, []);
  assert.equal(
    new Ajv2020().compile(indexingProgressSchema)(readiness.indexingProgress),
    true
  );
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

test("RPC configuration requires a primary URL for each selected chain without exposing values", () => {
  const chains = [{ chainId: 1 }, { chainId: 10 }];
  assert.throws(
    () =>
      assertRpcConfiguration(chains, {
        RPC_URL_1: "  ",
        ENVIO_RPC_URL_10: "https://rpc.example/old-name-placeholder",
      }),
    { message: "Missing required RPC variables: RPC_URL_1, RPC_URL_10" }
  );
  assert.doesNotThrow(() =>
    assertRpcConfiguration(chains, {
      RPC_URL_1: "https://rpc.example/mainnet",
      RPC_URL_10: "https://rpc.example/optimism",
    })
  );
});

test("backfill reports the exact progress block time without making the chain ready", async (t) => {
  const chains = [{ key: "Test", chainId: 999 }];
  t.mock.method(
    globalThis,
    "fetch",
    async (...[url, init]: Parameters<typeof fetch>) => {
      assert.equal(url, "https://rpc.example");
      const request = JSON.parse(String(init?.body));
      assert.equal(request.method, "eth_getBlockByNumber");
      assert.deepEqual(request.params, ["0x7b", false]);
      return Response.json({
        result: { number: "0x7b", timestamp: "0x6a207221" },
      });
    }
  );

  const readiness = await resolveEnvioProgressTimestamps(
    parseEnvioMetricsReadiness(
      `hyperindex_synced_to_head 0
envio_progress_ready{chainId="999"} 0
envio_progress_block{chainId="999"} 123`,
      chains
    ),
    { RPC_URL_999: "https://rpc.example" }
  );
  assert.equal(readiness.ready, false);
  assert.deepEqual(readiness.notReadyChainIds, [999]);
  assert.deepEqual(readiness.missingChainIds, []);
  assert.equal(readiness.indexingProgress.chains.Test?.timestamp, 1780511265);
  assert.equal(readiness.indexingProgress.chains.Test?.date, "2026-06-03");
});

test("missing, invalid and failed RPC block lookups leave time unavailable without blocking readiness", async (t) => {
  const chains = [{ key: "Test", chainId: 999 }];
  const fetchMock = t.mock.method(globalThis, "fetch");
  for (const result of [
    null,
    { number: "0x7c", timestamp: "0x6a207221" },
    { number: "0x7b", timestamp: "0x0" },
    { number: "0x7b", timestamp: "bogus" },
    "network failure",
  ]) {
    fetchMock.mock.mockImplementation(async () => {
      if (result === "network failure") throw new Error("fetch failed");
      return Response.json({ result });
    });
    const readiness = await resolveEnvioProgressTimestamps(
      parseEnvioMetricsReadiness(
        `hyperindex_synced_to_head 1
envio_progress_ready{chainId="999"} 1
envio_progress_block{chainId="999"} 123`,
        chains
      ),
      { RPC_URL_999: "https://rpc.example" }
    );
    assert.equal(readiness.ready, true);
    assert.deepEqual(readiness.indexingProgress.chains.Test, {
      chainId: 999,
      block: 123,
      timestamp: null,
      date: null,
    });
  }
});

test("Envio block times need no RPC lookup", async (t) => {
  const fetchMock = t.mock.method(globalThis, "fetch", async () => {
    throw new Error("unexpected RPC lookup");
  });

  const chains = [{ key: "Test", chainId: 999 }];
  const readiness = await resolveEnvioProgressTimestamps(
    parseEnvioMetricsReadiness(
      `hyperindex_synced_to_head 1
envio_progress_ready{chainId="999"} 1
envio_progress_block{chainId="999"} 123
envio_progress_block_time_seconds{chainId="999"} 1780491216`,
      chains
    ),
    { RPC_URL_999: "https://rpc.example" }
  );
  assert.equal(readiness.indexingProgress.chains.Test?.timestamp, 1780491216);
  assert.equal(readiness.ready, true);
  assert.equal(fetchMock.mock.calls.length, 0);
});

test("no RPC request is made without configured Envio endpoints", async (t) => {
  const fetchMock = t.mock.method(globalThis, "fetch", async () => {
    return Response.json({
      result: { number: "0x7b", timestamp: "0x6a207221" },
    });
  });

  const chains = [{ key: "Mainnet", chainId: 1 }];
  const readiness = await resolveEnvioProgressTimestamps(
    parseEnvioMetricsReadiness(
      `hyperindex_synced_to_head 1
envio_progress_ready{chainId="1"} 1
envio_progress_block{chainId="1"} 123`,
      chains
    ),
    {}
  );
  assert.equal(fetchMock.mock.calls.length, 0);
  assert.equal(readiness.ready, true);
  assert.equal(readiness.indexingProgress.chains.Mainnet?.timestamp, null);
  assert.equal(readiness.indexingProgress.chains.Mainnet?.date, null);
});

test("failed RPC requests keep private settings out of results and logs", async (t) => {
  const privateUrl = "https://rpc.example/private-credential-placeholder";
  const requested: string[] = [];
  const errors = t.mock.method(console, "error", () => {});
  t.mock.method(
    globalThis,
    "fetch",
    async (url: Parameters<typeof fetch>[0]) => {
      requested.push(String(url));
      throw new Error(`Request failed: ${privateUrl}`);
    }
  );

  const chains = [{ key: "Test", chainId: 999 }];
  const readiness = await resolveEnvioProgressTimestamps(
    parseEnvioMetricsReadiness(
      `hyperindex_synced_to_head 0
envio_progress_ready{chainId="999"} 0
envio_progress_block{chainId="999"} 123`,
      chains
    ),
    { RPC_URL_999: privateUrl }
  );
  assert.deepEqual(requested, [privateUrl]);
  assert.equal(readiness.indexingProgress.chains.Test?.date, null);
  assert.doesNotMatch(
    JSON.stringify(readiness),
    /rpc\.example|credential-placeholder/
  );
  assert.equal(errors.mock.calls.length, 0);
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
