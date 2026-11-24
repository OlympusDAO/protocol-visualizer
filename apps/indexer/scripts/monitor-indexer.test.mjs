import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:http";
import { performance } from "node:perf_hooks";
import { test } from "node:test";
import { setTimeout } from "node:timers/promises";
import { fileURLToPath } from "node:url";

const entrypoint = fileURLToPath(
  new URL("../src/monitor-indexer.mjs", import.meta.url)
);

async function listen(t, handler) {
  const server = createServer(handler);
  t.after(async () => {
    if (!server.listening) return;
    const closed = once(server, "close");
    server.close();
    server.closeAllConnections();
    await closed;
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  return `http://127.0.0.1:${server.address().port}`;
}

function start(t, env) {
  const child = spawn(process.execPath, [entrypoint], {
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8").on("data", (chunk) => {
    stdout += chunk;
  });
  child.stderr.setEncoding("utf8").on("data", (chunk) => {
    stderr += chunk;
  });
  const closed = once(child, "close").then(([code, signal]) => ({
    code,
    signal,
    stdout,
    stderr,
  }));
  t.after(async () => {
    child.kill("SIGKILL");
    await closed;
  });
  async function result() {
    const timeout = new AbortController();
    try {
      return await Promise.race([
        closed,
        setTimeout(4_000, null, { signal: timeout.signal }).then(() => {
          assert.fail("monitor did not exit");
        }),
      ]);
    } finally {
      timeout.abort();
    }
  }
  return { child, result };
}

async function until(condition, description, timeout = 3_000) {
  const deadline = performance.now() + timeout;
  while (!condition()) {
    assert(performance.now() < deadline, description);
    await setTimeout(20);
  }
}

async function endpoints(
  t,
  metrics,
  deliver = (_request, response) => response.writeHead(204).end()
) {
  const probes = [];
  const messages = [];
  const metricsHost = await listen(t, (request, response) => {
    if (request.url === "/ready") {
      response.writeHead(503).end("catching up");
      return;
    }
    probes.push({
      path: request.url,
      method: request.method,
      time: performance.now(),
      messages: messages.length,
    });
    metrics(response, probes.length);
  });
  const webhookHost = await listen(t, (request, response) => {
    const body = [];
    request.setEncoding("utf8").on("data", (chunk) => body.push(chunk));
    request.on("end", () => {
      messages.push({
        method: request.method,
        type: request.headers["content-type"],
        path: request.url,
        body: body.join(""),
      });
      deliver(request, response);
    });
  });
  return {
    metricsHost,
    probes,
    messages,
    env: {
      INDEXER_METRICS_URL: `${metricsHost}/metrics`,
      DISCORD_WEBHOOK_URL: `${webhookHost}/webhook?secret=fixture`,
      MONITOR_INTERVAL_SECONDS: "1",
    },
  };
}

test("invalid or missing configuration exits before any HTTP requests", async (t) => {
  const fixture = await endpoints(t, (response) =>
    response.writeHead(200).end()
  );
  for (const override of [
    { INDEXER_METRICS_URL: undefined },
    { DISCORD_WEBHOOK_URL: "" },
    { DISCORD_WEBHOOK_URL: "file:///fixture-secret" },
    { INDEXER_METRICS_URL: "not a URL with a fixture-secret" },
    { MONITOR_INTERVAL_SECONDS: "0" },
    { MONITOR_INTERVAL_SECONDS: "1.5" },
    { MONITOR_INTERVAL_SECONDS: "2147484" },
  ]) {
    const { result } = start(t, { ...fixture.env, ...override });
    assert.deepEqual(await result(), {
      code: 1,
      signal: null,
      stdout: "",
      stderr: "Invalid indexer monitor configuration.\n",
    });
  }
  assert.deepEqual(fixture.probes, []);
  assert.deepEqual(fixture.messages, []);
});

test("CLI alerts on the second consecutive failure and recovers once during backfill", async (t) => {
  const status = [200, "disconnect", 200, 500, 503, 429, 200, 204, 200];
  const fixture = await endpoints(t, (response, n) => {
    const next = status[n - 1] ?? 200;
    if (next === "disconnect") {
      response.destroy();
      return;
    }
    response.writeHead(next).end("hyperindex_synced_to_head 0\n");
  });
  const ready = await fetch(`${fixture.metricsHost}/ready`);
  assert.equal(ready.status, 503);
  await ready.body.cancel();

  const { child, result } = start(t, {
    ...fixture.env,
    MONITOR_NAME: "Visualizer preview",
  });
  await until(
    () => fixture.probes.length >= status.length,
    "monitor did not finish the probe sequence",
    13_000
  );
  child.kill("SIGTERM");
  assert.deepEqual(await result(), {
    code: 0,
    signal: null,
    stdout: "",
    stderr: "",
  });

  assert.deepEqual(
    fixture.probes.map(({ path, method }) => [path, method]),
    status.map(() => ["/metrics", "GET"])
  );
  assert.deepEqual(
    fixture.probes.map((probe) => probe.messages),
    [0, 0, 0, 0, 0, 1, 1, 2, 2]
  );
  assert.deepEqual(
    fixture.messages.map(({ method, type, path, body }) => [
      method,
      type,
      path,
      JSON.parse(body),
    ]),
    [
      [
        "POST",
        "application/json",
        "/webhook?secret=fixture",
        { content: "Visualizer preview: metrics are unreachable." },
      ],
      [
        "POST",
        "application/json",
        "/webhook?secret=fixture",
        { content: "Visualizer preview: metrics are reachable again." },
      ],
    ]
  );
});

test("a hung webhook delivery times out and retries without stopping the monitor", async (t) => {
  let disconnected = false;
  let deliveryStarted;
  const fixture = await endpoints(
    t,
    (response) => response.writeHead(503).end(),
    (_request, response) => {
      if (fixture.messages.length === 1) {
        deliveryStarted = performance.now();
        response.on("close", () => {
          disconnected = true;
        });
      } else response.writeHead(204).end();
    }
  );
  const { child, result } = start(t, fixture.env);
  await until(
    () => fixture.messages.length === 1,
    "monitor did not attempt webhook delivery"
  );
  await until(
    () => disconnected,
    "monitor did not close the hung webhook connection",
    7_000
  );
  await until(
    () => fixture.messages.length === 2,
    "monitor did not retry webhook delivery"
  );
  assert(performance.now() - deliveryStarted >= 5_500);
  child.kill("SIGTERM");
  assert.deepEqual(await result(), {
    code: 0,
    signal: null,
    stdout: "",
    stderr: "Indexer monitor webhook delivery failed.\n",
  });
  assert.equal(fixture.probes.length, 3);
  assert.deepEqual(
    fixture.messages.map(({ body }) => JSON.parse(body)),
    [
      { content: "Indexer: metrics are unreachable." },
      { content: "Indexer: metrics are unreachable." },
    ]
  );
});

test("failed webhook deliveries retry without stopping probes or duplicating delivered alerts", async (t) => {
  const fixture = await endpoints(
    t,
    (response, n) => response.writeHead(n < 5 || n === 6 ? 503 : 200).end(),
    (_request, response) =>
      response
        .writeHead([1, 3].includes(fixture.messages.length) ? 429 : 204)
        .end("fixture-secret response body")
  );
  const { child, result } = start(t, fixture.env);
  await until(
    () => fixture.probes.length >= 8,
    "monitor did not continue after failed delivery",
    11_000
  );
  child.kill("SIGTERM");
  assert.deepEqual(await result(), {
    code: 0,
    signal: null,
    stdout: "",
    stderr: "Indexer monitor webhook delivery failed.\n".repeat(2),
  });
  assert.deepEqual(
    fixture.probes.map((probe) => probe.messages),
    [0, 0, 1, 2, 2, 3, 3, 4]
  );
  assert.deepEqual(
    fixture.messages.map(({ body }) => JSON.parse(body)),
    ["unreachable", "unreachable", "reachable again", "reachable again"].map(
      (status) => ({
        content: `Indexer: metrics are ${status}.`,
      })
    )
  );
});

test("a hung probe times out and SIGINT aborts the next probe cleanly", async (t) => {
  let disconnected = 0;
  const fixture = await endpoints(t, (response) => {
    response.on("close", () => {
      disconnected++;
    });
  });
  const { child, result } = start(t, fixture.env);
  await until(
    () => fixture.probes.length === 2,
    "monitor did not retry the hung probe",
    9_000
  );
  const elapsed = fixture.probes[1].time - fixture.probes[0].time;
  assert(elapsed >= 5_500 && elapsed < 8_000, `retry took ${elapsed} ms`);
  assert.equal(disconnected, 1);

  child.kill("SIGINT");
  assert.deepEqual(await result(), {
    code: 0,
    signal: null,
    stdout: "",
    stderr: "",
  });
  await until(
    () => disconnected === 2,
    "shutdown did not close the probe connection"
  );
  assert.deepEqual(fixture.messages, []);
});
