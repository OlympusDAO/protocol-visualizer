import assert from "node:assert/strict";
import { test } from "node:test";
import { waitForMetadata } from "../src/services/metadata-throttle.ts";

test("metadata admission spaces concurrent callers after an overdue timer without coupling providers", async () => {
  await waitForMetadata("etherscan");
  const releases = [];
  const waiting = Array.from({ length: 3 }, () =>
    waitForMetadata("etherscan").then(() => releases.push(performance.now()))
  );
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
