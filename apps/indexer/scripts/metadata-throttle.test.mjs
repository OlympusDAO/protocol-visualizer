import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { waitForMetadata } from "../src/services/metadata-throttle.ts";

test("metadata admission spaces concurrent callers after an overdue timer without coupling providers", async () => {
  await waitForMetadata("etherscan");
  const releases = [];
  const waiting = Array.from({ length: 3 }, () =>
    waitForMetadata("etherscan").then(() => releases.push(performance.now()))
  );
  await Promise.resolve();
  // Suspend the event loop until the first timer is overdue. Future callers
  // must still wait from actual admission, rather than all catching up at once.
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 650);
  const independent = performance.now();
  await waitForMetadata("sourcify");
  assert.ok(performance.now() - independent < 150);
  await Promise.all(waiting);
  for (let i = 1; i < releases.length; i++)
    assert.ok(releases[i] - releases[i - 1] >= 180);
});

test("a native worker with IPC reserves metadata at one start per second", async () => {
  const moduleUrl = new URL(
    "../src/services/metadata-throttle.ts",
    import.meta.url
  ).href;
  const code = `import {waitForMetadata} from ${JSON.stringify(moduleUrl)}; const times=await Promise.all([0,1].map(async()=>{await waitForMetadata("etherscan");return performance.now()}));process.send(times);process.disconnect();`;
  const child = spawn(
    process.execPath,
    [
      "--import",
      fileURLToPath(new URL("./register-typescript.mjs", import.meta.url)),
      "--input-type=module",
      "-e",
      code,
    ],
    {
      env: { ENVIO_INTERNAL_WORKER: "fixture" },
      stdio: ["ignore", "ignore", "ignore", "ipc"],
    }
  );
  let times;
  child.on("message", (message) => {
    times = message;
  });
  const exit = await new Promise((accept, reject) => {
    child.on("error", reject);
    child.on("exit", accept);
  });
  assert.equal(exit, 0);
  assert.equal(times.length, 2);
  assert.ok(times[1] - times[0] >= 950);
});
