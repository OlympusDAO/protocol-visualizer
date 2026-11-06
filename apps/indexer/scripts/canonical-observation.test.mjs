import assert from "node:assert/strict";
import { test } from "node:test";
import {
  CanonicalObservationChanged,
  withCanonicalObservation,
} from "../src/events/canonical-observation.ts";
import { RpcTransientFailure } from "../src/events/rpc.ts";

const header = (number, hash = `0x${number.toString().padStart(64, "0")}`) => ({
  number: BigInt(number),
  hash,
  parentHash: `0x${"a".repeat(64)}`,
  timestamp: BigInt(number) + 1000n,
});
const control = (number) => ({
  number: String(number),
  hash: header(number).hash,
  timestamp: String(Number(number) + 1000),
});
const canonicalFailure = (error) => {
  assert.ok(error instanceof CanonicalObservationChanged);
  assert.equal(error.message, "Canonical observation changed or unavailable");
  assert.equal(error.cause, undefined);
  return true;
};

test("reuses each header only inside a phase and freshly checks every anchor, observation last", async () => {
  const calls = [];
  const read = async (chain, number) => {
    calls.push([chain, number]);
    return header(number);
  };
  const result = await withCanonicalObservation(
    1,
    10n,
    async (phase) => {
      assert.deepEqual(phase.block, control(10));
      const [first, repeated] = await Promise.all([
        phase.readBlock("4"),
        phase.readBlock("04"),
      ]);
      assert.deepEqual(first, control(4));
      assert.deepEqual(repeated, first);
      assert.deepEqual(await phase.readCanonicalBlock(1, 4n), header(4));
      assert.deepEqual(await phase.readBlock("10"), control(10));
      return true;
    },
    read
  );
  assert.deepEqual(result, control(10));
  assert.deepEqual(calls, [
    [1, 10n],
    [1, 4n],
    [1, 4n],
    [1, 10n],
  ]);
});

test("overlapping phases and consecutive preload/execution phases have independent reads", async () => {
  let reads = 0;
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const read = async (_, number) => {
    reads++;
    return header(number);
  };
  const first = withCanonicalObservation(
    1,
    10n,
    async (phase) => {
      await phase.readBlock("4");
      await gate;
      return true;
    },
    read
  );
  await withCanonicalObservation(
    1,
    10n,
    async (phase) => {
      await phase.readBlock("4");
      return true;
    },
    read
  );
  release();
  await first;
  assert.equal(reads, 8);
  await withCanonicalObservation(1, 10n, async () => true, read);
  assert.equal(reads, 10);
});

for (const point of ["lookup", "late body"]) {
  test(`rejects a current-block fork after ${point}`, async () => {
    let forked = false;
    const read = async (_, number) =>
      header(
        number,
        number === 10n && forked ? `0x${"f".repeat(64)}` : undefined
      );
    await assert.rejects(
      withCanonicalObservation(
        1,
        10n,
        async (phase) => {
          await phase.readBlock("4");
          if (point === "lookup") forked = true;
          await phase.readBlock("10");
          if (point === "late body") forked = true;
          return true;
        },
        read
      ),
      canonicalFailure
    );
  });
}

for (const anchor of [2n, 4n]) {
  test(`rejects a creation/history anchor fork at ${anchor}`, async () => {
    let done = false;
    await assert.rejects(
      withCanonicalObservation(
        1,
        10n,
        async (phase) => {
          await phase.readCanonicalBlock(1, 2n);
          await phase.readBlock("4");
          done = true;
          return true;
        },
        async (_, number) =>
          header(
            number,
            done && number === anchor ? `0x${"f".repeat(64)}` : undefined
          )
      ),
      canonicalFailure
    );
  });
}

test("missing, null and wrong-height headers abort at opening, lookup, and final checks", async () => {
  for (const invalid of [
    undefined,
    {},
    { ...header(10), hash: null },
    { ...header(10), hash: "0x1234" },
    { ...header(10), timestamp: null },
    { ...header(10), number: 11n },
    { ...header(10), number: null },
  ]) {
    await assert.rejects(
      withCanonicalObservation(
        1,
        10n,
        async () => true,
        async () => invalid
      ),
      canonicalFailure
    );
  }
  for (const invalid of [
    undefined,
    { ...header(4), hash: null },
    { ...header(4), number: 5n },
  ]) {
    await assert.rejects(
      withCanonicalObservation(
        1,
        10n,
        async (phase) => {
          await phase.readBlock("4");
          return true;
        },
        async (_, number) => (number === 4n ? invalid : header(number))
      ),
      canonicalFailure
    );
  }
  let reads = 0;
  await assert.rejects(
    withCanonicalObservation(
      1,
      10n,
      async () => true,
      async () => (++reads === 1 ? header(10) : undefined)
    ),
    canonicalFailure
  );
});

test("requires explicit true even when the body returns partial or undefined", async () => {
  for (const result of [false, undefined]) {
    await assert.rejects(
      withCanonicalObservation(
        1,
        10n,
        async () => result,
        async (_, number) => header(number)
      ),
      canonicalFailure
    );
  }
});

test("missing and wrong-height historical anchors also abort the final fresh check", async () => {
  for (const invalid of [undefined, { ...header(4), number: 5n }]) {
    let done = false;
    await assert.rejects(
      withCanonicalObservation(
        1,
        10n,
        async (phase) => {
          await phase.readBlock("4");
          done = true;
          return true;
        },
        async (_, number) => (done && number === 4n ? invalid : header(number))
      ),
      canonicalFailure
    );
  }
});

test("swallowed lookup failures poison the phase and never leak provider prose", async () => {
  for (const failure of [
    undefined,
    new Error("https://private.example/key provider details"),
  ]) {
    await assert.rejects(
      withCanonicalObservation(
        1,
        10n,
        async (phase) => {
          try {
            await phase.readBlock("4");
          } catch {}
          return true;
        },
        async (_, number) => {
          if (number !== 4n) return header(number);
          if (failure instanceof Error) throw failure;
          return failure;
        }
      ),
      canonicalFailure
    );
  }
  await assert.rejects(
    withCanonicalObservation(
      1,
      10n,
      async (phase) => {
        try {
          await phase.readCanonicalBlock(2, 4n);
        } catch {}
        return true;
      },
      async (_, number) => header(number)
    ),
    canonicalFailure
  );
});

test("preserves sanitized transient failures, including errors swallowed by the callback", async () => {
  const failure = new RpcTransientFailure();
  for (const swallow of [false, true]) {
    await assert.rejects(
      withCanonicalObservation(
        1,
        10n,
        async (phase) => {
          if (swallow) {
            try {
              await phase.readBlock("4");
            } catch {}
          } else await phase.readBlock("4");
          return true;
        },
        async (_, number) => {
          if (number === 4n) throw failure;
          return header(number);
        }
      ),
      (error) => error === failure
    );
  }
  await assert.rejects(
    withCanonicalObservation(
      1,
      10n,
      async () => {
        throw failure;
      },
      async (_, number) => header(number)
    ),
    (error) => error === failure
  );
  for (const atOpening of [true, false]) {
    let calls = 0;
    await assert.rejects(
      withCanonicalObservation(
        1,
        10n,
        async () => true,
        async (_, number) => {
          if (++calls === (atOpening ? 1 : 2)) throw failure;
          return header(number);
        }
      ),
      (error) => error === failure
    );
  }
});

test("rechecks more than 256 anchors with at most four concurrent fresh reads", async () => {
  let final = false;
  let active = 0;
  let maximum = 0;
  const finalCalls = [];
  await withCanonicalObservation(
    1,
    1000n,
    async (phase) => {
      for (let number = 1; number <= 260; number++)
        await phase.readBlock(String(number));
      final = true;
      return true;
    },
    async (_, number) => {
      if (final) {
        finalCalls.push(number);
        active++;
        maximum = Math.max(maximum, active);
        await new Promise((resolve) => setImmediate(resolve));
        active--;
      }
      return header(number);
    }
  );
  assert.equal(maximum, 4);
  assert.equal(finalCalls.length, 261);
  assert.equal(finalCalls.at(-1), 1000n);
});
