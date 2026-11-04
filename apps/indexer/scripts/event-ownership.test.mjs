import assert from "node:assert/strict";
import { test } from "node:test";
import {
  completeRelationshipBlock,
  handleChainlinkOwnershipEvent,
  handleOpenZeppelinOwnershipEvent,
  handleOwnershipEvent,
  handleRegistryEvent,
  relationshipId,
} from "../src/events/ownership.ts";

const subject = `0x${"11".repeat(20)}`;
const alice = `0x${"22".repeat(20)}`;
const bob = `0x${"33".repeat(20)}`;
const zero = `0x${"0".repeat(40)}`;
const codeHash = `0x${"44".repeat(32)}`;
const block = (number) => ({
  number: String(number),
  hash: `0x${number.toString(16).padStart(64, "0")}`,
  timestamp: String(number + 1700000000),
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
  ControlTransition: store(),
  ChainObservation: store(),
});
const owner = {
  address: subject,
  startBlock: 1,
  getter: "owner",
  kind: "owner",
  eventPolicy: { profile: "solmate-owned", codeHash, version: "fixture-v1" },
};
const event = (number, value) => ({
  chainId: 1,
  srcAddress: subject,
  block: { ...block(number), number, timestamp: number + 1700000000 },
  transaction: { hash: `0x${"55".repeat(32)}` },
  logIndex: 0,
  params: { newOwner: value },
});
const verified = (value = alice, hash = codeHash) => ({
  status: "success",
  value,
  functionContext: {
    signature: "owner()",
    source: { url: "https://example.invalid/verified", codeHash: hash },
  },
});

test("full verification reads ownership again after events and restart, without changing event provenance", async () => {
  let ctx = context(),
    value = alice,
    reads = 0;
  const complete = (n) =>
    completeRelationshipBlock(
      ctx,
      1,
      block(n),
      [owner],
      async () => {
        reads++;
        return verified(value);
      },
      async (n) => block(Number(n))
    );
  await complete(1);
  await complete(2);
  assert.equal(reads, 2);
  value = bob;
  await handleOwnershipEvent(ctx, event(3, bob));
  const eventState = await ctx.ContractRelationship.get(
    relationshipId(1, subject, "owner")
  );
  assert.equal(eventState.verification.outcome, "unperformed");
  assert.equal(
    eventState.verification.block.number,
    "2",
    "event must preserve the actual previous verification block"
  );
  await complete(4);
  let row = await ctx.ContractRelationship.get(
    relationshipId(1, subject, "owner")
  );
  assert.equal(row.value, bob);
  assert.equal(row.provenance.number, "3");
  assert.equal(row.verification.block.number, "4");
  assert.equal(row.verification.outcome, "match");
  const persisted = structuredClone([...ctx.ContractRelationship.rows]);
  ctx = context();
  for (const [id, row] of persisted) ctx.ContractRelationship.rows.set(id, row);
  await complete(5);
  assert.equal(
    reads,
    4,
    "persisted event proof cannot bypass full verification"
  );
  value = alice;
  await complete(6);
  row = await ctx.ContractRelationship.get(relationshipId(1, subject, "owner"));
  assert.equal(
    row.value,
    bob,
    "event-covered current state remains distinguishable from a conflicting getter"
  );
  assert.equal(row.verification.outcome, "mismatch");
  assert.equal(row.verification.getterValue, alice);
});

test("OZ two-step requests leave owner unchanged, acceptance and renunciation clear pendingOwner", async () => {
  const ctx = context();
  const eventPolicy = { ...owner.eventPolicy, profile: "oz-ownable2step" };
  const fields = ["owner", "pendingOwner"].map((getter) => ({
    ...owner,
    getter,
    eventPolicy,
  }));
  let reads = 0;
  const complete = (number) =>
    completeRelationshipBlock(
      ctx,
      1,
      block(number),
      fields,
      async (_address, getter) => {
        reads++;
        return verified(
          getter === "owner"
            ? number < 3
              ? alice
              : number < 5
                ? bob
                : zero
            : number === 2
              ? bob
              : zero
        );
      },
      async (number) => block(Number(number))
    );
  await complete(1);
  await handleOpenZeppelinOwnershipEvent(
    ctx,
    event(2, bob),
    "OwnershipTransferStarted"
  );
  await complete(2);
  const get = (getter) =>
    ctx.ContractRelationship.get(relationshipId(1, subject, getter));
  assert.equal((await get("owner")).value, alice);
  assert.equal((await get("pendingOwner")).value, bob);
  assert.equal((await get("pendingOwner")).status, "pending");
  await handleOpenZeppelinOwnershipEvent(
    ctx,
    event(3, bob),
    "OwnershipTransferred"
  );
  await complete(4);
  assert.equal((await get("owner")).value, bob);
  assert.equal((await get("pendingOwner")).value, zero);
  assert.equal((await get("pendingOwner")).status, "unset");
  await handleOpenZeppelinOwnershipEvent(
    ctx,
    event(5, zero),
    "OwnershipTransferred"
  );
  await complete(6);
  assert.equal((await get("owner")).status, "unset");
  assert.equal(reads, 8, "each full observation verifies both public getters");
});

test("OZ Ownable v4 and v5 profiles replay transfers and renunciation after canonical seeding", async () => {
  for (const version of ["oz-ownable-v4", "oz-ownable-v5"]) {
    const ctx = context();
    const candidate = {
      ...owner,
      eventPolicy: { ...owner.eventPolicy, profile: "oz-ownable", version },
    };
    let reads = 0;
    const complete = (number) =>
      completeRelationshipBlock(
        ctx,
        1,
        block(number),
        [candidate],
        async () => {
          reads++;
          return verified(number < 2 ? alice : number < 4 ? bob : zero);
        },
        async (n) => block(Number(n))
      );
    await handleOwnershipEvent(ctx, event(1, alice));
    await complete(1);
    await handleOwnershipEvent(ctx, event(2, bob));
    await complete(3);
    assert.equal(
      (await ctx.ContractRelationship.get(relationshipId(1, subject, "owner")))
        .value,
      bob
    );
    await handleOwnershipEvent(ctx, event(4, zero));
    await complete(5);
    assert.equal(
      (await ctx.ContractRelationship.get(relationshipId(1, subject, "owner")))
        .status,
      "unset"
    );
    assert.equal(reads, 3, version);
  }
});

test("constructor event state still needs one runtime seed and rejects late events behind completed coverage", async () => {
  const ctx = context();
  let reads = 0;
  await handleOwnershipEvent(ctx, event(1, alice));
  await completeRelationshipBlock(
    ctx,
    1,
    block(5),
    [owner],
    async () => {
      reads++;
      return verified();
    },
    async (n) => block(Number(n))
  );
  assert.equal(reads, 1);
  await assert.rejects(
    () => handleOwnershipEvent(ctx, event(4, bob)),
    /completed ownership checkpoint/
  );
});

test("TokenAdminRegistry replay isolates token-scoped admin and pool changes and keeps private pending owner event-only", async () => {
  const ctx = context();
  const token = `0x${"66".repeat(20)}`;
  const eventPolicy = {
    ...owner.eventPolicy,
    profile: "chainlink-token-admin-registry",
  };
  const fields = [
    "owner",
    "newOwner",
    `administrator:${token}`,
    `newAdministrator:${token}`,
    `getPool:${token}`,
  ].map((getter) => ({
    ...owner,
    getter,
    kind:
      getter === "owner" || getter === "newOwner"
        ? "registry-owner"
        : getter.startsWith("getPool:")
          ? "registered-pool"
          : "token-admin",
    eventPolicy,
    scope: { registry: subject, token },
  }));
  let reads = 0;
  const complete = (number) =>
    completeRelationshipBlock(
      ctx,
      1,
      block(number),
      fields,
      async (_address, getter) => {
        if (getter === "newOwner")
          return { status: "unavailable", reason: "no public pending getter" };
        reads++;
        return verified(getter.startsWith("newAdministrator:") ? zero : alice);
      },
      async (number) => block(Number(number))
    );
  await complete(1);
  const requested = { ...event(2, bob), params: { from: alice, to: bob } };
  await handleChainlinkOwnershipEvent(
    ctx,
    requested,
    "OwnershipTransferRequested",
    "registry-owner"
  );
  await handleRegistryEvent(
    ctx,
    { ...event(2, bob), logIndex: 1, params: { token, newAdmin: bob } },
    "AdministratorTransferRequested",
    token
  );
  await complete(2);
  const get = (getter) =>
    ctx.ContractRelationship.get(relationshipId(1, subject, getter));
  assert.equal((await get("owner")).value, alice);
  assert.equal((await get("newOwner")).value, bob);
  assert.equal((await get(`administrator:${token}`)).value, alice);
  assert.equal((await get(`newAdministrator:${token}`)).value, bob);
  assert.equal(
    (await get("newOwner")).verification.outcome,
    "unavailable",
    "a private pending getter is never labeled RPC-verified"
  );
  await handleRegistryEvent(
    ctx,
    { ...event(3, bob), params: { token: alice, newAdmin: zero } },
    "AdministratorTransferRequested",
    token
  );
  assert.equal(
    (await get(`newAdministrator:${token}`)).value,
    bob,
    "another token does not touch the configured token"
  );
  await handleRegistryEvent(
    ctx,
    { ...event(4, bob), params: { token, newAdmin: bob } },
    "AdministratorTransferred",
    token
  );
  await handleRegistryEvent(
    ctx,
    { ...event(4, bob), logIndex: 1, params: { token, newPool: zero } },
    "PoolSet",
    token
  );
  await handleChainlinkOwnershipEvent(
    ctx,
    { ...event(4, bob), logIndex: 2, params: { from: alice, to: bob } },
    "OwnershipTransferred",
    "registry-owner"
  );
  await complete(5);
  assert.equal((await get("owner")).value, bob);
  assert.equal((await get("newOwner")).value, zero);
  assert.equal((await get(`administrator:${token}`)).value, bob);
  assert.equal((await get(`newAdministrator:${token}`)).value, zero);
  assert.equal((await get(`getPool:${token}`)).value, zero);
  assert.equal(reads, 12, "each full observation verifies four public getters");
});

test("unproven runtime, getter-only coverage, changed policy, backward reads and unknown contracts retain ordinary reads", async () => {
  for (const variant of [
    "unknown",
    "runtime",
    "getter-only",
    "policy",
    "backward",
  ]) {
    const ctx = context();
    let reads = 0;
    let candidate = { ...owner };
    if (variant === "unknown") delete candidate.eventPolicy;
    if (variant === "getter-only")
      candidate.coverage = "getter-only: a silent setter exists";
    const complete = (number) =>
      completeRelationshipBlock(
        ctx,
        1,
        block(number),
        [candidate],
        async () => {
          reads++;
          return verified(
            alice,
            variant === "runtime" ? block(999).hash : codeHash
          );
        },
        async (number) => block(Number(number))
      );
    await complete(2);
    if (variant === "policy")
      candidate = {
        ...candidate,
        eventPolicy: { ...candidate.eventPolicy, version: "replacement-proof" },
      };
    await complete(variant === "backward" ? 1 : 3);
    assert.equal(reads, 2, variant);
  }
});

test("deterministic source profiles cover subscribed contracts and exclude unknown implementations", async () => {
  const { readFileSync } = await import("node:fs");
  const { getRelationshipFields } = await import(
    "../src/events/ownership-contracts.ts"
  );
  const { configureOwnershipEventFields } = await import(
    "../src/events/ownership-policy.ts"
  );
  const proofs = JSON.parse(
    readFileSync(
      new URL("../src/generated/ownership-read-proofs.json", import.meta.url)
    )
  );
  const config = readFileSync(
    new URL("../config.yaml", import.meta.url),
    "utf8"
  );
  for (const binding of proofs.contracts) {
    const section = config
      .split(`  - id: ${binding.chainId}\n`)[1]
      .split(/\n {2}- id: /)[0];
    const profile = proofs.implementations.find(
      (entry) => entry.id === binding.implementation
    );
    const subscription = profile.profile.startsWith("chainlink")
      ? "ChainlinkOwned"
      : "Owned";
    const addresses = section
      .split(`      - name: ${subscription}\n`)[1]
      .split(/\n {6}- name:/)[0];
    assert(addresses.includes(binding.address));
    const field = configureOwnershipEventFields(
      binding.chainId,
      getRelationshipFields(binding.chainId),
      {
        Owned: subscription === "Owned" ? [binding.address] : [],
        ChainlinkOwned:
          subscription === "ChainlinkOwned" ? [binding.address] : [],
        TokenAdminRegistry:
          profile.profile === "chainlink-token-admin-registry"
            ? [binding.address]
            : [],
      }
    ).find(
      (entry) => entry.address === binding.address && entry.getter === "owner"
    );
    assert.equal(field.eventPolicy.codeHash, profile.codeHash);
  }
});

test("removing a required event subscription disables persisted proof reuse", async () => {
  const { configureOwnershipEventFields } = await import(
    "../src/events/ownership-policy.ts"
  );
  const { getRelationshipFields } = await import(
    "../src/events/ownership-contracts.ts"
  );
  const address = "0xe045bd0a0d85e980aa152064c06eae6b6ae358d2";
  const fields = getRelationshipFields(1).filter(
    (field) => field.address === address && field.getter === "owner"
  );
  let configured = configureOwnershipEventFields(1, fields, {
    Owned: [address],
    ChainlinkOwned: [],
    TokenAdminRegistry: [],
  });
  assert(configured[0].eventPolicy);
  let reads = 0;
  const ctx = context();
  const hash = configured[0].eventPolicy.codeHash;
  const complete = (number) =>
    completeRelationshipBlock(
      ctx,
      1,
      block(number),
      configured,
      async () => {
        reads++;
        return verified(alice, hash);
      },
      async (n) => block(Number(n))
    );
  // The actual configured contract was deployed before this bounded fixture.
  configured[0].startBlock = 1;
  await complete(1);
  configured = configureOwnershipEventFields(1, configured, {
    Owned: [],
    ChainlinkOwned: [],
    TokenAdminRegistry: [],
  });
  assert.equal(configured[0].eventPolicy, undefined);
  await complete(2);
  assert.equal(reads, 2);
});

test("restoring entity state on rollback removes orphan ownership state and its derived observation", async () => {
  let ctx = context();
  let reads = 0;
  const complete = (number) =>
    completeRelationshipBlock(
      ctx,
      1,
      block(number),
      [owner],
      async () => {
        reads++;
        return verified();
      },
      async (n) => block(Number(n))
    );
  await complete(1);
  const persisted = structuredClone([...ctx.ContractRelationship.rows]);
  await handleOwnershipEvent(ctx, event(2, bob));
  await complete(3);
  assert.equal(
    (await ctx.ContractRelationship.get(relationshipId(1, subject, "owner")))
      .value,
    bob
  );
  ctx = context();
  for (const [id, row] of persisted) ctx.ContractRelationship.rows.set(id, row);
  await handleOwnershipEvent(ctx, event(2, zero));
  await complete(3);
  assert.equal(
    (await ctx.ContractRelationship.get(relationshipId(1, subject, "owner")))
      .value,
    zero
  );
  assert.equal(
    (await ctx.ContractRelationship.get(relationshipId(1, subject, "owner")))
      .status,
    "unset"
  );
  assert.equal(reads, 3);
});

test("every full observation verifies ownership even with a reviewed event policy", async () => {
  for (const proven of [false, true]) {
    const ctx = context(),
      candidate = { ...owner };
    if (!proven) delete candidate.eventPolicy;
    let reads = 0;
    for (let n = 1; n <= 10; n++)
      await completeRelationshipBlock(
        ctx,
        1,
        block(n),
        [candidate],
        async () => {
          reads++;
          return verified();
        },
        async (n) => block(Number(n))
      );
    assert.equal(reads, 10);
    assert.equal(
      (await ctx.ContractRelationship.get(relationshipId(1, subject, "owner")))
        .verification.block.number,
      "10"
    );
  }
});
