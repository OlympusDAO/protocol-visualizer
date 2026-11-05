import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import http from "node:http";
import { getKernelConstants } from "../src/constants.ts";
import { parsePolicyPermissions } from "../src/events/contractParsing.ts";
import { handleKernelActionExecuted } from "../src/events/kernel.ts";
import {
  getCoreContracts,
  seedCoreContracts,
} from "../src/events/kernel-history.ts";
import { processAbiMetadata } from "../src/services/contracts/abi.ts";

const hash = `0x${"ab".repeat(32)}`;
let server;
const previousRpc = process.env.ENVIO_RPC_URL_1;
before(async () => {
  server = http.createServer(async (req, res) => {
    let body = "";
    for await (const part of req) body += part;
    const reply = ({ id, method, params }) => {
      assert.equal(method, "eth_getBlockByNumber");
      return {
        jsonrpc: "2.0",
        id,
        result: {
          number: params[0],
          hash,
          timestamp: "0x100",
          transactions: [],
        },
      };
    };
    const input = JSON.parse(body);
    res.setHeader("content-type", "application/json");
    res.end(
      JSON.stringify(Array.isArray(input) ? input.map(reply) : reply(input))
    );
  });
  await new Promise((done) => server.listen(0, "127.0.0.1", done));
  process.env.ENVIO_RPC_URL_1 = `http://127.0.0.1:${server.address().port}`;
});
after(async () => {
  if (previousRpc === undefined) delete process.env.ENVIO_RPC_URL_1;
  else process.env.ENVIO_RPC_URL_1 = previousRpc;
  await new Promise((done) => server.close(done));
});

test("permission labels use canonical inputs rather than appending return types", async () => {
  const metadata = processAbiMetadata([
    {
      type: "function",
      name: "mintOhm",
      inputs: [{ type: "address" }, { type: "uint256" }],
      outputs: [],
      stateMutability: "nonpayable",
    },
  ]);
  const contract = getCoreContracts(1).find(
    (row) => row.name === "CCIPTokenPoolConfig"
  );
  const context = {
    CurrentModule: {
      get: async () => ({
        address: "0x00000000000000000000000000000000000000ab",
      }),
    },
    effect: async (_effect, input) =>
      input.policyAddress
        ? [
            {
              keycode: "0x4d494e5452",
              funcSelector: Object.keys(metadata.functionSelectors)[0],
            },
          ]
        : metadata,
  };
  const permissions = await parsePolicyPermissions(
    2,
    getKernelConstants(1).address,
    contract.address,
    contract.name,
    BigInt(contract.startBlock + 1),
    1,
    context,
    hash
  );
  assert.equal(permissions[0].function, "mintOhm(address,uint256)");
});

test("only completed creation coverage establishes never-installed; Kernel event history wins", async () => {
  const rows = new Map();
  const context = {
    Contract: {
      get: async (id) => rows.get(id),
      set: (row) => rows.set(row.id, row),
    },
  };
  const contract = getCoreContracts(1).find(
    (row) => row.name === "CCIPTokenPoolConfig"
  );
  assert.ok(contract?.startBlock);
  const block = {
    number: String(contract.startBlock),
    hash: "0xcanonical",
    timestamp: "1790000000",
  };
  const id = `1:${contract.address}`;
  await seedCoreContracts(context, 1, 0, block, [contract], async () => false);
  assert.equal(rows.size, 0, "no code means no deployed node");
  await seedCoreContracts(context, 1, 0, block, [contract], async () => true);
  assert.equal(rows.get(id).kernelHistory, "never-installed");
  rows.clear();
  await seedCoreContracts(
    context,
    1,
    contract.startBlock + 1,
    { ...block, number: String(contract.startBlock + 1) },
    [contract],
    async () => true
  );
  assert.equal(
    rows.get(id).kernelHistory,
    "unknown",
    "late coverage cannot prove never installed"
  );
  rows.set(id, {
    ...rows.get(id),
    kernelHistory: "installed",
    isEnabled: false,
  });
  await seedCoreContracts(context, 1, 0, block, [contract], async () => true);
  assert.equal(
    rows.get(id).kernelHistory,
    "installed",
    "removed contracts retain their event history"
  );
  rows.clear();
  await seedCoreContracts(
    context,
    1,
    0,
    block,
    [{ ...contract, startBlock: undefined }],
    async () => true
  );
  assert.equal(
    rows.get(id).kernelHistory,
    "unknown",
    "missing creation anchors remain unknown"
  );
});

test("activation and removal events retain prior installation independently of current activity", async () => {
  const store = () => {
    const rows = new Map();
    return {
      get: async (id) => rows.get(id),
      set: (row) => rows.set(row.id, row),
    };
  };
  const context = Object.fromEntries(["Contract"].map((key) => [key, store()]));
  context.effect = async (_effect, input) =>
    input.policyAddress ? [] : { roleToFunctions: {}, functionSelectors: {} };
  const kernel = getKernelConstants(1).address;
  context.Contract.set({ id: `1:${kernel.toLowerCase()}` });
  const contract = getCoreContracts(1).find(
    (row) => row.name === "CCIPTokenPoolConfig"
  );
  const block = {
    number: String(contract.startBlock),
    timestamp: "1790000000",
    hash: "0xcanonical",
  };
  await seedCoreContracts(context, 1, 0, block, [contract], async () => true);
  const id = `1:${contract.address}`;
  assert.equal(
    (await context.Contract.get(id)).kernelHistory,
    "never-installed"
  );
  for (const action of [2, 3, 2]) {
    await handleKernelActionExecuted(
      {
        chainId: 1,
        srcAddress: kernel,
        block: { number: contract.startBlock + 1, timestamp: 1790000001, hash },
        transaction: { hash: `0xtx${action}` },
        logIndex: action,
        params: { action_: action, target_: contract.address },
      },
      context
    );
    const row = await context.Contract.get(id);
    assert.equal(row.kernelHistory, "installed");
    assert.equal(row.isEnabled, action === 2);
  }
});
