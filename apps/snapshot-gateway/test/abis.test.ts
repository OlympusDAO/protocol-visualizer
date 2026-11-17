import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer } from "node:http";
import { join } from "node:path";
import { test } from "node:test";
import type {
  AbiDeploymentResponse,
  AbiIndexResponse,
} from "@protocol-visualizer/snapshot-artifacts";
import {
  type AbiRegistryManifest,
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
const OHM_ADDRESS = "0x060cb087a9730E13aa191f31A6d86bFF8DfcdCC0";
const abi = [{ type: "function", name: "sweepIntoDSR", inputs: [] }];
const ohmAbi = [{ type: "function", name: "totalSupply", inputs: [] }];

const clearinghouse = {
  abiHash: "hash",
  abiSource: "etherscan" as const,
  address: ADDRESS,
  chain: "mainnet",
  chainId: 1,
  contractName: "Clearinghouse",
  label: "ClearinghouseV1_0",
  origin: { kernel: "POLICY" },
  version: "1.0",
};

const manifest: AbiRegistryManifest = {
  deployments: [
    { abi: "mainnet/ClearinghouseV1_0.json", ...clearinghouse },
    {
      abi: "optimism/OHM.json",
      abiHash: "ohm",
      abiSource: "etherscan",
      address: OHM_ADDRESS,
      chain: "optimism",
      chainId: 10,
      label: "OHM",
      origin: { env: ["olympus.legacy.OHM"] },
    },
  ],
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
              new Map([
                ["mainnet/ClearinghouseV1_0.json", abi],
                ["optimism/OHM.json", ohmAbi],
              ])
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

test("lists the contracts of each chain with the label and the address only", async () => {
  const { response, body } = await get("/v1/abis");
  assert.equal(response.status, 200);
  assert.deepEqual(body, {
    data: [
      {
        chainId: 1,
        chain: "mainnet",
        contracts: [{ label: "ClearinghouseV1_0", address: ADDRESS }],
      },
      {
        chainId: 10,
        chain: "optimism",
        contracts: [{ label: "OHM", address: OHM_ADDRESS }],
      },
    ],
  });
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
    // The response does not show the path of the ABI file.
    assert.deepEqual(body, { data: { deployment: clearinghouse, abi } });
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
  const ready = await get("/ready", false);
  assert.equal(ready.response.status, 503);
  assert.equal(ready.body.error, "abi registry not loaded");
});

test("loads the committed registry", async () => {
  const registry = await loadAbiRegistry(join(process.cwd(), defaultAbisPath));
  const { data } = JSON.parse(registry.index) as AbiIndexResponse;
  assert.ok(data.length > 0);
  for (const { chainId, contracts } of data) {
    for (const { label, address } of contracts) {
      const found = registry.byAddress(chainId, address);
      assert.ok(found, `${chainId}:${address} has no ABI`);
      const response = JSON.parse(found) as AbiDeploymentResponse;
      assert.equal(response.data.deployment.label, label);
      assert.ok(Array.isArray(response.data.abi));
      assert.equal(registry.byLabel(chainId, label), found);
    }
  }
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
