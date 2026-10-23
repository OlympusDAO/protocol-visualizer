import assert from "node:assert/strict";
import { test } from "node:test";
import {
  processAbiMetadata,
  processVerifiedContractMetadata,
} from "../src/services/contracts/abi.ts";
import { keccak256 } from "viem";
import { readPinnedControlGetter } from "../src/events/control-reads.ts";
import { getRelationshipFields } from "../src/events/ownership-contracts.ts";
import {
  readPinnedModuleDependencies,
  completeModuleDependencies,
  getModuleDependencyFields,
} from "../src/events/module-dependencies.ts";
import { ContractFunctionRevertedError } from "viem";
import { KernelAbi } from "../abis/Kernel.ts";
import {
  completeRelationshipBlock,
  handleContractReference,
  relationshipId,
} from "../src/events/ownership.ts";

const fn = (
  name,
  inputs = [],
  outputs = [{ type: "address", internalType: "contract ITarget" }],
  stateMutability = "view"
) => ({ type: "function", name, inputs, outputs, stateMutability });

test("ABI discovery includes public contract getters and excludes arguments, tuples, multiple returns and mutations", () => {
  const result = processAbiMetadata([
    fn("TARGET"),
    fn("undocumented"),
    fn("pureTarget", [], undefined, "pure"),
    fn("mapping", [{ type: "uint256" }]),
    fn("tuple", [], [{ type: "tuple", components: [{ type: "address" }] }]),
    fn("multi", [], [{ type: "address" }, { type: "address" }]),
    fn("setTarget", [], undefined, "nonpayable"),
  ]);
  assert.deepEqual(result.addressGetters, [
    "TARGET",
    "undocumented",
    "pureTarget",
  ]);
});

test("verified metadata refresh upgrades legacy getters without discarding role mappings or accepting another deployment", () => {
  const previous = processAbiMetadata([fn("CD_FACILITY")]);
  const selector = Object.keys(previous.functionSelectors)[0];
  previous.functionSelectors[selector].roles = ["admin"];
  previous.roleToFunctions = { admin: ["CD_FACILITY"] };
  const verified = {
    chainId: "1",
    address: subject,
    runtimeMatch: "match",
    runtimeBytecode: { onchainBytecode: "0x1234" },
    metadata: {
      output: {
        abi: [fn("CD_FACILITY")],
        userdoc: {
          methods: { "CD_FACILITY()": { notice: "Not exact metadata" } },
        },
      },
    },
  };
  const refreshed = processVerifiedContractMetadata(
    verified,
    1,
    subject,
    previous
  );
  assert.deepEqual(refreshed.addressGetters, ["CD_FACILITY"]);
  assert.deepEqual(refreshed.functionSelectors[selector].roles, ["admin"]);
  assert.deepEqual(refreshed.roleToFunctions, previous.roleToFunctions);
  assert.equal(
    refreshed.functionSelectors[selector].documentation.source.codeHash,
    keccak256("0x1234")
  );
  assert.equal(
    refreshed.functionSelectors[selector].documentation.notice,
    undefined
  );
  assert.throws(() =>
    processVerifiedContractMetadata(
      { ...verified, address: target },
      1,
      subject,
      previous
    )
  );
});

test("deployed Auctioneer metadata discovers CD_FACILITY without a hardcoded contract-family exception", () => {
  const fields = getRelationshipFields(1);
  assert.ok(
    fields.some(
      (field) =>
        field.address === "0xf35193da8c10e44af10853ba5a3a1a6f7529e39a" &&
        field.getter === "CD_FACILITY" &&
        field.kind === "contract-reference"
    )
  );
});

test("compiler-resolved inherited docs join canonical overload signatures and remain plain text", () => {
  const source = {
    url: "https://sourcify.dev/example",
    codeHash: "0x1234",
    match: "exact",
  };
  const result = processAbiMetadata(
    [
      fn("target"),
      fn("target", [
        {
          type: "tuple[]",
          components: [{ type: "address" }, { type: "uint256" }],
        },
      ]),
    ],
    {
      userdoc: {
        methods: {
          "target()": { notice: "Inherited target notice {expression}" },
          "target((address,uint256)[])": { notice: "Different overload" },
        },
      },
      devdoc: {
        methods: {
          "target()": {
            details: "Compiler-resolved details",
            returns: { _0: "The destination" },
          },
        },
      },
    },
    source
  );
  const functions = Object.values(result.functionSelectors);
  assert.equal(
    functions.find((f) => f.canonicalSignature === "target()").documentation
      .notice,
    "Inherited target notice {expression}"
  );
  assert.equal(
    functions.find(
      (f) => f.canonicalSignature === "target((address,uint256)[])"
    ).documentation.notice,
    "Different overload"
  );
  assert.equal(
    functions.find((f) => f.canonicalSignature === "target()").documentation
      .returns._0,
    "The destination"
  );
  assert.deepEqual(functions[0].documentation.source, source);
});

const subject = "0x0000000000000000000000000000000000000001";
const target = "0x0000000000000000000000000000000000000002";
const other = "0x0000000000000000000000000000000000000003";
const zero = `0x${"0".repeat(40)}`;
const block = (number) => ({
  number: String(number),
  hash: `0xblock${number}`,
  timestamp: String(1700000000 + number),
});
const source = {
  url: "https://sourcify.dev/example",
  match: "exact",
  codeHash: keccak256("0x1234"),
};
const getterMetadata = processAbiMetadata(
  [fn("destination")],
  { userdoc: { methods: { "destination()": { notice: "The destination" } } } },
  source
);

test("generic reads are hash-pinned, verify the documentation revision and classify code without inferring an EOA", async () => {
  let calls = 0;
  const input = {
    chainId: 1,
    address: subject,
    blockNumber: 10n,
    blockHash: "0xa",
    getter: "destination",
  };
  const client = {
    getBlock: async () => ({ hash: "0xa" }),
    getCode: async (input) => {
      assert.equal(input.blockHash, "0xa");
      assert.equal(input.requireCanonical, true);
      return input.address === subject ? "0x1234" : "0x";
    },
    readContract: async (input) => {
      calls++;
      assert.equal(input.blockHash, "0xa");
      assert.equal(input.requireCanonical, true);
      return target;
    },
  };
  const result = await readPinnedControlGetter(client, input, getterMetadata);
  assert.equal(result.status, "success");
  assert.equal(result.targetCode, "absent");
  assert.equal(result.functionContext.notice, "The destination");
  assert.equal(
    (
      await readPinnedControlGetter(
        { ...client, getCode: async () => "0xabcd" },
        input,
        getterMetadata
      )
    ).status,
    "unavailable"
  );
  assert.equal(calls, 1);
  assert.equal(
    (
      await readPinnedControlGetter(
        client,
        input,
        processAbiMetadata([fn("destination")])
      )
    ).status,
    "unavailable"
  );
  assert.equal(calls, 1);
  assert.equal(
    (
      await readPinnedControlGetter(
        client,
        { ...input, getter: "setTarget" },
        getterMetadata
      )
    ).status,
    "unavailable"
  );
  let header = 0;
  assert.equal(
    (
      await readPinnedControlGetter(
        {
          ...client,
          getBlock: async () => ({ hash: ++header === 1 ? "0xa" : "0xb" }),
        },
        input,
        getterMetadata
      )
    ).status,
    "unavailable"
  );
});

const store = () => {
  const rows = new Map();
  return {
    rows,
    get: async (id) => rows.get(id),
    set: (row) => rows.set(row.id, structuredClone(row)),
    getWhere: async () => [],
  };
};
const context = () => ({
  ContractRelationship: store(),
  ContractStateSeed: store(),
  ControlTransition: store(),
  ChainObservation: store(),
});

test("Kernel dependency reads include read-only policies and handle both deployed array-bounds encodings without swallowing transport failures", async () => {
  const bounds = new ContractFunctionRevertedError({
    abi: KernelAbi,
    data: `0x4e487b71${"32".padStart(64, "0")}`,
  });
  const input = {
    kernel: subject,
    keycode: "PRICE",
    blockNumber: 10n,
    blockHash: "0xa",
  };
  const client = {
    getBlock: async () => ({ hash: "0xa" }),
    readContract: async ({
      functionName,
      args,
      blockHash,
      requireCanonical,
    }) => {
      assert.equal(blockHash, "0xa");
      assert.equal(requireCanonical, true);
      if (functionName === "getModuleForKeycode") return target;
      if (args[1] === 0n) return subject;
      if (args[1] === 1n) return other;
      throw bounds;
    },
  };
  assert.deepEqual(await readPinnedModuleDependencies(client, input), {
    status: "success",
    module: target,
    policies: [subject, other],
  });
  assert.equal(
    (
      await readPinnedModuleDependencies(
        {
          ...client,
          readContract: async (input) => {
            if (
              input.functionName === "moduleDependents" &&
              input.args[1] === 2n
            )
              throw new ContractFunctionRevertedError({
                abi: KernelAbi,
                data: "0x",
              });
            return client.readContract(input);
          },
        },
        input
      )
    ).status,
    "success"
  );
  assert.equal(
    (
      await readPinnedModuleDependencies(
        {
          ...client,
          readContract: async (input) => {
            if (
              input.functionName === "moduleDependents" &&
              input.args[1] === 1n
            )
              throw new Error("RPC unavailable");
            return client.readContract(input);
          },
        },
        input
      )
    ).status,
    "unavailable"
  );
  let reads = 0;
  assert.equal(
    (
      await readPinnedModuleDependencies(
        {
          ...client,
          getBlock: async () => ({ hash: ++reads === 1 ? "0xa" : "0xb" }),
        },
        input
      )
    ).status,
    "unavailable"
  );
});

test("module dependency links survive unavailable reads, follow upgrades and disappear on policy removal", async () => {
  const ctx = context();
  ctx.Contract = { getWhere: async () => [{ name: "PRICE" }] };
  ctx.ContractRelationship.getWhere = async () => [
    ...ctx.ContractRelationship.rows.values(),
  ];
  const observe = async (number, result) =>
    completeModuleDependencies(
      ctx,
      1,
      block(number),
      await getModuleDependencyFields(ctx, 1),
      async () => result,
      async (number) => block(Number(number))
    );
  const row = () =>
    ctx.ContractRelationship.rows.get(
      relationshipId(1, subject, "moduleDependents:PRICE")
    );
  await observe(10, { status: "success", module: target, policies: [subject] });
  assert.equal(row().source, subject);
  assert.equal(row().target, target);
  assert.equal(row().status, "reference");
  await observe(11, { status: "success", module: other, policies: [subject] });
  assert.equal(
    row().target,
    other,
    "an upgrade changes the module address without changing its keycode"
  );
  await observe(12, { status: "unavailable", reason: "RPC timeout" });
  assert.equal(row().target, other);
  assert.equal(row().verification.outcome, "unavailable");
  await observe(13, { status: "success", module: other, policies: [] });
  assert.equal(row().target, null);
  assert.equal(row().status, "unset");
});
const field = (getter) => ({
  address: subject,
  getter,
  kind: "contract-reference",
  startBlock: 10,
  coverage: "getter-only: observed at checkpoints",
});
const complete = (ctx, number, fields, values) =>
  completeRelationshipBlock(
    ctx,
    1,
    block(number),
    fields,
    async (_address, getter) =>
      values[getter] === undefined
        ? { status: "unavailable", reason: "timeout" }
        : {
            status: "success",
            value: values[getter],
            functionContext: { signature: `${getter}()` },
            targetCode: "present",
          },
    async (number) => block(Number(number))
  );

test("new getter fields start at observation, preserve distinct references, update mutable values, and retain state on failure", async () => {
  const ctx = context();
  const fields = [
    field("destination"),
    field("newDestination"),
    field("zero"),
    field("self"),
  ];
  await complete(ctx, 10, fields, {
    destination: target,
    newDestination: target,
    zero,
    self: subject,
  });
  const read = (getter) =>
    ctx.ContractRelationship.rows.get(relationshipId(1, subject, getter));
  assert.equal(read("destination").seed.number, "10");
  assert.equal(read("newDestination").status, "reference");
  assert.equal(read("zero").target, null);
  assert.equal(read("self").target, null);
  await complete(ctx, 11, fields, { destination: other });
  assert.equal(read("destination").target, other);
  assert.equal(read("destination").seed.number, "10");
  assert.equal(read("destination").provenance.number, "11");
  assert.equal(read("destination").lastChange, null);
  assert.equal(read("newDestination").target, target);
  assert.equal(read("newDestination").verification.outcome, "unavailable");
  assert.equal(
    read("newDestination").functionContext.signature,
    "newDestination()"
  );
  assert.equal(ctx.ControlTransition.rows.size, 0);
  const inventory = getRelationshipFields(1, 777);
  const cooler = inventory.find(
    (field) =>
      field.address === "0xdb591ea2e5db886da872654d58f6cc584b68e7cc" &&
      field.getter === "ltvOracle"
  );
  assert.equal(cooler.startBlock, 777);
  assert.match(cooler.coverage, /events/);
  assert.equal(
    inventory.filter(
      (field) =>
        field.address === "0xe045bd0a0d85e980aa152064c06eae6b6ae358d2" &&
        field.getter === "owner"
    ).length,
    1
  );
});

test("reference events are idempotent and rollback restores getter observations and removes orphan transitions", async () => {
  const ctx = context();
  const fields = [
    { ...field("ltvOracle"), coverage: "Source-verified change events" },
  ];
  await complete(ctx, 10, fields, { ltvOracle: target });
  const snapshot = structuredClone(ctx.ContractRelationship.rows);
  const event = {
    chainId: 1,
    srcAddress: subject,
    block: { number: 11, hash: block(11).hash, timestamp: 1700000011 },
    transaction: { hash: "0xtx" },
    logIndex: 0,
    params: { oracle: other },
  };
  await handleContractReference(ctx, event, "ltvOracle", other);
  await handleContractReference(ctx, event, "ltvOracle", other);
  assert.equal(ctx.ControlTransition.rows.size, 1);
  await complete(ctx, 11, fields, { ltvOracle: other });
  assert.equal(
    ctx.ContractRelationship.rows.get(relationshipId(1, subject, "ltvOracle"))
      .verification.outcome,
    "match"
  );
  // Model Envio restoring its stores; this assertion is helper-level rollback coverage.
  ctx.ContractRelationship.rows.clear();
  for (const [id, row] of snapshot) ctx.ContractRelationship.rows.set(id, row);
  ctx.ControlTransition.rows.clear();
  await complete(ctx, 12, fields, { ltvOracle: target });
  assert.equal(
    ctx.ContractRelationship.rows.get(relationshipId(1, subject, "ltvOracle"))
      .target,
    target
  );
  assert.equal(ctx.ControlTransition.rows.size, 0);
});

test("code-equivalent verification cannot establish original NatSpec", () => {
  const result = processAbiMetadata(
    [fn("destination")],
    {
      userdoc: {
        methods: {
          "destination()": { notice: "Unverified original comments" },
        },
      },
    },
    { ...source, match: "code" }
  );
  const context = Object.values(result.functionSelectors)[0].documentation;
  assert.equal(context.notice, undefined);
  assert.equal(context.source.match, "code");
  assert.equal(context.signature, "destination()");
});

test("a getter mismatch cannot attach another target's code evidence to an event-backed reference", async () => {
  const ctx = context();
  const fields = [
    { ...field("ltvOracle"), coverage: "Source-verified change events" },
  ];
  const id = relationshipId(1, subject, "ltvOracle");
  await complete(ctx, 10, fields, { ltvOracle: target });
  const checkpoint = (number, value) =>
    completeRelationshipBlock(
      ctx,
      1,
      block(number),
      fields,
      async () => ({ status: "success", value, targetCode: "absent" }),
      async (number) => block(Number(number))
    );
  await checkpoint(11, other);
  assert.equal(ctx.ContractRelationship.rows.get(id).target, target);
  assert.equal(
    ctx.ContractRelationship.rows.get(id).verification.outcome,
    "mismatch"
  );
  assert.equal(ctx.ContractRelationship.rows.get(id).targetCode, "present");
  await handleContractReference(
    ctx,
    {
      chainId: 1,
      srcAddress: subject,
      block: { number: 12, hash: block(12).hash, timestamp: 1700000012 },
      transaction: { hash: "0xtx12" },
      logIndex: 0,
    },
    "ltvOracle",
    other
  );
  await checkpoint(12, target);
  assert.equal(ctx.ContractRelationship.rows.get(id).target, other);
  assert.equal(
    ctx.ContractRelationship.rows.get(id).verification.outcome,
    "mismatch"
  );
  assert.equal(ctx.ContractRelationship.rows.get(id).targetCode, undefined);
});

test("cached policy metadata rechecks each observation before exposing documentation", async () => {
  const { getProcessedContract } = await import("../src/events/effects.ts");
  let metadataReads = 0;
  const codeReads = [];
  const ctx = {
    effect: async (effect, input) => {
      if (effect.name === "processContractMetadataV2") {
        metadataReads++;
        return structuredClone(getterMetadata);
      }
      if (effect.name === "readControlBlock")
        return input.blockNumber === 13n
          ? undefined
          : block(Number(input.blockNumber));
      assert.equal(effect.name, "readCanonicalCodeHash");
      assert.equal(input.blockHash, block(Number(input.blockNumber)).hash);
      codeReads.push(input.blockNumber);
      return input.blockNumber === 10n
        ? source.codeHash
        : input.blockNumber === 11n
          ? "0xdifferent"
          : undefined;
    },
  };
  const documentation = async (number) =>
    Object.values(
      (
        await getProcessedContract(
          ctx,
          1,
          "0x0000000000000000000000000000000000000004",
          "DocumentedPolicy",
          number
        )
      ).functionSelectors
    )[0].documentation;
  assert.equal((await documentation(10n)).notice, "The destination");
  for (const number of [11n, 12n, 13n])
    assert.equal(await documentation(number), undefined);
  assert.equal((await documentation(10n)).notice, "The destination");
  assert.equal(metadataReads, 1);
  assert.deepEqual(codeReads, [10n, 11n, 12n, 10n]);
});
