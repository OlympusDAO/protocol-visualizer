import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { keccak256 } from "viem";
import metadata from "../src/generated/contract-metadata.json";
import { processVerifiedContractMetadata } from "../src/services/contracts/abi.ts";
import { ContractProcessor } from "../src/services/contracts/processor.ts";
import {
  getImmutableDeployment,
  getOrdinaryDeployment,
} from "../src/events/deployment-facts.ts";

const chainId = 999975;
const address = `0x${"31".repeat(20)}`;
const code = "0x6001600055";
const codeHash = keccak256(code);
const verified = () => ({
  chainId: String(chainId),
  address,
  runtimeMatch: "exact_match",
  compilation: { language: "Solidity" },
  deployment: { blockNumber: "10" },
  runtimeBytecode: { onchainBytecode: code, immutableReferences: {} },
  metadata: { output: { abi: [] } },
});

test("prefetch records only conclusive immutable discovery, not merely ordinary bytecode", () => {
  const result = processVerifiedContractMetadata(verified(), chainId, address);
  assert.deepEqual(result.deploymentDiscovery, {
    chainId,
    address,
    codeHash,
    version: "verified-deployment-discovery-v1",
  });
  assert.equal(result.immutableDeployment, undefined);
  for (const patch of [
    { runtimeBytecode: { onchainBytecode: code } },
    {
      runtimeBytecode: {
        onchainBytecode: code,
        immutableReferences: { 1: [{ start: 1, length: 32 }] },
      },
    },
  ]) {
    const incomplete = processVerifiedContractMetadata(
      { ...verified(), ...patch },
      chainId,
      address
    );
    assert.ok(incomplete.ordinaryDeployment);
    assert.equal(incomplete.deploymentDiscovery, undefined);
  }
  for (const patch of [
    { runtimeBytecode: { onchainBytecode: "0xf400" } },
    { proxyResolution: { isProxy: true } },
  ]) {
    const excluded = processVerifiedContractMetadata(
      { ...verified(), ...patch },
      chainId,
      address
    );
    assert.ok(excluded.deploymentDiscovery);
    assert.equal(excluded.ordinaryDeployment, undefined);
    assert.equal(excluded.immutableDeployment, undefined);
  }
});

test("prefetched proof avoids metadata HTTP after processor restart and skips only matching-code discovery", async () => {
  const root = mkdtempSync(join(tmpdir(), "pv-prefetch-"));
  const previousCwd = process.cwd(),
    previousFetch = globalThis.fetch;
  const previous = metadata[chainId];
  metadata[chainId] = {
    [address]: processVerifiedContractMetadata(verified(), chainId, address),
  };
  let httpCalls = 0,
    discoveries = 0;
  globalThis.fetch = async () => {
    httpCalls++;
    throw Error("prefetched contract must not download metadata");
  };
  const context = {
    effect: async (_effect, input) => {
      discoveries++;
      assert.equal(input.codeHash, codeHash);
      return undefined;
    },
  };
  const input = {
    chainId,
    address,
    blockNumber: 20n,
    blockHash: `0x${"32".repeat(32)}`,
  };
  process.chdir(root);
  try {
    for (let restart = 0; restart < 2; restart++) {
      const result = await new ContractProcessor(
        undefined,
        chainId
      ).processContract(address, "Prefetched");
      assert.deepEqual(result, metadata[chainId][address]);
      assert.equal(
        await getImmutableDeployment(context, input, codeHash),
        undefined
      );
      assert.deepEqual(
        await getOrdinaryDeployment(context, input, codeHash),
        result.ordinaryDeployment
      );
    }
    assert.equal(httpCalls, 0);
    assert.equal(discoveries, 0);
    for (const patch of [
      { codeHash: keccak256("0x6000") },
      { chainId: chainId + 1 },
      { address: `0x${"33".repeat(20)}` },
      { version: "unknown-version" },
    ]) {
      metadata[chainId][address].deploymentDiscovery = {
        ...processVerifiedContractMetadata(verified(), chainId, address)
          .deploymentDiscovery,
        ...patch,
      };
      await getImmutableDeployment(context, input, codeHash);
    }
    assert.equal(
      discoveries,
      4,
      "changed code, identity or proof version must retain discovery"
    );
    const excluded = processVerifiedContractMetadata(
      { ...verified(), proxyResolution: { isProxy: true } },
      chainId,
      address
    );
    metadata[chainId][address] = excluded;
    assert.equal(
      await getOrdinaryDeployment(context, input, codeHash),
      undefined
    );
    assert.equal(
      await getImmutableDeployment(context, input, codeHash),
      undefined
    );
    assert.equal(
      discoveries,
      4,
      "proven proxy exclusion also bypasses discovery"
    );

    const partial = verified();
    delete partial.runtimeBytecode.immutableReferences;
    metadata[chainId][address] = processVerifiedContractMetadata(
      partial,
      chainId,
      address
    );
    globalThis.fetch = async () => {
      httpCalls++;
      return new Response(null, { status: 503 });
    };
    for (let restart = 0; restart < 2; restart++) {
      const result = await new ContractProcessor(
        undefined,
        chainId
      ).processContract(address, "Partial");
      assert.equal(result.deploymentDiscovery, undefined);
    }
    assert.equal(
      httpCalls,
      2,
      "unavailable enrichment must remain retryable after restart"
    );
    globalThis.fetch = async () => {
      httpCalls++;
      return Response.json(verified());
    };
    const recovered = await new ContractProcessor(
      undefined,
      chainId
    ).processContract(address, "Recovered");
    assert.ok(recovered.deploymentDiscovery);
  } finally {
    if (previous === undefined) delete metadata[chainId];
    else metadata[chainId] = previous;
    globalThis.fetch = previousFetch;
    process.chdir(previousCwd);
    rmSync(root, { recursive: true, force: true });
  }
});
