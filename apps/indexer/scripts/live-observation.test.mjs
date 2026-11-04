import assert from "node:assert/strict";
import { test } from "node:test";
import { createLiveObservation } from "../src/events/live-observation.ts";

test("sparse verification skips backlog and preload, then verifies near head before native readiness", async () => {
  let head = 1000n,
    reads = 0;
  const observations = [];
  const run = createLiveObservation(
    async () => {
      reads++;
      return head;
    },
    async (_ctx, number) => observations.push(number)
  );
  const call = (number, isRealtime = true, isPreload = false) =>
    run({ block: { number }, context: { isPreload, chain: { isRealtime } } });
  await call(100, true, true);
  assert.equal(reads, 0);
  await call(100, false);
  await call(200);
  await call(800);
  assert.equal(
    reads,
    1,
    "old callbacks reuse only the captured eligibility floor"
  );
  head = 1200n;
  await call(1000);
  assert.deepEqual(observations, []);
  await call(1101, false);
  assert.deepEqual(observations, [1101], "lag 99 is eligible");
  head = 1300n;
  await call(1200);
  assert.deepEqual(observations, [1101], "lag 100 is stale");
  await call(1301);
  assert.deepEqual(observations, [1101], "future callbacks cannot verify");
});

test("head and observation failures propagate without consuming verification", async () => {
  let fail = true,
    attempts = 0;
  const run = createLiveObservation(
    async () => 100n,
    async () => {
      attempts++;
      if (fail) throw Error("fixture failure");
    }
  );
  const args = {
    block: { number: 100 },
    context: { isPreload: false, chain: { isRealtime: true } },
  };
  await assert.rejects(run(args), /fixture failure/);
  fail = false;
  await run(args);
  assert.equal(attempts, 2);
  const broken = createLiveObservation(
    async () => {
      throw Error("head failure");
    },
    async () => assert.fail("no observation without head")
  );
  await assert.rejects(broken(args), /head failure/);
});
