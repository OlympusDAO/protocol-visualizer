import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer } from "node:http";
import { join } from "node:path";
import { test } from "node:test";
import type { AbiRegistryManifest } from "@protocol-visualizer/snapshot-artifacts";
import {
  createAbiRegistry,
  defaultAbisPath,
  loadAbiRegistry,
} from "../src/abis.js";
import {
  createSnapshotGateway,
  loadOptionalAbiRegistry,
  type ObjectReader,
} from "../src/server.js";

const ADDRESS = "0xD6A6E8d9e82534bD65821142fcCd91ec9cF31880";
const abi = [{ type: "function", name: "sweepIntoDSR", inputs: [] }];

const manifest: AbiRegistryManifest = {
  schemaVersion: 1,
  env: {
    repo: "OlympusDAO/olympus-v3",
    branch: "master",
    path: "src/scripts/env.json",
    ref: "abc",
  },
  scope: "test",
  deployments: [
    {
      abi: "mainnet/ClearinghouseV1_0.json",
      abiHash: "hash",
      abiSource: "etherscan",
      address: ADDRESS,
      chain: "mainnet",
      chainId: 1,
      contractName: "Clearinghouse",
      label: "ClearinghouseV1_0",
      origin: { kernel: "POLICY" },
      version: "1.0",
    },
  ],
  exclusions: [],
};

// The ABI routes must not read the snapshot bucket.
const unusedReader: ObjectReader = {
  getObject: async () => {
    throw new Error("unexpected bucket read");
  },
  headObject: async () => {
    throw new Error("unexpected bucket read");
  },
};

async function get(path: string, withRegistry = true) {
  const server = createServer(
    createSnapshotGateway({
      reader: unusedReader,
      chains: [],
      openapiPath: "missing-openapi.json",
      logger: { error: () => {}, info: () => {} },
      ...(withRegistry
        ? {
            abis: createAbiRegistry(
              manifest,
              new Map([[manifest.deployments[0]?.abi ?? "", abi]])
            ),
          }
        : {}),
    })
  );
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert(typeof address === "object" && address !== null);
  try {
    const response = await fetch(`http://127.0.0.1:${address.port}${path}`);
    // biome-ignore lint/suspicious/noExplicitAny: the tests read JSON fields.
    return { response, body: (await response.json()) as any };
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

test("serves the ABI registry manifest", async () => {
  const { response, body } = await get("/v1/abis");
  assert.equal(response.status, 200);
  assert.deepEqual(body, manifest);
  assert.match(response.headers.get("cache-control") ?? "", /s-maxage=3600/);
});

test("finds an ABI by address, in any letter case", async () => {
  for (const address of [
    ADDRESS,
    ADDRESS.toLowerCase(),
    ADDRESS.toUpperCase().replace("0X", "0x"),
  ]) {
    const { response, body } = await get(`/v1/abis/1/${address}`);
    assert.equal(response.status, 200);
    assert.deepEqual(body, {
      data: { deployment: manifest.deployments[0], abi },
    });
  }
});

test("finds an ABI by label", async () => {
  const { response, body } = await get("/v1/abis/1/labels/ClearinghouseV1_0");
  assert.equal(response.status, 200);
  assert.equal(body.data.deployment.address, ADDRESS);
});

test("returns 404 for unknown ABIs and 400 for invalid addresses", async () => {
  assert.equal((await get(`/v1/abis/10/${ADDRESS}`)).response.status, 404);
  assert.equal((await get("/v1/abis/1/labels/Unknown")).response.status, 404);
  assert.equal((await get("/v1/abis/1/0x1234")).response.status, 400);
  assert.equal((await get("/v1/abis/1/a/b")).response.status, 404);
});

test("returns 503 when the registry is not loaded", async () => {
  assert.equal((await get("/v1/abis", false)).response.status, 503);
});

test("loads the committed registry", async () => {
  const registry = await loadAbiRegistry(join(process.cwd(), defaultAbisPath));
  assert.ok(registry.manifest.deployments.length > 0);
  const [first] = registry.manifest.deployments;
  assert.ok(first);
  const found = registry.byAddress(first.chainId, first.address);
  assert.ok(Array.isArray(found?.data.abi));
});

test("rejects a manifest that lists a missing ABI file", () => {
  assert.throws(
    () => createAbiRegistry(manifest, new Map()),
    /ABI file mainnet\/ClearinghouseV1_0.json is missing/
  );
});

test("a registry that cannot load is logged and does not throw", async () => {
  const errors: string[] = [];
  const registry = await loadOptionalAbiRegistry("missing-abis-dir", {
    error: (message) => errors.push(message),
    info: () => {},
  });
  assert.equal(registry, undefined);
  assert.deepEqual(errors, [
    "snapshot gateway could not load the ABI registry",
  ]);
});
