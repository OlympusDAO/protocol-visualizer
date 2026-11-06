import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import metadata from "../src/generated/contract-metadata.json";
import { ContractProcessor } from "../src/services/contracts/processor.ts";
import { getProcessedContract } from "../src/events/effects.ts";
import { makeEffectRuntime } from "./fixtures/effect-runtime.mjs";

test("transient verified-metadata failures stay out of disk and effect caches", async () => {
  const root = mkdtempSync(join(tmpdir(), "pv-metadata-retry-"));
  const cwd = process.cwd(),
    fetch = globalThis.fetch;
  const chainId = 999976,
    address = `0x${"42".repeat(20)}`;
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    return new Response("{}", { status: calls === 1 ? 503 : 404 });
  };
  process.chdir(root);
  try {
    const processor = new ContractProcessor(
      {
        getContractAbi: async () => [],
        getContractSourceCode: async () => "",
      },
      chainId
    );
    const first = await processor.processContract(address, "fixture");
    assert.equal(first.metadataIncomplete, true);
    assert.equal(existsSync("data/contract-cache.json"), false);
    const next = await processor.processContract(address, "fixture");
    assert.equal(next.metadataIncomplete, undefined);
    assert.equal(calls, 2);
    assert.ok(
      JSON.parse(readFileSync("data/contract-cache.json", "utf8"))[chainId][
        address
      ]
    );

    metadata[chainId] = {
      [address]: { roleToFunctions: {}, functionSelectors: {} },
    };
    calls = 0;
    const runtime = await makeEffectRuntime();
    const invoke = (context) =>
      getProcessedContract(context, chainId, address, "fixture", 10n);
    assert.equal((await invoke(runtime)).metadataIncomplete, true);
    await runtime.flush();
    assert.equal(runtime.rows.size, 0, "a transient fallback must not persist");
    const nextRuntime = await makeEffectRuntime({ rows: runtime.rows });
    assert.equal((await invoke(nextRuntime)).metadataIncomplete, undefined);
    await nextRuntime.flush();
    assert.equal(runtime.rows.size, 1, "a definitive 404 can be cached");
    await invoke(nextRuntime);
    assert.equal(
      calls,
      2,
      "the in-process memo must retry once, then reuse complete metadata"
    );
  } finally {
    delete metadata[chainId];
    process.chdir(cwd);
    globalThis.fetch = fetch;
    rmSync(root, { recursive: true, force: true });
  }
});

test("only transport failures, timeouts, and retryable HTTP responses bypass metadata caches", async () => {
  const root = mkdtempSync(join(tmpdir(), "pv-metadata-errors-"));
  const cwd = process.cwd(),
    fetch = globalThis.fetch;
  process.chdir(root);
  try {
    const errors = [
      400,
      403,
      404,
      408,
      429,
      503,
      new TypeError("fetch failed"),
      new DOMException("timeout", "TimeoutError"),
      new SyntaxError("invalid JSON"),
    ];
    for (const [index, error] of errors.entries()) {
      const address = `0x${String(index + 1).repeat(40)}`;
      globalThis.fetch = async () => {
        if (error instanceof Error) throw error;
        return new Response("{}", { status: error });
      };
      const result = await new ContractProcessor(
        {
          getContractAbi: async () => [],
          getContractSourceCode: async () => "",
        },
        999977
      ).processContract(address, "fixture");
      const transient =
        [408, 429, 503].includes(error) ||
        error instanceof TypeError ||
        error instanceof DOMException;
      assert.equal(
        result.metadataIncomplete === true,
        transient,
        String(error)
      );
      const cache = existsSync("data/contract-cache.json")
        ? JSON.parse(readFileSync("data/contract-cache.json", "utf8"))
        : {};
      assert.equal(
        Boolean(cache[999977]?.[address]),
        !transient,
        String(error)
      );
    }
  } finally {
    process.chdir(cwd);
    globalThis.fetch = fetch;
    rmSync(root, { recursive: true, force: true });
  }
});
