import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

test("label-only identities skip every metadata mode, including forced and duplicate inventory entries", () => {
  const root = mkdtempSync(path.join(tmpdir(), "pv-label-only-"));
  const output = path.join(root, "metadata.json");
  const report = path.join(root, "report.json");
  const preload = path.join(root, "fetch.mjs");
  const address = "0x1a5309f208f161a393e8b5a253de8ab894a67188";
  writeFileSync(
    preload,
    `
import * as fs from "node:fs/promises";
import {syncBuiltinESMExports} from "node:module";
const original=fs.default.readFile;
fs.default.readFile=async (file,...args)=>{
 const content=await original(file,...args);
 if(String(file).endsWith("packages/protocol-config/other-contracts.json")) {
  return JSON.stringify([...JSON.parse(content),{chainId:1,address:${JSON.stringify(address)},name:"duplicate",labelOnly:false}]);
 }
 return content;
};
syncBuiltinESMExports();
globalThis.fetch=()=>{throw Error("label-only metadata must never perform HTTP");};
`
  );
  try {
    for (const chain of [
      1, 42161, 8453, 80094, 10, 11155111, 84532, 421614, 80084,
    ]) {
      for (const mode of [
        [],
        ["--prefetch-deployments"],
        ["--refresh-getters"],
      ]) {
        const run = spawnSync(
          process.execPath,
          [
            "--import",
            preload,
            "scripts/generate-indexer-contract-metadata.mjs",
            "--chain-id",
            String(chain),
            "--address",
            address,
            "--force",
            "--include-unknown-type",
            "--output",
            output,
            "--source-report",
            report,
            ...mode,
          ],
          { encoding: "utf8" }
        );
        assert.equal(run.status, 0, run.stderr);
        assert.match(run.stdout, /checks skipped for label-only/);
        const coverage = JSON.parse(readFileSync(report, "utf8"));
        assert.deepEqual(coverage.entries, []);
        assert.equal(coverage.excluded[0].reason, "label-only");
        assert.equal(coverage.excluded[0].chainId, chain);
      }
    }
    const bulk = spawnSync(
      process.execPath,
      [
        "--import",
        preload,
        "scripts/generate-indexer-contract-metadata.mjs",
        "--name",
        "Deployer",
        "--prefetch-deployments",
        "--force",
        "--output",
        output,
        "--source-report",
        report,
      ],
      { encoding: "utf8" }
    );
    assert.equal(bulk.status, 0, bulk.stderr);
    const coverage = JSON.parse(readFileSync(report, "utf8"));
    assert.deepEqual(coverage.entries, []);
    assert.deepEqual(
      coverage.excluded.map((entry) => entry.chainId).sort((a, b) => a - b),
      [1, 10, 8453, 42161, 80094, 421614, 11155111],
      "bulk preparation must exclude core and auxiliary Deployer labels"
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("partial Blockscout ABI import fills empty metadata without claiming deployment or source proof", () => {
  const root = mkdtempSync(path.join(tmpdir(), "pv-explorer-abi-"));
  const output = path.join(root, "metadata.json"),
    observation = path.join(root, "abi.json"),
    preload = path.join(root, "fetch.mjs");
  const observed = JSON.parse(
    readFileSync(
      "apps/indexer/scripts/fixtures/robinhood-token-admin-registry-abi.json",
      "utf8"
    )
  );
  const address = observed.address;
  writeFileSync(
    preload,
    'globalThis.fetch=()=>{throw Error("offline import must never perform HTTP");};'
  );
  const run = (value, previous = {}, extra = []) => {
    writeFileSync(observation, JSON.stringify(value));
    writeFileSync(output, JSON.stringify({ 4663: { [address]: previous } }));
    return spawnSync(
      process.execPath,
      [
        "--import",
        preload,
        "scripts/generate-indexer-contract-metadata.mjs",
        "--chain-id",
        "4663",
        "--address",
        address,
        "--explorer-abi",
        observation,
        "--output",
        output,
        ...extra,
      ],
      { encoding: "utf8" }
    );
  };
  const read = () => JSON.parse(readFileSync(output, "utf8"))[4663][address];
  try {
    let result = run(
      observed,
      { ordinaryDeployment: { fixture: "retained" } },
      ["--source-report", path.join(root, "nested/report.json")]
    );
    assert.equal(result.status, 0, result.stderr);
    const prepared = read();
    assert.equal(Object.keys(prepared.functionSelectors).length, 16);
    assert.ok(
      Object.values(prepared.functionSelectors).some(
        (fn) => fn.name === "getTokenConfig"
      )
    );
    assert.deepEqual(prepared.ordinaryDeployment, { fixture: "retained" });
    for (const field of ["immutableDeployment", "deploymentDiscovery"])
      assert.equal(prepared[field], undefined);
    assert.equal(
      prepared.functionSelectors["0x8da5cb5b"].documentation,
      undefined
    );
    result = run(observed, prepared);
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(
      read(),
      prepared,
      "second process preserves existing nonempty metadata"
    );
    for (const patch of [
      { verified: false },
      { chainId: 1 },
      { address: `0x${"12".repeat(20)}` },
      { sourceUrl: "https://example.test/" },
      { functions: ["invalid ABI"] },
    ]) {
      result = run({ ...observed, ...patch });
      assert.notEqual(result.status, 0, JSON.stringify(patch));
      assert.deepEqual(read(), {}, "failed import must not write metadata");
    }
    result = run(observed, {}, ["--prefetch-deployments"]);
    assert.notEqual(result.status, 0, "ambiguous import modes must fail");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("PriceConfig stays on its actual chains and EOA display labels remain available", () => {
  const result = spawnSync(
    process.execPath,
    [
      "--import",
      "./apps/indexer/scripts/typescript-loader.mjs",
      "--input-type=module",
      "-e",
      `
import assert from "node:assert/strict";
import {getContractName,getContractType} from "./apps/indexer/src/ContractNames.ts";
const mainnet="0xf6d5d06a4e8e6904e4360108749c177692f59e90";
assert.equal(getContractName(mainnet,1),"PriceConfig");
assert.equal(getContractName(mainnet,11155111),"UNKNOWN");
assert.equal(getContractName("0x68009f5e809c5a3438438312f8eefb9f5c73d534",11155111),"PriceConfig");
assert.equal(getContractName("0x1a5309f208f161a393e8b5a253de8ab894a67188",1),"Deployer");
assert.equal(getContractType("0x1a5309f208f161a393e8b5a253de8ab894a67188",1),undefined);
`,
    ],
    { encoding: "utf8" }
  );
  assert.equal(result.status, 0, result.stderr);
});
