import assert from "node:assert/strict";
import { createServer, request as httpRequest } from "node:http";
import { test } from "node:test";
import { once } from "node:events";
import {
  ACTIVE_MANIFEST_KEY,
  SCHEMA_VERSION,
  type SnapshotManifest,
} from "@protocol-visualizer/snapshot-artifacts";
import {
  createReadinessReporter,
  createSnapshotGateway,
  fatalErrorDetails,
  type GatewayConfig,
  type GatewayLogger,
  type ObjectReader,
} from "../src/server.js";

const manifest: SnapshotManifest = {
  schemaVersion: SCHEMA_VERSION,
  generatedAt: "2026-06-05T00:00:00.000Z",
  indexerDeploymentId: "deployment-a",
  schemas: {
    openapi: "/v1/openapi.json",
    manifest: "/v1/manifest",
    protocolSnapshot: "/v1/chains/{chainId}/protocol",
  },
  indexingProgress: {
    chains: {
      Mainnet: {
        chainId: 1,
        date: "2026-06-05",
        timestamp: 1780272000,
        block: 123,
      },
    },
  },
  artifacts: {
    "1": "v1/deployments/deployment-a/chain/1/protocol.json",
  },
  chains: [
    {
      chainId: 1,
      name: "Mainnet",
      path: "/v1/chains/1/protocol",
      generatedAt: "2026-06-05T00:00:00.000Z",
      recordCounts: { contracts: 1, roles: 1, roleAssignments: 1 },
    },
  ],
};

const legacyManifest = {
  schemaVersion: SCHEMA_VERSION,
  generatedAt: "2026-06-05T00:00:00.000Z",
  schemas: {
    manifest: "/v1/schemas/manifest-v1.schema.json",
    protocolSnapshot: "/v1/schemas/protocol-snapshot-v1.schema.json",
  },
  chains: [
    {
      chainId: 1,
      name: "Mainnet",
      path: "/v1/chain/1/protocol.json",
      generatedAt: "2026-06-05T00:00:00.000Z",
      recordCounts: { contracts: 1, roles: 1, roleAssignments: 1 },
    },
  ],
} as SnapshotManifest;

class FakeReader implements ObjectReader {
  keys: string[] = [];
  constructor(private readonly objects: Record<string, string>) {}

  async getObject(key: string, _signal?: AbortSignal) {
    this.keys.push(key);
    const body = this.objects[key];
    if (body === undefined) throw new Error("missing");
    return { body };
  }

  async headObject(key: string, _signal?: AbortSignal) {
    this.keys.push(`head:${key}`);
    if (this.objects[key] === undefined) throw new Error("missing");
  }
}

const silentLogger: GatewayLogger = {
  error: () => {},
  info: () => {},
};

const createRecordingLogger = () => {
  const errors: Array<{
    message: string;
    details: Record<string, unknown>;
  }> = [];
  const infos: Array<{
    message: string;
    details: Record<string, unknown>;
  }> = [];
  const logger: GatewayLogger = {
    error: (message, details) => errors.push({ message, details }),
    info: (message, details) => infos.push({ message, details }),
  };
  return { errors, infos, logger };
};

const createTestConfig = (
  reader: ObjectReader,
  options: {
    logger?: GatewayLogger;
    readinessOperationTimeoutMs?: number;
  } = {}
): GatewayConfig => ({
  reader,
  logger: options.logger ?? silentLogger,
  readinessOperationTimeoutMs: options.readinessOperationTimeoutMs,
  openapiPath: "missing-openapi.json",
  chains: [
    {
      key: "Mainnet",
      chainId: 1,
      name: "Mainnet",
      explorerBaseUrl: "https://etherscan.io",
    },
  ],
});

test("gateway rejects invalid readiness operation timeouts", () => {
  const reader = new FakeReader({});
  for (const value of [0, -1, 1.5, Number.NaN]) {
    assert.throws(
      () =>
        createSnapshotGateway(
          createTestConfig(reader, { readinessOperationTimeoutMs: value })
        ),
      /readinessOperationTimeoutMs must be a positive integer/
    );
  }
});

test("fatal error details include configuration messages", () => {
  assert.deepEqual(fatalErrorDetails(new Error("BUCKET is required")), {
    errorName: "Error",
    message: "BUCKET is required",
  });
  assert.deepEqual(fatalErrorDetails("unknown failure"), {});
});

async function request(
  path: string,
  options: {
    method?: string;
    body?: string;
    reader?: FakeReader;
    logger?: GatewayLogger;
    readinessOperationTimeoutMs?: number;
  } = {}
) {
  const reader =
    options.reader ??
    new FakeReader({
      [ACTIVE_MANIFEST_KEY]: JSON.stringify(manifest),
      "v1/deployments/deployment-a/chain/1/protocol.json": JSON.stringify({
        schemaVersion: SCHEMA_VERSION,
        chainId: 1,
        generatedAt: manifest.generatedAt,
        recordCounts: { contracts: 1, roles: 1, roleAssignments: 1 },
        data: { contracts: [], roles: [], roleAssignments: [] },
      }),
    });
  const config = createTestConfig(reader, options);
  const server = createServer(createSnapshotGateway(config));
  const listening = once(server, "listening");
  server.listen(0, "127.0.0.1");
  await listening;
  const address = server.address();
  assert(typeof address === "object" && address !== null);
  try {
    if (options.body && (options.method ?? "GET") === "GET") {
      const raw = await new Promise<{
        status: number;
        headers: Record<string, string | string[] | undefined>;
        text: string;
      }>((resolveRequest, reject) => {
        const req = httpRequest(
          {
            hostname: "127.0.0.1",
            port: address.port,
            path,
            method: "GET",
            headers: {
              "content-length": Buffer.byteLength(options.body ?? ""),
            },
          },
          (res) => {
            const chunks: Buffer[] = [];
            res.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
            res.on("end", () =>
              resolveRequest({
                status: res.statusCode ?? 0,
                headers: res.headers,
                text: Buffer.concat(chunks).toString("utf8"),
              })
            );
          }
        );
        req.on("error", reject);
        req.end(options.body);
      });
      return {
        response: {
          status: raw.status,
          headers: { get: (key: string) => raw.headers[key.toLowerCase()] },
        },
        text: raw.text,
        reader,
      };
    }

    const response = await fetch(`http://127.0.0.1:${address.port}${path}`, {
      method: options.method ?? "GET",
      body: options.body,
    });
    const text = await response.text();
    return { response, text, reader };
  } finally {
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
  }
}

test("serves REST protocol snapshots through active manifest artifact keys", async () => {
  const { response, text, reader } = await request("/v1/chains/1/protocol");
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert(
    reader.keys.includes("v1/deployments/deployment-a/chain/1/protocol.json")
  );
  assert.equal(JSON.parse(text).chainId, 1);
});

test("rejects old static routes and unsupported query params", async () => {
  assert.equal(
    (await request("/v1/chain/1/protocol.json")).response.status,
    404
  );
  assert.equal((await request("/v1/manifest.json")).response.status, 404);
  assert.equal((await request("/v1/chains?x=1")).response.status, 400);
});

test("does not expose deployment ids or object keys in public manifest", async () => {
  const { text } = await request("/v1/manifest");
  assert(!text.includes("deployment-a"));
  assert(!text.includes("v1/deployments"));
});

test("reports bounds with indexing progress", async () => {
  const { response, text } = await request("/v1/bounds");
  assert.equal(response.status, 200);
  const body = JSON.parse(text);
  assert.equal(body.data.generatedAt, manifest.generatedAt);
  assert.equal(body.data.activeDeployment, undefined);
  assert.equal(body.data.indexingProgress.chains.Mainnet.block, 123);
});

test("rejects request bodies and unsupported methods", async () => {
  assert.equal(
    (await request("/v1/chains/1/protocol", { body: "{}" })).response.status,
    400
  );
  assert.equal(
    (await request("/v1/chains/1/protocol", { method: "POST" })).response
      .status,
    405
  );
});

test("healthz reports process liveness without accessing snapshot storage", async () => {
  const missing = new FakeReader({});
  const { response, text } = await request("/healthz", { reader: missing });

  assert.equal(response.status, 200);
  assert.deepEqual(JSON.parse(text), { ok: true });
  assert.deepEqual(missing.keys, []);
});

test("ready requires manifest access", async () => {
  assert.equal((await request("/ready")).response.status, 200);
  const missing = new FakeReader({});
  assert.equal(
    (await request("/ready", { reader: missing })).response.status,
    503
  );
});

test("ready logs sanitized storage failures", async () => {
  const { errors, logger } = createRecordingLogger();
  const reader = new FakeReader({});
  reader.getObject = async () => {
    throw Object.assign(new Error("secret endpoint and credentials"), {
      name: "S3ServiceException",
      code: "AccessDenied",
      $metadata: { httpStatusCode: 403 },
    });
  };

  const { response } = await request("/ready", { reader, logger });

  assert.equal(response.status, 503);
  assert.equal(errors.length, 1);
  assert.equal(errors[0]?.message, "snapshot gateway readiness check failed");
  assert.equal(errors[0]?.details.event, "snapshot_gateway_readiness_failed");
  assert.equal(errors[0]?.details.reason, "manifest_not_accessible");
  assert.equal(errors[0]?.details.errorName, "S3ServiceException");
  assert.equal(errors[0]?.details.errorCode, "AccessDenied");
  assert.equal(errors[0]?.details.httpStatusCode, 403);
  assert.equal(typeof errors[0]?.details.durationMs, "number");
  assert(!JSON.stringify(errors).includes("secret endpoint"));
  assert(!JSON.stringify(errors).includes("credentials"));
});

test("ready bounds manifest storage operations with a timeout", async () => {
  const { errors, logger } = createRecordingLogger();
  const reader = new FakeReader({});
  let aborted = false;
  reader.getObject = async (_key, signal) =>
    new Promise((_resolve, reject) => {
      const fallback = setTimeout(
        () => reject(new Error("operation was not aborted")),
        100
      );
      signal?.addEventListener(
        "abort",
        () => {
          clearTimeout(fallback);
          aborted = true;
          reject(signal.reason);
        },
        { once: true }
      );
    });

  const startedAt = performance.now();
  const { response } = await request("/ready", {
    reader,
    logger,
    readinessOperationTimeoutMs: 10,
  });

  assert.equal(response.status, 503);
  assert(performance.now() - startedAt < 1_000);
  assert.equal(aborted, true);
  assert.equal(errors[0]?.details.errorCode, "READINESS_TIMEOUT");
});

test("readiness logging re-logs sustained failures and reports recovery", () => {
  const { errors, infos, logger } = createRecordingLogger();
  let now = 0;
  const reporter = createReadinessReporter(logger, () => now);
  const failure = {
    event: "snapshot_gateway_readiness_failed",
    reason: "manifest_not_accessible",
    errorCode: "AccessDenied",
    durationMs: 10,
  };

  reporter.failed(failure);
  now = 59_999;
  reporter.failed({ ...failure, durationMs: 20 });
  now = 60_000;
  reporter.failed({ ...failure, durationMs: 30 });
  reporter.ready(5);
  reporter.failed(failure);

  assert.equal(errors.length, 3);
  assert.equal(infos.length, 1);
  assert.deepEqual(infos[0]?.details, {
    event: "snapshot_gateway_readiness_recovered",
    durationMs: 5,
  });
});

test("ready coalesces overlapping storage checks", async () => {
  const reader = new FakeReader({
    [ACTIVE_MANIFEST_KEY]: JSON.stringify(manifest),
    "v1/deployments/deployment-a/chain/1/protocol.json": "{}",
  });
  const getObject = reader.getObject.bind(reader);
  const headObject = reader.headObject.bind(reader);
  let manifestReads = 0;
  let artifactReads = 0;
  let releaseManifest: (() => void) | undefined;
  const manifestBlocked = new Promise<void>((resolve) => {
    releaseManifest = resolve;
  });
  let manifestReadStarted: (() => void) | undefined;
  const manifestStarted = new Promise<void>((resolve) => {
    manifestReadStarted = resolve;
  });
  reader.getObject = async (key, signal) => {
    manifestReads += 1;
    manifestReadStarted?.();
    await manifestBlocked;
    return getObject(key, signal);
  };
  reader.headObject = async (key, signal) => {
    artifactReads += 1;
    return headObject(key, signal);
  };

  const handler = createSnapshotGateway(createTestConfig(reader));
  let requestsStarted = 0;
  let bothRequestsStarted: (() => void) | undefined;
  const requestsStartedPromise = new Promise<void>((resolve) => {
    bothRequestsStarted = resolve;
  });
  const server = createServer((incomingRequest, response) => {
    requestsStarted += 1;
    if (requestsStarted === 2) bothRequestsStarted?.();
    void handler(incomingRequest, response);
  });
  const listening = once(server, "listening");
  server.listen(0, "127.0.0.1");
  await listening;
  const address = server.address();
  assert(typeof address === "object" && address !== null);
  try {
    const firstResponse = fetch(`http://127.0.0.1:${address.port}/ready`);
    await manifestStarted;
    const secondResponse = fetch(`http://127.0.0.1:${address.port}/ready`);
    await requestsStartedPromise;
    releaseManifest?.();
    const responses = await Promise.all([firstResponse, secondResponse]);

    assert.deepEqual(
      responses.map((response) => response.status),
      [200, 200]
    );
    assert.equal(manifestReads, 1);
    assert.equal(artifactReads, 1);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test("ready applies one deadline to the artifact check phase", async () => {
  const chains = Array.from({ length: 9 }, (_value, index) => {
    const chainId = index + 1;
    return {
      chainId,
      name: `Chain ${chainId}`,
      path: `/v1/chains/${chainId}/protocol`,
      generatedAt: manifest.generatedAt,
      recordCounts: { contracts: 1, roles: 1, roleAssignments: 1 },
    };
  });
  const boundedManifest: SnapshotManifest = {
    ...manifest,
    chains,
    artifacts: Object.fromEntries(
      chains.map(({ chainId }) => [String(chainId), `artifact-${chainId}`])
    ),
  };
  const reader = new FakeReader({
    [ACTIVE_MANIFEST_KEY]: JSON.stringify(boundedManifest),
  });
  let calls = 0;
  reader.headObject = async (_key, signal) => {
    calls += 1;
    if (calls <= 8) {
      await new Promise((resolve) => setTimeout(resolve, 70));
      return;
    }
    await new Promise((_resolve, reject) =>
      signal?.addEventListener("abort", () => reject(signal.reason), {
        once: true,
      })
    );
  };

  const startedAt = performance.now();
  const { response } = await request("/ready", {
    reader,
    readinessOperationTimeoutMs: 100,
  });

  assert.equal(response.status, 503);
  assert(performance.now() - startedAt < 145);
});

test("ready checks manifest artifacts in parallel", async () => {
  const secondChain = {
    chainId: 10,
    name: "Optimism",
    path: "/v1/chains/10/protocol",
    generatedAt: manifest.generatedAt,
    recordCounts: { contracts: 1, roles: 1, roleAssignments: 1 },
  };
  const parallelManifest: SnapshotManifest = {
    ...manifest,
    chains: [...manifest.chains, secondChain],
    artifacts: {
      ...manifest.artifacts,
      "10": "v1/deployments/deployment-a/chain/10/protocol.json",
    },
  };
  const reader = new FakeReader({
    [ACTIVE_MANIFEST_KEY]: JSON.stringify(parallelManifest),
  });
  let activeChecks = 0;
  let maximumActiveChecks = 0;
  reader.headObject = async () => {
    activeChecks += 1;
    maximumActiveChecks = Math.max(maximumActiveChecks, activeChecks);
    await new Promise((resolve) => setTimeout(resolve, 20));
    activeChecks -= 1;
  };

  const { response } = await request("/ready", { reader });

  assert.equal(response.status, 200);
  assert.equal(maximumActiveChecks, 2);
});

test("ready limits concurrent artifact checks", async () => {
  const chains = Array.from({ length: 12 }, (_value, index) => {
    const chainId = index + 1;
    return {
      chainId,
      name: `Chain ${chainId}`,
      path: `/v1/chains/${chainId}/protocol`,
      generatedAt: manifest.generatedAt,
      recordCounts: { contracts: 1, roles: 1, roleAssignments: 1 },
    };
  });
  const boundedManifest: SnapshotManifest = {
    ...manifest,
    chains,
    artifacts: Object.fromEntries(
      chains.map(({ chainId }) => [
        String(chainId),
        `v1/deployments/deployment-a/chain/${chainId}/protocol.json`,
      ])
    ),
  };
  const reader = new FakeReader({
    [ACTIVE_MANIFEST_KEY]: JSON.stringify(boundedManifest),
  });
  let activeChecks = 0;
  let maximumActiveChecks = 0;
  reader.headObject = async () => {
    activeChecks += 1;
    maximumActiveChecks = Math.max(maximumActiveChecks, activeChecks);
    await new Promise((resolve) => setTimeout(resolve, 10));
    activeChecks -= 1;
  };

  const { response } = await request("/ready", { reader });

  assert.equal(response.status, 200);
  assert(maximumActiveChecks > 1);
  assert(maximumActiveChecks <= 8);
});

test("ready logs inaccessible artifact chain ids", async () => {
  const { errors, logger } = createRecordingLogger();
  const reader = new FakeReader({
    [ACTIVE_MANIFEST_KEY]: JSON.stringify(manifest),
  });
  reader.headObject = async () => {
    throw Object.assign(new Error("secret artifact endpoint"), {
      name: "S3ServiceException",
      code: "NoSuchKey",
      $metadata: { httpStatusCode: 404 },
    });
  };

  const { response } = await request("/ready", { reader, logger });

  assert.equal(response.status, 503);
  assert.equal(errors.length, 1);
  assert.equal(errors[0]?.details.reason, "active_manifest_not_ready");
  assert.deepEqual(errors[0]?.details.inaccessibleChainIds, [1]);
  assert.deepEqual(errors[0]?.details.artifactErrors, [
    {
      chainId: 1,
      errorName: "S3ServiceException",
      errorCode: "NoSuchKey",
      httpStatusCode: 404,
    },
  ]);
  assert.equal(typeof errors[0]?.details.durationMs, "number");
  assert(!JSON.stringify(errors).includes("secret artifact endpoint"));
});

test("ready rejects legacy manifests without handover artifacts", async () => {
  const legacy = new FakeReader({
    [ACTIVE_MANIFEST_KEY]: JSON.stringify(legacyManifest),
  });

  const { response, text } = await request("/ready", { reader: legacy });

  assert.equal(response.status, 503);
  const body = JSON.parse(text);
  assert.equal(body.ok, false);
  assert.match(body.issues.join("; "), /indexerDeploymentId/);
  assert.match(body.issues.join("; "), /indexingProgress/);
  assert.match(body.issues.join("; "), /REST/);
});

test("public data routes reject legacy manifests instead of returning partial data", async () => {
  const legacy = new FakeReader({
    [ACTIVE_MANIFEST_KEY]: JSON.stringify(legacyManifest),
  });

  for (const path of ["/v1/bounds", "/v1/manifest", "/v1/chains"]) {
    const { response, text } = await request(path, { reader: legacy });

    assert.equal(response.status, 503);
    assert.equal(JSON.parse(text).error, "active manifest is not ready");
  }
});
