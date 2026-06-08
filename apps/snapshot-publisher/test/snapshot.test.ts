import assert from "node:assert/strict";
import { test } from "node:test";
import { getSampleProtocolData } from "../src/sample-data.js";
import { loadSupportedChains } from "../src/chains.js";
import {
  createProtocolSnapshot,
  createSnapshotFiles,
  fetchProtocolData,
  parseChainIds,
  selectChains,
  validateProtocolSnapshot,
} from "../src/snapshot.js";

const supportedChains = [
  {
    key: "Mainnet",
    chainId: 1,
    name: "Ethereum Mainnet",
    explorerBaseUrl: "https://etherscan.io",
  },
  {
    key: "Optimism",
    chainId: 10,
    name: "Optimism",
    explorerBaseUrl: "https://optimistic.etherscan.io",
  },
];

test("creates valid protocol snapshots from GraphQL data", () => {
  const snapshot = createProtocolSnapshot({
    chainId: 1,
    generatedAt: "2026-05-25T00:00:00.000Z",
    graphqlData: getSampleProtocolData(1),
  });

  assert.deepEqual(validateProtocolSnapshot(snapshot), []);
  assert.equal(snapshot.data.contracts[0]?.type, "kernel");
  assert.equal(snapshot.recordCounts.contracts, 3);
});

test("rejects mismatched record counts", () => {
  const snapshot = createProtocolSnapshot({
    chainId: 1,
    generatedAt: "2026-05-25T00:00:00.000Z",
    graphqlData: getSampleProtocolData(1),
  });
  snapshot.recordCounts.contracts = 100;

  assert.match(
    validateProtocolSnapshot(snapshot).join("; "),
    /recordCounts\.contracts/
  );
});

test("creates manifest last", async () => {
  const files = await createSnapshotFiles({
    chains: supportedChains,
    loadProtocolData: (chainId) => getSampleProtocolData(chainId),
    deploymentId: "deployment-a",
    now: new Date("2026-05-25T00:00:00.000Z"),
    publicOrigin: "https://snapshots.example.com",
  });

  assert.equal(files.at(-1)?.key, "v1/manifest.json");
  assert.equal(files.at(-1)?.publishLast, true);
  assert(
    files.some(
      (file) => file.key === "v1/deployments/deployment-a/chain/1/protocol.json"
    )
  );
  const manifest = JSON.parse(files.at(-1)?.body ?? "{}");
  assert.equal(manifest.indexerDeploymentId, "deployment-a");
  assert.equal(
    manifest.artifacts["1"],
    "v1/deployments/deployment-a/chain/1/protocol.json"
  );
  assert.equal(manifest.chains[0].path, "/v1/chains/1/protocol");
  assert.equal(manifest.indexingProgress.chains.Mainnet.chainId, 1);
});

test("chain selection is allowlisted", () => {
  assert.deepEqual(parseChainIds("1,10", supportedChains), [1, 10]);
  assert.deepEqual(parseChainIds(undefined, supportedChains), [1, 10]);
  assert.throws(
    () => selectChains([999], supportedChains),
    /Unsupported chain id/
  );
});

test("loads shared protocol chain config", async () => {
  const chains = await loadSupportedChains();

  assert(chains.some((chain) => chain.chainId === 1));
  assert(chains.some((chain) => chain.chainId === 80094));
});

test("reports Hasura network failures with safe context", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    throw new Error("fetch failed");
  };

  try {
    await assert.rejects(
      () =>
        fetchProtocolData(
          "http://user:password@hasura:8080/v1/graphql?secret=value",
          1,
          "admin-secret"
        ),
      (error) => {
        assert(error instanceof Error);
        assert.match(
          error.message,
          /Hasura GraphQL request to http:\/\/hasura:8080\/v1\/graphql for chain 1 failed before response: fetch failed/
        );
        assert.match(error.message, /hasura PORT/);
        assert.doesNotMatch(
          error.message,
          /password|secret=value|admin-secret/
        );
        return true;
      }
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});
