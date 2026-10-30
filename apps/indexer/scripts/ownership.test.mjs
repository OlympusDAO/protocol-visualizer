import assert from "node:assert/strict";
import { test } from "node:test";
import {
  handleOwnershipEvent,
  handleAuthorityEvent,
  handleAuthorityReference,
  handleStakingReference,
  completeRelationshipBlock,
  relationshipId,
} from "../src/events/ownership.ts";

const subject = "0x0000000000000000000000000000000000000001";
const alice = "0x0000000000000000000000000000000000000002";
const bob = "0x0000000000000000000000000000000000000003";
const zero = `0x${"0".repeat(40)}`;
const block = (number) => ({
  number: String(number),
  hash: `0xblock${number}`,
  timestamp: String(number + 1700000000),
});
const event = (number, logIndex, params = {}) => ({
  chainId: 1,
  srcAddress: subject,
  block: { ...block(number), number, timestamp: number + 1700000000 },
  transaction: { hash: "0xtx" },
  logIndex,
  params,
});
const store = () => {
  const rows = new Map();
  return {
    rows,
    get: async (id) => rows.get(id),
    set: (row) => rows.set(row.id, structuredClone(row)),
    getWhere: async (filter) =>
      [...rows.values()].filter((row) =>
        Object.entries(filter).every(([key, value]) => row[key] === value._eq)
      ),
  };
};
const context = () => ({
  ContractRelationship: store(),
  ContractStateSeed: store(),
  ControlTransition: store(),
  ChainObservation: store(),
});
const field = (getter, kind = getter) => ({
  address: subject,
  startBlock: 1,
  getter,
  kind,
});
const row = (ctx, getter) =>
  ctx.ContractRelationship.get(relationshipId(1, subject, getter));
const complete = (ctx, number, fields, values) =>
  completeRelationshipBlock(
    ctx,
    1,
    block(number),
    fields,
    async (_address, getter) =>
      values[getter] === undefined
        ? { status: "unavailable", reason: "timeout" }
        : { status: "success", value: values[getter] },
    async (number) => block(Number(number))
  );

test("owner constructor/transfer are idempotent, ordered, zero unsets, failed verification preserves indexed state", async () => {
  const ctx = context();
  await handleOwnershipEvent(ctx, event(1, 0, { newOwner: alice }));
  await handleOwnershipEvent(ctx, event(2, 0, { newOwner: bob }));
  await handleOwnershipEvent(ctx, event(2, 0, { newOwner: bob }));
  assert.equal(ctx.ControlTransition.rows.size, 2);
  assert.equal((await row(ctx, "owner")).source, bob);
  assert.equal((await row(ctx, "owner")).lastChange.transactionHash, "0xtx");
  await assert.rejects(
    () => handleOwnershipEvent(ctx, event(1, 1, { newOwner: alice })),
    /canonical log order/
  );
  await complete(ctx, 2, [field("owner")], {});
  assert.equal((await row(ctx, "owner")).source, bob);
  assert.equal((await row(ctx, "owner")).verification.outcome, "unavailable");
  await handleOwnershipEvent(ctx, event(3, 0, { newOwner: zero }));
  assert.equal((await row(ctx, "owner")).status, "unset");
  assert.equal((await row(ctx, "owner")).target, null);
});

test("deferred authority push preserves holder; immediate push and pull clear persistent equal-current nominee", async () => {
  const ctx = context();
  await handleAuthorityEvent(
    ctx,
    event(1, 0, { to: alice, _effectiveImmediately: true }),
    "governor",
    "Pushed"
  );
  await handleAuthorityEvent(
    ctx,
    event(2, 0, { from: alice, to: bob, _effectiveImmediately: false }),
    "governor",
    "Pushed"
  );
  assert.equal((await row(ctx, "governor")).source, alice);
  assert.equal((await row(ctx, "newGovernor")).source, bob);
  assert.equal((await row(ctx, "newGovernor")).status, "pending");
  await handleAuthorityEvent(
    ctx,
    event(3, 0, { from: alice, to: bob }),
    "governor",
    "Pulled"
  );
  assert.equal((await row(ctx, "governor")).source, bob);
  assert.equal((await row(ctx, "newGovernor")).status, "unset");
  await handleAuthorityEvent(
    ctx,
    event(4, 0, { from: alice, to: alice, _effectiveImmediately: true }),
    "governor",
    "Pushed"
  );
  assert.equal((await row(ctx, "governor")).source, alice);
  assert.equal((await row(ctx, "newGovernor")).status, "unset");
  await complete(
    ctx,
    4,
    [field("governor"), field("newGovernor", "governor")],
    { governor: alice, newGovernor: alice }
  );
  assert.equal((await row(ctx, "newGovernor")).verification.outcome, "match");
  assert.equal((await row(ctx, "newGovernor")).status, "unset");
});

test("getter seeds respect completed boundaries; observed Authority and staking references keep correct direction", async () => {
  const ctx = context();
  await complete(ctx, 5, [field("owner")], { owner: alice });
  await assert.rejects(
    () => handleOwnershipEvent(ctx, event(5, 0, { newOwner: bob })),
    /seed boundary/
  );
  await handleAuthorityReference(ctx, event(6, 0, { authority: bob }));
  const authority = await row(ctx, "authority");
  assert.equal(authority.kind, "authority-reference");
  assert.equal(authority.source, subject);
  assert.equal(authority.target, bob);
  await handleStakingReference(ctx, event(6, 1, { stakingContract: alice }));
  assert.equal((await row(ctx, "stakingContract")).source, alice);
  assert.equal((await row(ctx, "stakingContract")).target, subject);
});

test("legacy minter getter gap updates only at a pinned checkpoint without inventing an event", async () => {
  const ctx = context();
  const minter = {
    ...field("approved", "legacy-minter"),
    coverage: "getter-only: migrate changes approved without a change event",
  };
  await complete(ctx, 1, [minter], { approved: alice });
  await complete(ctx, 2, [minter], { approved: bob });
  assert.equal((await row(ctx, "approved")).source, bob);
  assert.match((await row(ctx, "approved")).coverage, /getter-only/);
  assert.equal((await row(ctx, "approved")).provenance.number, "2");
  assert.equal(ctx.ControlTransition.rows.size, 0);
  await complete(ctx, 3, [minter], {});
  assert.equal((await row(ctx, "approved")).source, bob);
  assert.equal(
    (await row(ctx, "approved")).verification.outcome,
    "unavailable"
  );
});

test("a forked relationship anchor does not advance chain observation or seed siblings", async () => {
  const ctx = context();
  await handleOwnershipEvent(ctx, event(1, 0, { newOwner: alice }));
  const completed = await completeRelationshipBlock(
    ctx,
    1,
    block(2),
    [field("owner"), field("authority", "authority-reference")],
    async () => ({ status: "success", value: bob }),
    async (number) => ({ ...block(Number(number)), hash: "0xfork" })
  );
  assert.equal(completed, false);
  assert.equal((await row(ctx, "owner")).verification.outcome, "unavailable");
  assert.equal(await row(ctx, "authority"), undefined);
  assert.equal(ctx.ChainObservation.rows.size, 0);
});

test("capability inventory follows observed Mainnet Authority and preserves typed current/pending fields", async () => {
  const { getRelationshipFields, getObservedAuthorityFields } = await import(
    "../src/events/ownership-contracts.ts"
  );
  const fields = getRelationshipFields(1);
  const authorities = fields.filter((field) => field.getter === "governor");
  assert.deepEqual(
    authorities.map((field) => field.address),
    ["0x1c21f8ea7e39e2ba00bc12d2968d63f4acb38b7a"]
  );
  assert.equal(authorities[0].startBlock, 13674068);
  assert.equal(
    fields.some(
      (field) => field.address === "0x4a8c9502a34962a2c6d73c5d181daaef3dcdc88d"
    ),
    false
  );
  const ctx = context();
  await handleAuthorityReference(ctx, event(10, 0, { authority: bob }));
  const observed = await getObservedAuthorityFields(ctx, 1, [
    field("authority", "authority-reference"),
  ]);
  const discovered = observed.filter((entry) => entry.address === bob);
  assert.equal(discovered.length, 8);
  assert.equal(
    discovered.every((entry) => entry.startBlock === 10),
    true
  );
  assert.equal(
    new Set(
      observed.map((entry) => relationshipId(1, entry.address, entry.getter))
    ).size,
    observed.length
  );
  await complete(ctx, 11, discovered, {
    governor: alice,
    newGovernor: alice,
    guardian: alice,
    newGuardian: zero,
    policy: zero,
    newPolicy: zero,
    vault: alice,
    newVault: zero,
  });
  const governor = await ctx.ContractRelationship.get(
    relationshipId(1, bob, "governor")
  );
  assert.equal(governor.source, alice);
  assert.match(governor.coverage, /discovered at reference block 10/);
  await handleAuthorityEvent(
    ctx,
    {
      ...event(12, 0, { from: alice, to: alice, _effectiveImmediately: true }),
      srcAddress: bob,
    },
    "governor",
    "Pushed"
  );
  assert.match(
    (await ctx.ContractRelationship.get(relationshipId(1, bob, "governor")))
      .coverage,
    /discovered at reference block 10/
  );
});

test("Authority constructor push establishes current holders without inventing new* nominations", async () => {
  const ctx = context();
  await handleAuthorityEvent(
    ctx,
    event(1, 0, { from: zero, to: alice, _effectiveImmediately: true }),
    "governor",
    "Pushed"
  );
  assert.equal((await row(ctx, "governor")).source, alice);
  assert.equal(await row(ctx, "newGovernor"), undefined);
  await complete(
    ctx,
    1,
    [field("governor"), field("newGovernor", "governor")],
    { governor: alice, newGovernor: zero }
  );
  assert.equal((await row(ctx, "newGovernor")).value, zero);
  assert.equal((await row(ctx, "newGovernor")).verification.outcome, "match");
  await handleAuthorityEvent(
    ctx,
    event(2, 0, { from: alice, to: bob, _effectiveImmediately: false }),
    "governor",
    "Pushed"
  );
  await handleAuthorityEvent(
    ctx,
    event(3, 0, { from: zero, to: zero, _effectiveImmediately: true }),
    "governor",
    "Pushed"
  );
  assert.equal((await row(ctx, "newGovernor")).value, zero);
  assert.equal((await row(ctx, "governor")).value, zero);
});

test("getter-only state verifies its latest observation anchor after a checkpoint update", async () => {
  const ctx = context();
  const minter = {
    ...field("approved", "legacy-minter"),
    coverage: "getter-only: no change event",
  };
  await complete(ctx, 1, [minter], { approved: alice });
  await complete(ctx, 2, [minter], { approved: bob });
  const result = await completeRelationshipBlock(
    ctx,
    1,
    block(3),
    [minter],
    async () => ({ status: "success", value: alice }),
    async (number) => ({
      ...block(Number(number)),
      ...(number === "2" ? { hash: "0xfork" } : {}),
    })
  );
  assert.equal(result, false);
  assert.equal((await row(ctx, "approved")).source, bob);
  assert.equal((await row(ctx, "approved")).indexedThrough.number, "2");
});

test("every configured relationship capability retains event subscriptions and creation coverage on all indexed chains", async () => {
  const { readFileSync } = await import("node:fs");
  const { getRelationshipFields } = await import(
    "../src/events/ownership-contracts.ts"
  );
  const config = readFileSync(
    new URL("../config.yaml", import.meta.url),
    "utf8"
  );
  const families = {
    owner: "Owned",
    authority: "OlympusAccessControlled",
    governor: "OlympusAuthority",
    stakingContract: "StakedOHM",
    approved: "GovernanceOHM",
  };
  for (const section of config.split(/(?= {2}- id:)/).slice(1)) {
    const chainId = Number(section.match(/ {2}- id: (\d+)/)[1]);
    const chainStart = Number(section.match(/ {4}start_block: (\d+)/)[1]);
    const fields = getRelationshipFields(chainId);
    for (const [getter, family] of Object.entries(families)) {
      const expected = fields.filter(
        (field) =>
          field.getter === getter &&
          field.kind !== "contract-reference" &&
          (getter !== "owner" || field.kind === "owner")
      );
      if (!expected.length) continue;
      const pattern = new RegExp(
        ` {6}- name: ${family}\\n {8}address:\\n((?: {10}- "[^"\\n]+"\\n)+) {8}start_block: (\\d+)`
      );
      const actual = section.match(pattern);
      assert.ok(actual, `${chainId}: ${family}`);
      for (const field of expected) {
        assert.ok(
          actual[1].includes(field.address),
          `${chainId}: ${field.address}`
        );
        assert.ok(Number(actual[2]) <= field.startBlock);
        assert.ok(chainStart <= field.startBlock);
      }
    }
  }
});

test("CCIP admin requests preserve current holder; registration, pool owner and nominee are independent", async () => {
  const { handleRegistryEvent, handleChainlinkOwnershipEvent } = await import(
    "../src/events/ownership.ts"
  );
  const token = "0x0000000000000000000000000000000000000004";
  const ctx = context();
  await handleRegistryEvent(
    ctx,
    event(1, 0, { token, newAdmin: alice }),
    "AdministratorTransferred",
    token
  );
  await handleRegistryEvent(
    ctx,
    event(2, 0, { token, currentAdmin: alice, newAdmin: bob }),
    "AdministratorTransferRequested",
    token
  );
  assert.equal((await row(ctx, `administrator:${token}`)).source, alice);
  assert.equal((await row(ctx, `administrator:${token}`)).target, token);
  assert.deepEqual((await row(ctx, `administrator:${token}`)).scope, {
    registry: subject,
    token,
  });
  assert.equal((await row(ctx, `newAdministrator:${token}`)).status, "pending");
  await handleRegistryEvent(
    ctx,
    event(2, 1, { token: bob, newAdmin: bob }),
    "AdministratorTransferred",
    token
  );
  assert.equal((await row(ctx, `administrator:${token}`)).source, alice);
  await handleRegistryEvent(
    ctx,
    event(3, 0, { token, newPool: bob }),
    "PoolSet",
    token
  );
  assert.equal((await row(ctx, `getPool:${token}`)).source, subject);
  assert.equal((await row(ctx, `getPool:${token}`)).target, bob);
  await handleChainlinkOwnershipEvent(
    ctx,
    { ...event(3, 1, { from: zero, to: alice }), srcAddress: bob },
    "OwnershipTransferred",
    "pool-owner"
  );
  await handleChainlinkOwnershipEvent(
    ctx,
    { ...event(4, 0, { from: alice, to: subject }), srcAddress: bob },
    "OwnershipTransferRequested",
    "pool-owner"
  );
  assert.equal(
    (await ctx.ContractRelationship.get(relationshipId(1, bob, "owner")))
      .source,
    alice
  );
  assert.equal(
    (await ctx.ContractRelationship.get(relationshipId(1, bob, "newOwner")))
      .status,
    "pending"
  );
  await completeRelationshipBlock(
    ctx,
    1,
    block(4),
    [{ address: bob, startBlock: 1, getter: "owner", kind: "pool-owner" }],
    async () => ({ status: "unavailable", reason: "timeout" }),
    async (number) => block(Number(number))
  );
  assert.equal(
    (await ctx.ContractRelationship.get(relationshipId(1, bob, "owner")))
      .source,
    alice
  );
  await handleRegistryEvent(
    ctx,
    event(5, 0, { token, newAdmin: bob }),
    "AdministratorTransferred",
    token
  );
  assert.equal((await row(ctx, `newAdministrator:${token}`)).value, zero);
  await handleRegistryEvent(
    ctx,
    event(6, 0, { token, newPool: zero }),
    "PoolSet",
    token
  );
  await handleRegistryEvent(
    ctx,
    event(6, 0, { token, newPool: zero }),
    "PoolSet",
    token
  );
  assert.equal((await row(ctx, `getPool:${token}`)).status, "unset");
  assert.equal(
    (await ctx.ContractRelationship.get(relationshipId(1, bob, "owner")))
      .source,
    alice
  );
  assert.equal(
    [...ctx.ControlTransition.rows.values()].filter(
      (row) => row.blockNumber === 6n
    ).length,
    1
  );
});

test("immutable references keep direction beside ownership; unavailable pending owner stays unknown", async () => {
  const ctx = context();
  await handleOwnershipEvent(ctx, event(1, 0, { newOwner: bob }));
  await complete(
    ctx,
    2,
    [field("COOLERV2", "cooler-reference"), field("newOwner", "pool-owner")],
    { COOLERV2: bob }
  );
  assert.equal((await row(ctx, "COOLERV2")).source, subject);
  assert.equal((await row(ctx, "COOLERV2")).target, bob);
  assert.equal((await row(ctx, "COOLERV2")).status, "reference");
  assert.equal((await row(ctx, "owner")).source, bob);
  assert.equal((await row(ctx, "newOwner")).value, null);
  ctx.ContractRelationship.set({
    ...(await row(ctx, "newOwner")),
    value: undefined,
  });
  await complete(ctx, 3, [field("newOwner", "pool-owner")], {});
  assert.equal((await row(ctx, "newOwner")).status, "unset");
  assert.equal((await row(ctx, "newOwner")).source, subject);
  assert.equal((await row(ctx, "newOwner")).target, null);
});

test("inventory supplies Cooler/config references and discovers selected pools", async () => {
  const { getRelationshipFields, getObservedPoolFields } = await import(
    "../src/events/ownership-contracts.ts"
  );
  const fields = getRelationshipFields(1);
  assert.ok(
    fields.some(
      (field) =>
        field.address === "0xe045bd0a0d85e980aa152064c06eae6b6ae358d2" &&
        field.getter === "COOLERV2"
    )
  );
  assert.ok(
    fields.some(
      (field) => field.getter === "config" && field.kind === "configured-policy"
    )
  );
  assert.ok(
    fields.some(
      (field) => field.getter === "pool" && field.kind === "configured-pool"
    )
  );
  const ctx = context();
  const registry = field(`getPool:${alice}`, "registered-pool");
  await complete(ctx, 1, [registry], { [registry.getter]: bob });
  const observed = await getObservedPoolFields(ctx, 1, [registry]);
  assert.ok(
    observed.some(
      (field) =>
        field.address === bob &&
        field.getter === "owner" &&
        /earlier state/.test(field.coverage)
    )
  );
});

test("registry rollback restores scoped current state and removes orphan transitions and discovered pools", async () => {
  const { handleRegistryEvent } = await import("../src/events/ownership.ts");
  const { getObservedPoolFields } = await import(
    "../src/events/ownership-contracts.ts"
  );
  const ctx = context();
  const token = alice;
  const fields = [
    {
      ...field(`getPool:${token}`, "registered-pool"),
      scope: { registry: subject, token },
    },
  ];
  await handleRegistryEvent(
    ctx,
    event(1, 0, { token, newPool: bob }),
    "PoolSet",
    token
  );
  const saved = structuredClone([...ctx.ContractRelationship.rows]);
  const transitions = structuredClone([...ctx.ControlTransition.rows]);
  await handleRegistryEvent(
    ctx,
    event(2, 0, { token, newPool: subject }),
    "PoolSet",
    token
  );
  let observed = await getObservedPoolFields(ctx, 1, fields);
  assert.ok(
    observed.some(
      (field) => field.address === bob && field.kind === "pool-owner"
    )
  );
  assert.ok(
    observed.some(
      (field) => field.address === subject && field.kind === "pool-owner"
    )
  );
  ctx.ContractRelationship.rows.clear();
  for (const [id, value] of saved) ctx.ContractRelationship.rows.set(id, value);
  ctx.ControlTransition.rows.clear();
  for (const [id, value] of transitions)
    ctx.ControlTransition.rows.set(id, value);
  observed = await getObservedPoolFields(ctx, 1, fields);
  assert.equal((await row(ctx, `getPool:${token}`)).value, bob);
  assert.equal(ctx.ControlTransition.rows.size, 1);
  assert.equal(
    observed.some(
      (field) => field.address === subject && field.kind === "pool-owner"
    ),
    false
  );
});

test("registered pool discrepancy uses observed address and clears after inventory registration returns", async () => {
  const { handleRegistryEvent } = await import("../src/events/ownership.ts");
  const ctx = context();
  const token = alice;
  const getter = `getPool:${token}`;
  const f = {
    ...field(getter, "registered-pool"),
    inventoryPools: [bob],
    scope: { registry: subject, token },
  };
  await handleRegistryEvent(
    ctx,
    event(1, 0, { token, newPool: alice }),
    "PoolSet",
    token
  );
  await complete(ctx, 1, [f], { [getter]: alice });
  assert.equal((await row(ctx, getter)).target, alice);
  assert.match((await row(ctx, getter)).coverage, /differs from inventory/);
  await handleRegistryEvent(
    ctx,
    event(2, 0, { token, newPool: bob }),
    "PoolSet",
    token
  );
  await complete(ctx, 2, [f], { [getter]: bob });
  assert.equal((await row(ctx, getter)).target, bob);
  assert.equal((await row(ctx, getter)).coverage, undefined);
});
