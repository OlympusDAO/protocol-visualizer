import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import metadata from "../src/generated/contract-metadata.json";
import { processVerifiedContractMetadata } from "../src/services/contracts/abi.ts";
import { ContractProcessor } from "../src/services/contracts/processor.ts";

test("prefetched ABI documentation avoids HTTP after processor restart", async () => {
  const root = mkdtempSync(join(tmpdir(), "pv-prefetch-"));
  const savedCwd = process.cwd(),
    savedFetch = globalThis.fetch;
  const chainId = 999975,
    address = `0x${"31".repeat(20)}`;
  const previous = metadata[chainId];
  metadata[chainId] = {
    [address]: processVerifiedContractMetadata(
      {
        chainId,
        address,
        runtimeMatch: "exact_match",
        runtimeBytecode: { onchainBytecode: "0x6000" },
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
            ],
          },
        },
      },
      chainId,
      address
    ),
  };
  globalThis.fetch = () => {
    throw Error("prepared metadata must not fetch");
  };
  process.chdir(root);
  try {
    for (let restart = 0; restart < 2; restart++)
      assert.deepEqual(
        await new ContractProcessor(undefined, chainId).processContract(
          address,
          "Prefetched"
        ),
        metadata[chainId][address]
      );
  } finally {
    process.chdir(savedCwd);
    globalThis.fetch = savedFetch;
    if (previous) metadata[chainId] = previous;
    else delete metadata[chainId];
    rmSync(root, { recursive: true, force: true });
  }
});
