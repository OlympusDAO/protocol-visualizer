import assert from "node:assert/strict";
import { test } from "node:test";
import {
  completeRelationshipBlock,
  handleOwnershipEvent,
  handleOpenZeppelinOwnershipEvent,
  handleChainlinkOwnershipEvent,
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
  ContractStateSeed: store(),
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

test("proven ownership seeds once, follows events, and preserves actual RPC provenance across checkpoints and restart", async () => {
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
      async (number) => block(Number(number))
    );
  assert.equal(await complete(1), true);
  assert.equal(await complete(2), true);
  assert.equal(reads, 1, "a proven unchanged owner requires no checkpoint RPC");
  await handleOwnershipEvent(ctx, event(3, bob));
  assert.equal(await complete(4), true);
  const state = await ctx.ContractRelationship.get(
    relationshipId(1, subject, "owner")
  );
  assert.equal(state.value, bob);
  assert.equal(state.provenance.number, "3");
  assert.equal(state.indexedThrough.number, "4");
  assert.equal(state.verification.outcome, "unperformed");
  assert.equal(state.verification.block.number, "1");
  assert.equal(state.verification.getterValue, alice);
  assert.match(state.verification.reason, /event/i);
  assert.equal(reads, 1);
  const persisted = structuredClone([...ctx.ContractRelationship.rows]);
  ctx = context();
  for (const [id, row] of persisted) ctx.ContractRelationship.rows.set(id, row);
  assert.equal(await complete(5), true);
  assert.equal(reads, 1, "the proof and event state persist with the entity");
  await handleOwnershipEvent(ctx, event(6, zero));
  assert.equal(await complete(7), true);
  assert.equal(
    (await ctx.ContractRelationship.get(relationshipId(1, subject, "owner")))
      .status,
    "unset"
  );
  assert.equal(
    reads,
    1,
    "renunciation is an event change, not a new getter read"
  );
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
        return verified(getter === "owner" ? alice : zero);
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
  assert.equal(reads, 2, "both getters are seeded only once");
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
          return verified();
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
    assert.equal(reads, 1, version);
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
    (await get("newOwner")).verification.block,
    undefined,
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
  assert.equal(
    reads,
    4,
    "four public getter operations seed once despite all event types"
  );
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

test("orphaned runtime seed or changed current header cannot advance event-reused observations", async () => {
  for (const changed of [1, 4]) {
    const ctx = context();
    let reads = 0;
    const read = async () => {
      reads++;
      return verified();
    };
    await completeRelationshipBlock(
      ctx,
      1,
      block(1),
      [owner],
      read,
      async (n) => block(Number(n))
    );
    await handleOwnershipEvent(ctx, event(2, bob));
    const complete = await completeRelationshipBlock(
      ctx,
      1,
      block(4),
      [owner],
      read,
      async (n) =>
        Number(n) === changed
          ? { ...block(Number(n)), hash: block(999).hash }
          : block(Number(n))
    );
    assert.equal(complete, false);
    assert.equal(ctx.ChainObservation.rows.get("1").indexedThrough.number, "1");
    assert.equal(reads, 1);
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

test("event replay refreshes referenced code and checks current canonicality after that read", async () => {
  const ctx = context();
  let reads = 0;
  const read = async () => {
    reads++;
    return { ...verified(), targetCode: "absent" };
  };
  await completeRelationshipBlock(ctx, 1, block(1), [owner], read, async (n) =>
    block(Number(n))
  );
  await completeRelationshipBlock(ctx, 1, block(2), [owner], read, async (n) =>
    block(Number(n))
  );
  assert.equal(
    reads,
    2,
    "without a code refresh reader it falls back to the ordinary getter"
  );
  await completeRelationshipBlock(
    ctx,
    1,
    block(3),
    [owner],
    read,
    async (n) => block(Number(n)),
    async () => "present"
  );
  assert.equal(reads, 2);
  assert.equal(
    (await ctx.ContractRelationship.get(relationshipId(1, subject, "owner")))
      .targetCode,
    "present"
  );
  let changed = false;
  const completed = await completeRelationshipBlock(
    ctx,
    1,
    block(4),
    [owner],
    read,
    async (n) =>
      Number(n) === 4 && changed
        ? { ...block(4), hash: block(999).hash }
        : block(Number(n)),
    async () => {
      changed = true;
      return "absent";
    }
  );
  assert.equal(completed, false);
  assert.equal(ctx.ChainObservation.rows.get("1").indexedThrough.number, "3");
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
  assert.equal(reads, 1);
});

test("ten quiet checkpoints replace ten ownership getter operations with one seed", async () => {
  const run = async (proven) => {
    const ctx = context();
    let reads = 0;
    const candidate = { ...owner };
    if (!proven) delete candidate.eventPolicy;
    for (let number = 1; number <= 10; number++)
      await completeRelationshipBlock(
        ctx,
        1,
        block(number),
        [candidate],
        async () => {
          reads++;
          return verified();
        },
        async (n) => block(Number(n))
      );
    return reads;
  };
  assert.equal(await run(false), 10);
  assert.equal(await run(true), 1);
});

test("controlled production-reader fixture reduces 69 RPCs to 42 across ten quiet checkpoints including target-code and canonical checks", async () => {
  const http = await import("node:http");
  const {
    createPublicClient,
    http: transport,
    keccak256,
  } = await import("viem");
  const { readPinnedControlGetter } = await import(
    "../src/events/control-reads.ts"
  );
  const runtime = "0x6000";
  const runtimeHash = keccak256(runtime);
  let requests = 0;
  const server = http.createServer(async (req, res) => {
    let raw = "";
    for await (const chunk of req) raw += chunk;
    const payload = JSON.parse(raw);
    requests++;
    let result;
    if (payload.method === "eth_getBlockByNumber") {
      const number = Number(BigInt(payload.params[0]));
      result = {
        ...block(number),
        number: payload.params[0],
        timestamp: `0x${(1700000000 + number).toString(16)}`,
        transactions: [],
      };
    } else if (payload.method === "eth_getCode") result = runtime;
    else if (payload.method === "eth_call")
      result = `0x${"00".repeat(12)}${alice.slice(2)}`;
    else throw new Error(`Unexpected fixture method ${payload.method}`);
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ id: payload.id, jsonrpc: "2.0", result }));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const client = createPublicClient({
      transport: transport(`http://127.0.0.1:${server.address().port}`, {
        retryCount: 0,
      }),
    });
    const contract = {
      addressGetters: ["owner"],
      functionSelectors: {
        owner: {
          canonicalSignature: "owner()",
          documentation: {
            signature: "owner()",
            source: {
              codeHash: runtimeHash,
              url: "https://example.invalid/fixture-source",
            },
          },
        },
      },
    };
    const run = async (reuse) => {
      requests = 0;
      const ctx = context();
      const candidate = {
        ...owner,
        eventPolicy: { ...owner.eventPolicy, codeHash: runtimeHash },
      };
      if (!reuse) delete candidate.eventPolicy;
      for (let number = 1; number <= 10; number++) {
        await completeRelationshipBlock(
          ctx,
          1,
          block(number),
          [candidate],
          () =>
            readPinnedControlGetter(
              client,
              {
                chainId: 1,
                address: subject,
                getter: "owner",
                blockNumber: BigInt(number),
                blockHash: block(number).hash,
              },
              contract
            ),
          async (n) => {
            const header = await client.getBlock({ blockNumber: BigInt(n) });
            return {
              number: n,
              hash: header.hash,
              timestamp: header.timestamp.toString(),
            };
          },
          async (address, at) =>
            (await client.getCode({
              address,
              blockHash: at.hash,
              requireCanonical: true,
            }))
              ? "present"
              : "absent"
        );
      }
      return {
        requests,
        value: (
          await ctx.ContractRelationship.get(
            relationshipId(1, subject, "owner")
          )
        ).value,
      };
    };
    const baseline = await run(false);
    const reused = await run(true);
    assert.equal(baseline.requests, 69);
    assert.equal(reused.requests, 42);
    assert.equal(reused.value, baseline.value);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
