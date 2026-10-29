// Uses real eRPC/Postgres images and a counted fixture upstream; no provider keys.
// Only uniquely named containers/networks created here are removed.
import assert from "node:assert/strict";
import { execFile, execFileSync } from "node:child_process";
import http from "node:http";
import { test } from "node:test";
import { promisify } from "node:util";
const runFile = promisify(execFile);

const ids = [1, 10, 42161, 8453, 80094, 4663, 11155111, 421614, 84532];
const keyFor = (value) =>
  JSON.stringify(value, (_key, v) =>
    v && typeof v === "object" && !Array.isArray(v)
      ? Object.fromEntries(
          Object.entries(v).sort(([a], [b]) => a.localeCompare(b))
        )
      : v
  );
const pgImage =
  "postgres:17-alpine@sha256:979c4379dd698aba0b890599a6104e082035f98ef31d9b9291ec22f2b13059ca";
const image = "protocol-visualizer/rpc-cache:local";
const docker = (...args) =>
  execFileSync("docker", args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 120_000,
  }).trim();
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function eventually(check, message) {
  for (let i = 0; i < 100; i++) {
    try {
      if (await check()) return;
    } catch {}
    await wait(200);
  }
  throw new Error(message);
}

// Kept outside tests/*.test.mjs so regular builds do not require Docker.
test("pinned eRPC read-through persistence, finality, isolation and safe errors", {
  timeout: 180_000,
}, async () => {
  const prefix = `pv-rpc-test-${process.pid}-${Date.now()}`;
  const counts = new Map();
  let unknownFinality = true;
  const upstream = http.createServer(async (req, res) => {
    let raw = "";
    for await (const chunk of req) raw += chunk;
    if (req.url.startsWith("/hasura/")) {
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ message: "success" }));
      return;
    }
    const chainId = Number(req.url.split("/")[1]);
    const respond = (rpc) => {
      const key = keyFor([chainId, rpc.method, rpc.params]);
      counts.set(key, (counts.get(key) || 0) + 1);
      const params = rpc.params || [];
      if (rpc.method === "eth_call" && params[0]?.data === "0xdddd")
        return null;
      let result;
      let error;
      switch (rpc.method) {
        case "eth_chainId":
          result = `0x${chainId.toString(16)}`;
          break;
        case "eth_syncing":
          result = false;
          break;
        case "eth_blockNumber":
          result = "0x100000";
          break;
        case "eth_getBlockByNumber": {
          if (params[0] === "finalized" && chainId === 10 && unknownFinality) {
            error = { code: -32602, message: "finalized not supported" };
            break;
          }
          const number = ["latest", "pending"].includes(params[0])
            ? "0x100000"
            : params[0] === "finalized"
              ? "0x80000"
              : params[0];
          result = {
            number,
            hash: `0x${"ab".repeat(32)}`,
            parentHash: `0x${"cd".repeat(32)}`,
            timestamp: "0x65000000",
            transactions: [],
            uncles: [],
            receiptsRoot: `0x${"ef".repeat(32)}`,
          };
          break;
        }
        case "eth_call":
          if (params[0]?.data === "0xaaaa")
            error = {
              code: -32000,
              message:
                "required historical state is not available fixture-url-secret",
            };
          else if (params[0]?.data === "0xeeee")
            error = {
              code: -32000,
              message: "fixture-url-secret fixture-query-secret",
              data: { url: "fixture-url-secret", key: "fixture-query-secret" },
            };
          else result = params[0]?.data === "0x0000" ? "0x" : "0x1234";
          break;
        case "eth_estimateGas":
          error = {
            code: 3,
            message: "execution reverted fixture-url-secret",
            data: "0x08c379a0",
          };
          break;
        case "eth_getCode":
          result = "0x";
          break;
        case "eth_getLogs":
          result = [];
          break;
        case "eth_getBalance":
          result = "0x0";
          break;
        case "eth_getTransactionReceipt":
          result = null;
          break;
        default:
          error = { code: -32601, message: "fixture method unsupported" };
      }
      return {
        jsonrpc: "2.0",
        id: rpc.id,
        ...(error ? { error } : { result }),
      };
    };
    const data = JSON.parse(raw);
    const response = Array.isArray(data) ? data.map(respond) : respond(data);
    if (response === null) {
      req.socket.destroy();
      return;
    }
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify(response));
  });
  await new Promise((resolve) => upstream.listen(0, "0.0.0.0", resolve));
  const port = upstream.address().port;
  const pg = `${prefix}-cache-db`;
  const erpc = `${prefix}-erpc`;
  const envioPg = `${prefix}-envio-db`;
  const created = [];
  try {
    docker("network", "create", prefix);
    for (const name of [pg, envioPg]) {
      docker(
        "run",
        "-d",
        "--name",
        name,
        "--network",
        prefix,
        "--tmpfs",
        "/var/lib/postgresql/data",
        "-e",
        "POSTGRES_PASSWORD=fixture",
        pgImage
      );
      created.push(name);
      await eventually(() => {
        docker("exec", name, "pg_isready", "-U", "postgres");
        return true;
      }, "Postgres did not start");
    }
    const env = [
      "-e",
      `RPC_CACHE_DATABASE_URL=postgresql://postgres:fixture@${pg}:5432/postgres`,
      "-e",
      "RPC_CACHE_MAX_RPS=1000",
    ];
    for (const id of ids)
      env.push(
        "-e",
        `UPSTREAM_RPC_URL_${id}=http://host.docker.internal:${port}/${id}/fixture-url-secret?key=fixture-query-secret`
      );
    docker(
      "run",
      "-d",
      "--name",
      erpc,
      "--network",
      prefix,
      "--add-host",
      "host.docker.internal:host-gateway",
      "-p",
      "127.0.0.1::4000",
      ...env,
      image
    );
    created.push(erpc);
    const hostPort = docker("port", erpc, "4000/tcp").split(":").at(-1);
    let base = `http://127.0.0.1:${hostPort}`;
    const health = () => fetch(`${base}/healthcheck`).then((r) => r.ok);
    await eventually(
      health,
      "eRPC did not start; inspect only this test container"
    );
    let requestId = 0;
    const rpc = async (chainId, method, params) => {
      const response = await fetch(`${base}/pv/evm/${chainId}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: ++requestId,
          method,
          params,
        }),
      });
      const text = await response.text();
      assert(
        !text.includes("fixture-url-secret") &&
          !text.includes("fixture-query-secret"),
        "upstream URL leaked to client"
      );
      return {
        body: JSON.parse(text),
        cached: response.headers.get("x-erpc-cache"),
      };
    };
    const count = (id, method, params) =>
      counts.get(keyFor([id, method, params])) || 0;
    // Let each network discover its genuine finalized head before historical reads.
    await eventually(
      () =>
        ids
          .filter((id) => id !== 10)
          .every(
            (id) => count(id, "eth_getBlockByNumber", ["finalized", false]) > 0
          ),
      "finality pollers did not run for all chains"
    );
    await wait(500);
    const call = [{ to: `0x${"11".repeat(20)}`, data: "0x1234" }, "0x100"];
    const cachedPair = async (id, method, params) => {
      const before = count(id, method, params);
      const first = await rpc(id, method, params);
      assert.equal(first.body.error, undefined, JSON.stringify(first.body));
      assert.equal(
        count(id, method, params),
        before + 1,
        "first read must reach upstream"
      );
      await eventually(
        async () => (await rpc(id, method, params)).cached === "HIT",
        "result was not persisted/cached"
      );
      assert.equal(
        count(id, method, params),
        before + 1,
        "repeat read must avoid upstream"
      );
      return first.body.result;
    };
    for (const id of ids.filter((id) => id !== 10))
      await cachedPair(id, "eth_call", call);
    await cachedPair(1, "eth_call", [call[0], "0x101"]);
    await cachedPair(1, "eth_call", [{ ...call[0], data: "0x1235" }, "0x100"]);
    await cachedPair(1, "eth_call", [{ ...call[0], data: "0x0000" }, "0x100"]);
    await cachedPair(1, "eth_getCode", [call[0].to, "0x100"]);
    await cachedPair(1, "eth_getBalance", [call[0].to, "0x100"]);
    const logs = [
      { fromBlock: "0x100", toBlock: "0x102", address: call[0].to, topics: [] },
    ];
    assert.deepEqual(await cachedPair(1, "eth_getLogs", logs), []);
    await cachedPair(1, "eth_getLogs", [{ ...logs[0], toBlock: "0x103" }]);
    const bypassPair = async (id, method, params, expectError = false) => {
      const before = count(id, method, params);
      for (let i = 0; i < 2; i++) {
        const result = await rpc(id, method, params);
        assert.notEqual(result.cached, "HIT");
        assert.equal(
          Boolean(result.body.error),
          expectError,
          JSON.stringify(result.body)
        );
      }
      assert(
        count(id, method, params) >= before + 2,
        "bypassed reads must reach upstream"
      );
    };
    for (const tag of ["latest", "pending", "finalized", "safe", "0x90000"])
      await bypassPair(1, "eth_call", [call[0], tag]);
    await bypassPair(10, "eth_call", call);
    await bypassPair(1, "eth_getLogs", [
      { ...logs[0], fromBlock: "0xffff0", toBlock: "latest" },
    ]);
    await bypassPair(1, "eth_getLogs", [
      { ...logs[0], fromBlock: "0x7fff0", toBlock: "0x80010" },
    ]);
    for (const toBlock of ["pending", "safe", undefined]) {
      const filter = { fromBlock: "0x100", address: call[0].to };
      if (toBlock) filter.toBlock = toBlock;
      await bypassPair(1, "eth_getLogs", [filter]);
    }
    await bypassPair(
      1,
      "eth_call",
      [{ ...call[0], data: "0xeeee" }, "0x100"],
      true
    );
    await bypassPair(
      1,
      "eth_call",
      [{ ...call[0], data: "0xdddd" }, "0x100"],
      true
    );
    const historicalError = await rpc(1, "eth_call", [
      { ...call[0], data: "0xaaaa" },
      "0x100",
    ]);
    assert.equal(
      historicalError.body.error.message,
      "historical state is not available"
    );
    const revert = await rpc(1, "eth_estimateGas", [call[0], "0x100"]);
    assert.equal(revert.body.error.data, "0x08c379a0");
    assert.equal(revert.body.error.message, "RPC request failed");
    await bypassPair(1, "eth_getTransactionReceipt", [`0x${"99".repeat(32)}`]);
    unknownFinality = false;
    docker("restart", erpc);
    base = `http://127.0.0.1:${docker("port", erpc, "4000/tcp").split(":").at(-1)}`;
    await eventually(health, "eRPC restart failed");
    await wait(500);
    const afterRestart = count(1, "eth_call", call);
    await eventually(
      async () => (await rpc(1, "eth_call", call)).cached === "HIT",
      "cache did not survive restart"
    );
    assert.equal(count(1, "eth_call", call), afterRestart);
    await cachedPair(1, "eth_call", [call[0], "0x105"]);
    await eventually(
      () => count(10, "eth_getBlockByNumber", ["finalized", false]) > 1,
      "finality recovery did not poll"
    );
    await wait(500);
    await cachedPair(10, "eth_call", call);
    assert.equal(
      docker(
        "exec",
        pg,
        "psql",
        "-U",
        "postgres",
        "-Atc",
        "SELECT count(*) FROM rpc_cache WHERE expires_at IS NOT NULL"
      ),
      "0"
    );
    const expiry = docker(
      "exec",
      pg,
      "psql",
      "-U",
      "postgres",
      "-Atc",
      "SELECT count(*) FROM rpc_cache"
    );
    assert(Number(expiry) > 0);
    console.log(
      `Fixture verified ${expiry} persisted cache rows across restart; no live providers used.`
    );
    // The reset command must run in the actual distroless deployed image, with
    // its real config and a separate disposable Envio DB. No indexer is running.
    const indexerEnv = [
      "-e",
      `DATABASE_URL=postgresql://postgres:fixture@${envioPg}:5432/postgres`,
      "-e",
      "ETHERSCAN_API_KEY=fixture",
      "-e",
      `HASURA_GRAPHQL_ENDPOINT=http://host.docker.internal:${port}/hasura/v1/metadata`,
      "-e",
      "HASURA_GRAPHQL_ADMIN_SECRET=fixture",
    ];
    for (const id of ids)
      indexerEnv.push(
        "-e",
        `ENVIO_RPC_URL_${id}=http://${erpc}:4000/pv/evm/${id}`
      );
    const reset = () =>
      runFile(
        "docker",
        [
          "run",
          "--rm",
          "--network",
          prefix,
          "--add-host",
          "host.docker.internal:host-gateway",
          ...indexerEnv,
          "protocol-visualizer/indexer:local",
          "scripts/start-envio.mjs",
          "local",
          "db-migrate",
          "setup",
        ],
        { encoding: "utf8", timeout: 120_000 }
      );
    await reset();
    docker(
      "exec",
      envioPg,
      "psql",
      "-U",
      "postgres",
      "-v",
      "ON_ERROR_STOP=1",
      "-c",
      "CREATE TABLE public.rpc_cache_reset_canary (id integer PRIMARY KEY); INSERT INTO public.rpc_cache_reset_canary VALUES (1)"
    );
    await reset();
    assert.equal(
      docker(
        "exec",
        envioPg,
        "psql",
        "-U",
        "postgres",
        "-Atc",
        "SELECT to_regclass('public.rpc_cache_reset_canary') IS NULL"
      ),
      "t",
      "Envio setup did not reset its own schema"
    );
    assert.equal(
      docker(
        "exec",
        pg,
        "psql",
        "-U",
        "postgres",
        "-Atc",
        "SELECT count(*) FROM rpc_cache"
      ),
      expiry,
      "Envio reset touched cache storage"
    );
    assert.equal((await rpc(1, "eth_call", call)).cached, "HIT");
    const output = docker("logs", erpc);
    assert(
      !output.includes("fixture-url-secret") &&
        !output.includes("fixture-query-secret"),
      "upstream URL leaked to logs"
    );
    console.log(
      "Distroless Envio setup/reset ran twice with the deployed config; eRPC rows and hits survived."
    );
  } catch (error) {
    // Do not print arbitrary runtime logs or environment (may contain URLs).
    if (error.stderr)
      throw new Error(
        `Docker command failed: ${String(error.stderr).slice(-1500)}`
      );
    throw error;
  } finally {
    for (const name of created.reverse()) docker("rm", "-f", name);
    try {
      docker("network", "rm", prefix);
    } catch {}
    await new Promise((resolve) => upstream.close(resolve));
  }
});
