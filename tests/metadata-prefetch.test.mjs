import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

test("metadata preparation preserves getter inventory, skips complete downloads and retains failed/partial discovery", () => {
  const root = mkdtempSync(path.join(tmpdir(), "pv-metadata-command-"));
  const output = path.join(root, "metadata.json");
  const preload = path.join(root, "fetch.mjs");
  const requests = path.join(root, "requests.jsonl");
  const address = "0x2cea7b722dbd6b03f0e857d11e53ecb698cc2b4e";
  const previous = {
    functionSelectors: { "0x8da5cb5b": { name: "owner", roles: ["admin"] } },
    roleToFunctions: { admin: ["owner"] },
    addressGetters: ["owner"],
  };
  const verified = {
    chainId: "1",
    address,
    runtimeMatch: "exact_match",
    compilation: { language: "Solidity" },
    deployment: { blockNumber: "10" },
    runtimeBytecode: {
      onchainBytecode: "0x6001600055",
      immutableReferences: {},
    },
    metadata: {
      output: {
        abi: [
          {
            type: "function",
            name: "owner",
            inputs: [],
            outputs: [{ type: "address" }],
            stateMutability: "view",
          },
          {
            type: "function",
            name: "addedGetter",
            inputs: [],
            outputs: [{ type: "address" }],
            stateMutability: "view",
          },
        ],
        userdoc: { methods: { "owner()": { notice: "The current owner." } } },
      },
    },
  };
  const mock = (value, status = 200) =>
    writeFileSync(
      preload,
      `
import { appendFileSync } from "node:fs";
globalThis.fetch = async (url) => {
  if (!String(url).startsWith("https://sourcify.dev/server/v2/contract/1/${address}?")) throw Error("Unexpected metadata endpoint");
  appendFileSync(${JSON.stringify(requests)}, "request\\n");
  return Response.json(${JSON.stringify(value)}, { status: ${status} });
};
`
    );
  const run = (...extra) =>
    spawnSync(
      process.execPath,
      [
        "--import",
        preload,
        "scripts/generate-indexer-contract-metadata.mjs",
        "--prefetch-deployments",
        "--chain-id",
        "1",
        "--address",
        address,
        "--output",
        output,
        ...extra,
      ],
      { encoding: "utf8" }
    );
  const read = () => JSON.parse(readFileSync(output, "utf8"))[1][address];
  try {
    writeFileSync(output, JSON.stringify({ 1: { [address]: previous } }));
    mock(verified);
    let result = run();
    assert.equal(result.status, 0, result.stderr);
    const prepared = read();
    assert.deepEqual(prepared.addressGetters, previous.addressGetters);
    assert.deepEqual(prepared.roleToFunctions, previous.roleToFunctions);
    const owner = prepared.functionSelectors["0x8da5cb5b"];
    assert.deepEqual(owner.roles, ["admin"]);
    assert.equal(owner.canonicalSignature, "owner()");
    assert.equal(owner.documentation.notice, "The current owner.");
    assert.ok(
      Object.values(prepared.functionSelectors).some(
        (fn) => fn.name === "addedGetter"
      )
    );
    assert.ok(prepared.ordinaryDeployment);
    assert.ok(prepared.deploymentDiscovery);
    result = run();
    assert.equal(result.status, 0, result.stderr);
    assert.equal(
      readFileSync(requests, "utf8"),
      "request\n",
      "second process must not download complete facts again"
    );
    const saved = readFileSync(output, "utf8");
    mock({}, 429);
    result = run("--force");
    assert.notEqual(
      result.status,
      0,
      "a targeted unavailable refresh must fail"
    );
    assert.equal(
      readFileSync(output, "utf8"),
      saved,
      "failed refresh must preserve prior file"
    );
    delete verified.runtimeBytecode.immutableReferences;
    mock(verified);
    for (let attempt = 0; attempt < 2; attempt++) {
      result = run("--force");
      assert.equal(result.status, 0, result.stderr);
      assert.ok(read().ordinaryDeployment);
      assert.equal(
        read().deploymentDiscovery,
        undefined,
        "partial proof must replace an old completion marker"
      );
    }
    result = run();
    assert.equal(result.status, 0, result.stderr);
    assert.equal(
      readFileSync(requests, "utf8").trim().split("\n").length,
      5,
      "partial proof must remain retryable without --force"
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
