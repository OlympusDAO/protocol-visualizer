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
  createSnapshotGateway,
  type GatewayConfig,
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

  async getObject(key: string) {
    this.keys.push(key);
    const body = this.objects[key];
    if (body === undefined) throw new Error("missing");
    return { body };
  }

  async headObject(key: string) {
    this.keys.push(`head:${key}`);
    if (this.objects[key] === undefined) throw new Error("missing");
  }
}

async function request(
  path: string,
  options: { method?: string; body?: string; reader?: FakeReader } = {}
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
  const config: GatewayConfig = {
    reader,
    openapiPath: "missing-openapi.json",
    chains: [
      {
        key: "Mainnet",
        chainId: 1,
        name: "Mainnet",
        explorerBaseUrl: "https://etherscan.io",
      },
    ],
  };
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

test("ready requires manifest access", async () => {
  assert.equal((await request("/ready")).response.status, 200);
  const missing = new FakeReader({});
  assert.equal(
    (await request("/ready", { reader: missing })).response.status,
    503
  );
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
