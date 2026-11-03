import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { test } from "node:test";
import { getProcessedContract } from "../src/events/effects.ts";

const require = createRequire(import.meta.url);
const codec = await import(
  require.resolve("rescript-schema/src/S.res.mjs", {
    paths: [require.resolve("envio")],
  })
);

test("metadata effects round trip through Envio's native output codec", async () => {
  const deployment = {
    chainId: 1,
    address: `0x${"12".repeat(20)}`,
    creationBlock: "123",
    codeHash: `0x${"34".repeat(32)}`,
    version: "fixture",
    sourceUrl: "https://sourcify.dev/",
  };
  await getProcessedContract(
    {
      effect: async (effect) => {
        assert.equal(effect.name, "processContractMetadataV3");
        for (const descriptors of [
          {},
          {
            deploymentDiscovery: {
              chainId: deployment.chainId,
              address: deployment.address,
              codeHash: deployment.codeHash,
              version: "verified-deployment-discovery-v1",
            },
          },
          { ordinaryDeployment: deployment },
          {
            immutableDeployment: {
              ...deployment,
              immutableGetters: { token: "0" },
            },
          },
          {
            ordinaryDeployment: deployment,
            immutableDeployment: {
              ...deployment,
              immutableGetters: { token: "0" },
            },
          },
        ]) {
          const output = {
            roleToFunctions: {},
            functionSelectors: {},
            addressGetters: undefined,
            ordinaryDeployment: undefined,
            immutableDeployment: undefined,
            deploymentDiscovery: undefined,
            ...descriptors,
          };
          const stored = codec.reverseConvertToJsonOrThrow(
            output,
            effect.storageMeta.outputSchema
          );
          assert.deepEqual(
            codec.parseOrThrow(stored, effect.storageMeta.outputSchema),
            output
          );
        }
        return { roleToFunctions: {}, functionSelectors: {} };
      },
    },
    1,
    deployment.address,
    "codec fixture",
    123n
  );
});
