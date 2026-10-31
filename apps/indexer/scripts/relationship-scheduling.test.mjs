import assert from "node:assert/strict";
import { setImmediate as tick } from "node:timers/promises";
import { test } from "node:test";
import {
  completeRelationshipBlock,
  relationshipId,
} from "../src/events/ownership.ts";

const addresses = ["ab", "cd", "ef"].map((part) => `0x${part.repeat(20)}`);
const value = `0x${"12".repeat(20)}`;
const codeHash = `0x${"34".repeat(32)}`;
const block = (number) => ({
  number: String(number),
  hash: `0x${number.toString(16).padStart(64, "0")}`,
  timestamp: String(number + 100),
});
const store = () => {
  const rows = new Map();
  return {
    rows,
    get: async (id) => rows.get(id),
    set: (row) => rows.set(row.id, structuredClone(row)),
  };
};
const context = () => ({
  ContractRelationship: store(),
  ContractStateSeed: store(),
  ControlTransition: store(),
  ChainObservation: store(),
});
const field = (address, getter = "owner", extras = {}) => ({
  address,
  getter,
  kind: "owner",
  startBlock: 1,
  ...extras,
});
const success = () => ({ status: "success", value });
const canonical = async (number) => block(Number(number));
const run = (ctx, fields, read, headers = canonical) =>
  completeRelationshipBlock(ctx, 1, block(10), fields, read, headers);
const snapshot = (ctx) =>
  Object.fromEntries(
    Object.entries(ctx).map(([name, table]) => [
      name,
      [...table.rows].sort(([a], [b]) => a.localeCompare(b)),
    ])
  );

test("two subjects overlap, a third waits, and completion waits for all reads", async () => {
  const ctx = context();
  const gates = addresses.map(() => Promise.withResolvers());
  const started = [];
  let active = 0;
  let peak = 0;
  const done = run(
    ctx,
    addresses.map((address) => field(address)),
    async (address) => {
      const index = addresses.indexOf(address);
      started.push(index);
      peak = Math.max(peak, ++active);
      await gates[index].promise;
      active--;
      return success();
    }
  );
  try {
    await tick();
    assert.deepEqual(started, [0, 1]);
    assert.equal(ctx.ChainObservation.rows.size, 0);
    gates[0].resolve();
    await tick();
    assert.deepEqual(started, [0, 1, 2]);
    assert.equal(peak, 2);
    assert.equal(ctx.ChainObservation.rows.size, 0);
  } finally {
    for (const gate of gates) gate.resolve();
    await done;
  }
  assert.equal(ctx.ChainObservation.rows.size, 1);
});

test("normalized subjects preserve duplicates, owner ordering and registry token scope", async () => {
  const [a, b, registry] = addresses;
  const token = (part) => `0x${part.repeat(20)}`;
  const tokenFields = [token("45"), token("67")].flatMap((token) => [
    field(registry, `administrator:${token}`, {
      kind: "token-admin",
      scope: { token },
    }),
    field(registry, `newAdministrator:${token}`, {
      kind: "token-admin",
      scope: { token },
    }),
  ]);
  const fields = [
    field(a, "owner"),
    field(b, "governor"),
    field(`0x${a.slice(2).toUpperCase()}`, "pendingOwner"),
    tokenFields[0],
    field(a, "owner"),
    field(b, "newGovernor"),
    ...tokenFields.slice(1),
  ];
  const parallel = context();
  const serial = context();
  const order = new Map();
  await run(parallel, fields, async (address, getter) => {
    const key = address.toLowerCase();
    order.set(key, [...(order.get(key) ?? []), getter]);
    await tick();
    return success();
  });
  for (const subject of addresses) {
    const group = fields.filter(
      (entry) => entry.address.toLowerCase() === subject
    );
    await run(serial, group, async () => success());
    assert.deepEqual(
      order.get(subject),
      group.map((entry) => entry.getter)
    );
  }
  assert.deepEqual(snapshot(parallel), snapshot(serial));
  for (const [subject, getter] of [
    [a, "pendingOwner"],
    [b, "newGovernor"],
    ...tokenFields
      .filter((entry) => entry.getter.startsWith("new"))
      .map((entry) => [registry, entry.getter]),
  ]) {
    assert.equal(
      parallel.ContractRelationship.rows.get(relationshipId(1, subject, getter))
        .status,
      "unset"
    );
  }
});

const policy = { profile: "solmate-owned", codeHash, version: "fixture" };
async function seededReplay(ctx) {
  const entry = field(addresses[1], "owner", { eventPolicy: policy });
  await run(ctx, [entry], async () => ({
    ...success(),
    verifiedAt: block(1),
    functionContext: {
      signature: "owner()",
      source: { codeHash, url: "https://example.invalid/source" },
    },
  }));
  ctx.ChainObservation.rows.clear();
  return entry;
}

test("an eligible event replay remains getter-free while another subject reads", async () => {
  const ctx = context();
  const replay = await seededReplay(ctx);
  const reads = [];
  assert.equal(
    await run(ctx, [field(addresses[0]), replay], async (address) => {
      reads.push(address);
      await tick();
      return success();
    }),
    true
  );
  assert.deepEqual(reads, [addresses[0]]);
});

for (const mode of ["throw", "canonical false"]) {
  test(`${mode} stops new fields and groups but drains an active sibling`, async () => {
    const ctx = context();
    const replay =
      mode === "canonical false"
        ? await seededReplay(ctx)
        : field(addresses[1]);
    if (mode === "canonical false") {
      const row = ctx.ContractRelationship.rows.get(
        relationshipId(1, addresses[1], "owner")
      );
      row.verification.eventReplay.block = block(9);
    }
    const held = Promise.withResolvers();
    const failureObserved = Promise.withResolvers();
    const failure = new Error("fixture failure");
    const reads = [];
    let settled = false;
    const done = run(
      ctx,
      [
        field(addresses[0]),
        replay,
        field(addresses[0], "pendingOwner"),
        field(addresses[2]),
      ],
      async (address) => {
        reads.push(address);
        if (address === addresses[0]) {
          await held.promise;
          return success();
        }
        failureObserved.resolve();
        throw failure;
      },
      async (number) => {
        if (number === "9") {
          failureObserved.resolve();
          return { ...block(9), hash: block(99).hash };
        }
        return canonical(number);
      }
    ).then(
      (value) => {
        settled = true;
        return { value };
      },
      (error) => {
        settled = true;
        return { error };
      }
    );
    try {
      await tick();
      assert.equal(reads[0], addresses[0]);
      // A serial implementation cannot reach the second subject while A waits.
      if (mode === "throw") assert.deepEqual(reads, addresses.slice(0, 2));
      else
        assert.equal(
          ctx.ContractRelationship.rows.get(
            relationshipId(1, addresses[1], "owner")
          ).verification.outcome,
          "unavailable"
        );
      await failureObserved.promise;
      await tick();
      assert.equal(
        settled,
        false,
        "the failed invocation must still own its sibling"
      );
      assert.equal(ctx.ChainObservation.rows.size, 0);
    } finally {
      held.resolve();
    }
    const result = await done;
    if (mode === "throw") assert.equal(result.error, failure);
    else assert.equal(result.value, false);
    assert.deepEqual(
      reads,
      mode === "throw" ? addresses.slice(0, 2) : addresses.slice(0, 1)
    );
    assert.equal(ctx.ChainObservation.rows.size, 0);
  });
}
