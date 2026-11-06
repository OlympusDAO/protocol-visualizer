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
test("verified ABI metadata round trips through native effect persistence", async () => {
  const output = {
    roleToFunctions: { admin: ["owner"] },
    functionSelectors: {
      "0x8da5cb5b": {
        name: "owner",
        selector: "0x8da5cb5b",
        signature: "owner()(address)",
        canonicalSignature: "owner()",
        roles: ["admin"],
        documentation: {
          signature: "owner()",
          notice: "Current owner",
          source: {
            url: "https://sourcify.dev/",
            codeHash: `0x${"34".repeat(32)}`,
            match: "exact",
          },
        },
      },
    },
    addressGetters: ["owner"],
  };
  await getProcessedContract(
    {
      effect: async (effect) => {
        if (effect.name === "readControlBlock") return undefined;
        assert.equal(effect.name, "processContractMetadataV4");
        const stored = codec.reverseConvertToJsonOrThrow(
          output,
          effect.storageMeta.outputSchema
        );
        assert.deepEqual(
          JSON.parse(
            JSON.stringify(
              codec.parseOrThrow(stored, effect.storageMeta.outputSchema)
            )
          ),
          output
        );
        return output;
      },
    },
    1,
    `0x${"12".repeat(20)}`,
    "codec fixture",
    123n
  );
});
