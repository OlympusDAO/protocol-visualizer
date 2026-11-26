import assert from "node:assert/strict";
import { test } from "node:test";
import { CanonicalObservationChanged } from "../src/events/canonical-observation.ts";
import { createLiveObservation } from "../src/events/live-observation.ts";

const header = (number, timestamp) => ({
  number,
  hash: `0x${"1".repeat(64)}`,
  timestamp,
});

test("sparse verification skips backlog and preload, then verifies at catch-up", async () => {
  let head = 1000n;
  let reads = 0;
  const observations = [];
  const run = createLiveObservation({
    candidateInterval: 200,
    readHead: async () => {
      reads++;
      return head;
    },
    readHeader: async () =>
      assert.fail("first verification needs no clock check"),
    lastObservedAt: async () => undefined,
    observe: async (_ctx, number) => observations.push(number),
  });
  const call = (number, isPreload = false) =>
    run({
      block: { number },
      context: { isPreload, chain: { isRealtime: false } },
    });

  await call(100, true);
  assert.equal(reads, 0);
  await call(100);
  await call(800);
  assert.equal(reads, 1, "old callbacks reuse the captured eligibility floor");
  head = 1200n;
  await call(1000);
  assert.deepEqual(observations, [], "lag of one candidate interval is stale");
  await call(1001);
  assert.deepEqual(
    observations,
    [1001],
    "first check precedes native readiness"
  );
  await call(1201);
  assert.deepEqual(observations, [1001], "future callbacks cannot verify");
});

test("the canonical block timestamp determines the half-hour window across restarts", async () => {
  const timestamps = new Map([
    [199, 1799n],
    [200, 1800n],
    [250, 3599n],
    [251, 3600n],
    [252, 3600n],
  ]);
  let storedTimestamp = 1700n;
  let head = 199n;
  const observations = [];
  const options = {
    candidateInterval: 5,
    readHead: async () => head,
    readHeader: async (number) =>
      header(number, timestamps.get(Number(number))),
    lastObservedAt: async () => storedTimestamp,
    observe: async (_ctx, number, openingHeader) => {
      observations.push(number);
      storedTimestamp = openingHeader.timestamp;
    },
  };
  const invocation = (number) => {
    head = BigInt(number);
    return { block: { number }, context: { isPreload: false } };
  };

  const run = createLiveObservation(options);
  await run(invocation(199));
  await run(invocation(200));
  await run(invocation(250));
  await run(invocation(251));
  await createLiveObservation(options)(invocation(252));
  assert.deepEqual(observations, [200, 251]);
});

test("a header from the wrong height cannot suppress a verification", async () => {
  const run = createLiveObservation({
    candidateInterval: 5,
    readHead: async () => 100n,
    readHeader: async () => header(99n, 1799n),
    lastObservedAt: async () => 1700n,
    observe: async () =>
      assert.fail("a wrong-height header is not a candidate"),
  });

  await assert.rejects(
    run({ block: { number: 100 }, context: { isPreload: false } }),
    CanonicalObservationChanged
  );
});

test("head and observation failures propagate without consuming verification", async () => {
  let fail = true;
  let attempts = 0;
  const options = {
    candidateInterval: 5,
    readHead: async () => 100n,
    readHeader: async (number) => header(number, 1800n),
    lastObservedAt: async () => 1700n,
    observe: async () => {
      attempts++;
      if (fail) throw Error("fixture failure");
    },
  };
  const run = createLiveObservation(options);
  const args = {
    block: { number: 100 },
    context: { isPreload: false },
  };
  await assert.rejects(run(args), /fixture failure/);
  fail = false;
  await run(args);
  assert.equal(attempts, 2);
  const broken = createLiveObservation({
    ...options,
    readHead: async () => {
      throw Error("head failure");
    },
    observe: async () => assert.fail("no observation without head"),
  });
  await assert.rejects(broken(args), /head failure/);
});
