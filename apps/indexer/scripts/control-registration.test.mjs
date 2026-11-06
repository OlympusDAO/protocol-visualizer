import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const mode = process.argv
  .find((arg) => arg.startsWith("--case="))
  ?.split("=")[1];
if (mode) {
  for (const chain of [
    1, 10, 42161, 8453, 80094, 4663, 11155111, 421614, 84532,
  ])
    process.env[`ENVIO_RPC_URL_${chain}`] = "http://127.0.0.1:1";
  process.env.ENVIO_API_TOKEN = "fixture";
  process.env.ENVIO_RPC_MODE = "fallback";
  globalThis.fetch = () => {
    throw Error("Registration must not fetch network data");
  };
  const require = createRequire(import.meta.url);
  const native = (name) =>
    import(
      new URL(`./src/${name}.res.mjs`, pathToFileURL(require.resolve("envio")))
    );
  const [Config, ChainMap, Handlers] = await Promise.all([
    native("Config"),
    native("ChainMap"),
    native("HandlerRegister"),
  ]);
  const config = Config.load(),
    chain = ChainMap.get(config.chainMap, 80094);
  if (mode !== "unbounded")
    chain.endBlock = mode === "boundary-end" ? 1023691 : 1530001;
  Handlers.startRegistration(config);
  await import("../src/EventHandlers.ts");
  const registrations =
    Handlers.finishRegistration(config)[80094].onBlockRegistrations;
  const names = registrations.map((row) => row.name);
  assert.ok(names.includes("control-seed-80094-780011"));
  assert.ok(
    !names.includes("control-seed-80094-1023691"),
    "registry creation does not sweep existing contracts"
  );
  assert.equal(
    names.includes("control-seed-80094-27734756"),
    mode === "unbounded"
  );
  assert.ok(!names.some((name) => name.startsWith("control-checkpoint-")));
  assert.equal(names.includes("control-realtime-80094"), mode === "unbounded");
  assert.equal(names.includes("control-end-80094"), mode !== "unbounded");
} else {
  test("native handler registration keeps in-range seeds and excludes future seeds only for bounded replays", () => {
    for (const scenario of ["bounded", "boundary-end", "unbounded"]) {
      const run = spawnSync(
        process.execPath,
        [
          "--import",
          fileURLToPath(new URL("./register-typescript.mjs", import.meta.url)),
          fileURLToPath(import.meta.url),
          `--case=${scenario}`,
        ],
        {
          cwd: fileURLToPath(new URL("../", import.meta.url)),
          encoding: "utf8",
          timeout: 10000,
        }
      );
      assert.equal(run.status, 0, `${scenario}: ${run.stderr}`);
    }
  });
}
