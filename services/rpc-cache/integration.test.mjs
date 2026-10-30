// Uses real eRPC/Postgres images and a counted fixture upstream; no provider keys.
// Only uniquely named containers/networks created here are removed.
import assert from "node:assert/strict";
import { execFile, execFileSync } from "node:child_process";
import http from "node:http";
import { createRequire } from "node:module";
import "../../apps/indexer/scripts/register-typescript.mjs";
import { test } from "node:test";
import { promisify } from "node:util";
const runFile = promisify(execFile);
const requireIndexer = createRequire(
  new URL("../../apps/indexer/package.json", import.meta.url)
);
const { toFunctionSelector } = requireIndexer("viem");
const { readPinnedModuleDependencies } = await import(
  "../../apps/indexer/src/events/module-dependencies.ts"
);
const { getPublicClient } = await import(
  "../../apps/indexer/src/events/rpc.ts"
);
// biome-ignore lint/suspicious/noUndeclaredEnvVars: this Docker integration runs outside Turbo.
const skipReset = process.env.RPC_CACHE_TEST_SKIP_RESET === "1";
const moduleSelector = toFunctionSelector("getModuleForKeycode(bytes5)");
const dependentsSelector = toFunctionSelector(
  "moduleDependents(bytes5,uint256)"
);
const moduleAddress = `0x${"22".repeat(20)}`;
const dependentAddress = `0x${"33".repeat(20)}`;
const encodedAddress = (address) => `0x${address.slice(2).padStart(64, "0")}`;
const panic = (code) =>
  `0x4e487b71${BigInt(code).toString(16).padStart(64, "0")}`;
const dependencyCases = [
  {
    name: "bare revert code 3",
    error: { code: 3, message: "execution reverted" },
    success: true,
  },
  {
    name: "bare revert code -32000",
    error: { code: -32000, message: "execution reverted" },
    success: true,
  },
  {
    name: "Panic bounds",
    error: { code: 3, message: "execution reverted", data: panic(0x32) },
    success: true,
  },
  {
    name: "reasoned revert",
    error: { code: 3, message: "execution reverted: fixture-url-secret" },
  },
  {
    name: "other execution failure",
    error: { code: 3, message: "out of gas fixture-query-secret" },
  },
  {
    name: "other panic",
    error: { code: 3, message: "execution reverted", data: panic(0x11) },
  },
  {
    name: "custom error",
    error: { code: 3, message: "execution reverted", data: "0x12345678" },
  },
  {
    name: "generic RPC failure",
    error: { code: -32000, message: "fixture-url-secret" },
  },
  { name: "transport failure", disconnect: true },
].map((entry, index) => ({
  ...entry,
  kernel: `0x${(0xc0 + index).toString(16).padStart(40, "0")}`,
}));

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
  timeout: 240_000,
}, async () => {
  const prefix = `pv-rpc-test-${process.pid}-${Date.now()}`;
  const counts = new Map();
  const admissions = [];
  let recoveryFailures = 1;
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
      admissions.push({
        second: Math.floor(Date.now() / 1000),
        chainId,
        method: rpc.method,
      });
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
        case "eth_call": {
          const fixture = dependencyCases.find(
            (entry) => entry.kernel === params[0]?.to?.toLowerCase()
          );
          if (fixture && params[0].data.startsWith(moduleSelector)) {
            result = encodedAddress(moduleAddress);
            break;
          }
          if (fixture && params[0].data.startsWith(dependentsSelector)) {
            if (BigInt(`0x${params[0].data.slice(-64)}`) === 0n)
              result = encodedAddress(dependentAddress);
            else if (fixture.disconnect) return null;
            else error = fixture.error;
            break;
          }
          if (params[0]?.data === "0xcafe" && recoveryFailures-- > 0) {
            error = { code: -32005, message: "rate limit fixture-url-secret" };
            break;
          }
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
        }
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
        case "eth_getStorageAt":
          result = `0x${"00".repeat(32)}`;
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
    if (
      response === null ||
      (Array.isArray(response) && response.includes(null))
    ) {
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
    for (const name of skipReset ? [pg] : [pg, envioPg]) {
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
    const cacheRows = (id, method) =>
      Number(
        docker(
          "exec",
          pg,
          "psql",
          "-U",
          "postgres",
          "-Atc",
          `SELECT count(*) FROM rpc_cache WHERE partition_key LIKE 'evm:${id}:%' AND range_key LIKE '${method}:%'`
        )
      );
    await eventually(
      () =>
        docker(
          "exec",
          pg,
          "psql",
          "-U",
          "postgres",
          "-Atc",
          "SELECT to_regclass('public.rpc_cache') IS NOT NULL"
        ) === "t",
      "eRPC PostgreSQL cache schema was not initialized"
    );
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
      const persistedBefore = cacheRows(id, method);
      const first = await rpc(id, method, params);
      assert.equal(first.body.error, undefined, JSON.stringify(first.body));
      assert.equal(
        count(id, method, params),
        before + 1,
        "first read must reach upstream"
      );
      // Cache writes run asynchronously. Observe their PostgreSQL completion
      // without issuing duplicate RPCs that could hide a broken first write.
      await eventually(
        () => cacheRows(id, method) > persistedBefore,
        `first response did not persist (${id}:${method})`
      );
      assert.equal((await rpc(id, method, params)).cached, "HIT");
      assert.equal(
        count(id, method, params),
        before + 1,
        `repeat read must avoid upstream (${id}:${method})`
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
    const productionChain = 999971;
    process.env[`ENVIO_RPC_URL_${productionChain}`] = `${base}/pv/evm/1`;
    const production = getPublicClient(productionChain);
    const probeStart = Date.now();
    for (const fixture of dependencyCases) {
      let result;
      try {
        result = await readPinnedModuleDependencies(production, {
          kernel: fixture.kernel,
          keycode: "MINTR",
          blockNumber: 256n,
          blockHash: `0x${"ab".repeat(32)}`,
        });
      } catch (error) {
        assert.equal(fixture.success, undefined, fixture.name);
        assert.match(
          error.message,
          /Indexer RPC temporarily unavailable/,
          fixture.name
        );
        result = { status: "unavailable" };
      }
      assert.equal(
        result.status,
        fixture.success ? "success" : "unavailable",
        fixture.name
      );
      if (fixture.success)
        assert.deepEqual(result.policies, [dependentAddress], fixture.name);
    }
    const recoveryParams = [{ ...call[0], data: "0xcafe" }, "0x106"];
    const recoveryCount = count(1, "eth_call", recoveryParams);
    assert.equal(
      await production.request({ method: "eth_call", params: recoveryParams }),
      "0x1234"
    );
    assert.equal(
      count(1, "eth_call", recoveryParams),
      recoveryCount + 2,
      "capacity recovery must retry through the proxy"
    );
    console.log(
      `Production dependency reader passed ${dependencyCases.length} proxy/viem cases and capacity recovery in ${Date.now() - probeStart} ms.`
    );

    // Stop the unlimited test instance so all counted admissions below belong
    // to one finite aggregate budget, including its background pollers/retries.
    docker("stop", erpc);
    const limited = `${prefix}-limited`;
    const budget = 20;
    docker(
      "run",
      "-d",
      "--name",
      limited,
      "--network",
      prefix,
      "--add-host",
      "host.docker.internal:host-gateway",
      "-p",
      "127.0.0.1::4000",
      ...env.map((value) =>
        value === "RPC_CACHE_MAX_RPS=1000"
          ? `RPC_CACHE_MAX_RPS=${budget}`
          : value
      ),
      image
    );
    created.push(limited);
    const originalBase = base;
    base = `http://127.0.0.1:${docker("port", limited, "4000/tcp").split(":").at(-1)}`;
    await eventually(health, "limited eRPC did not start");
    await wait(2500);
    await eventually(
      async () => (await rpc(1, "eth_call", call)).cached === "HIT",
      "limited proxy cannot read persisted cache"
    );
    await wait(1100 - (Date.now() % 1000));
    const admissionStart = admissions.length;
    const burstStart = Date.now();
    const burst = Array.from({ length: 160 }, (_, i) => {
      const address = `0x${(10000 + i).toString(16).padStart(40, "0")}`;
      const chain = [1, 8453, 42161][i % 3];
      const method = [
        "eth_call",
        "eth_getCode",
        "eth_getBalance",
        "eth_getStorageAt",
      ][i % 4];
      const params =
        method === "eth_call"
          ? [{ to: address, data: "0x1234" }, "0x200"]
          : method === "eth_getStorageAt"
            ? [address, "0x0", "0x200"]
            : [address, "0x200"];
      return rpc(chain, method, params);
    });
    await eventually(
      () => admissions.length - admissionStart >= budget,
      "burst did not saturate aggregate budget"
    );
    const hitBefore = count(1, "eth_call", call);
    assert.equal(
      (await rpc(1, "eth_call", call)).cached,
      "HIT",
      "cache hits must precede upstream budgeting"
    );
    assert.equal(count(1, "eth_call", call), hitBefore);
    const burstResults = await Promise.all(burst);
    const perSecond = {};
    for (const admission of admissions.slice(admissionStart))
      perSecond[admission.second] = (perSecond[admission.second] ?? 0) + 1;
    assert(
      Object.values(perSecond).every((total) => total <= budget),
      JSON.stringify({ budget, perSecond })
    );
    assert(
      burstResults.some((result) => result.body.error),
      "overload should return finite capacity errors, not an unbounded queue"
    );
    assert(
      new Set(admissions.slice(admissionStart).map((a) => a.method)).size > 1
    );
    assert(
      new Set(admissions.slice(admissionStart).map((a) => a.chainId)).size > 1
    );
    await wait(1100);
    const recovered = await rpc(1, "eth_getBalance", [
      `0x${"fa".repeat(20)}`,
      "0x201",
    ]);
    assert.equal(
      recovered.body.error,
      undefined,
      "budget must recover in later windows"
    );
    const limitedLogs = docker("logs", limited);
    assert(
      !limitedLogs.includes("fixture-url-secret") &&
        !limitedLogs.includes("fixture-query-secret")
    );
    console.log(
      `Aggregate mixed-method/chain fixture: ${JSON.stringify({ budget, perSecond, requests: burst.length, capacityErrors: burstResults.filter((result) => result.body.error).length, durationMs: Date.now() - burstStart })}`
    );
    // Legacy reset checks (when enabled) use the original service name.
    base = originalBase;
    if (!skipReset) {
      docker("start", erpc);
      await eventually(health, "original eRPC did not resume");
    }
    if (!skipReset) {
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
    } else
      console.log(
        "Envio reset checks explicitly skipped; no database reset executed."
      );
    const output = docker("logs", erpc);
    assert(
      !output.includes("fixture-url-secret") &&
        !output.includes("fixture-query-secret"),
      "upstream URL leaked to logs"
    );
    if (!skipReset)
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
