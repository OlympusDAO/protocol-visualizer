import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  ACTIVE_MANIFEST_KEY,
  SCHEMA_VERSION,
  type SnapshotManifest,
} from "@protocol-visualizer/snapshot-artifacts";
import {
  evaluateMonitor,
  fetchIndexerMetricsReadiness,
  loadConfiguredChains,
  runMonitor,
  runMonitorFromEnv,
  sendDiscordMessage,
  shortId,
} from "../src/monitor.js";

const mainnet = {
  key: "Mainnet",
  chainId: 1,
  name: "Ethereum Mainnet",
  environment: "production" as const,
};
const configuredChains: Parameters<typeof evaluateMonitor>[0]["chains"] =
  JSON.parse(
    readFileSync(
      new URL(
        "../../../../packages/protocol-config/protocol-chains.json",
        import.meta.url
      ),
      "utf8"
    )
  );

const manifest = (
  generatedAt: string,
  overrides: Partial<SnapshotManifest> = {}
): SnapshotManifest => ({
  schemaVersion: SCHEMA_VERSION,
  generatedAt,
  schemas: {
    openapi: "/v1/openapi.json",
    manifest: "/v1/manifest",
    protocolSnapshot: "/v1/chains/{chainId}/protocol",
  },
  indexingProgress: {
    chains: {
      Mainnet: {
        chainId: 1,
        date: "2026-06-05",
        timestamp: 1780272000,
        block: 123,
      },
    },
  },
  chains: [],
  ...overrides,
});

test("catalog validation identifies invalid chains without echoing invalid values", async () => {
  const directory = await mkdtemp(join(tmpdir(), "monitor-chains-"));
  const configPath = join(directory, "chains.json");
  const previous = process.env.PROTOCOL_CHAINS_CONFIG_PATH;
  try {
    await writeFile(
      configPath,
      JSON.stringify([
        { ...mainnet, environment: "invalid-environment" },
        { ...mainnet, key: "Optimism", chainId: 10, environment: null },
      ])
    );
    process.env.PROTOCOL_CHAINS_CONFIG_PATH = configPath;
    await assert.rejects(loadConfiguredChains, {
      message:
        "Each indexed chain must specify environment: production or testnet. Invalid chains: Mainnet (1), Optimism (10)",
    });
  } finally {
    if (previous === undefined) delete process.env.PROTOCOL_CHAINS_CONFIG_PATH;
    else process.env.PROTOCOL_CHAINS_CONFIG_PATH = previous;
    await rm(directory, { recursive: true, force: true });
  }
});

test("shortens deployment ids for Discord output", () => {
  assert.equal(shortId("1234567890abcdef"), "1234567890ab");
});

test("sends one daily indexing summary", () => {
  const result = evaluateMonitor({
    chains: [mainnet],
    environmentName: "protocol-visualizer-pr-49",
    deploymentId: "deployment-a",
    manifest: manifest("2026-06-05T00:00:00.000Z", {
      indexerDeploymentId: "deployment-active",
    }),
    state: {},
    now: new Date("2026-06-05T01:00:00.000Z"),
    staleThresholdMs: Number.MAX_SAFE_INTEGER,
  });
  assert.equal(result.messages.length, 1);
  assert.match(
    result.messages[0] ?? "",
    /Ethereum Mainnet: Status: Readiness unavailable/
  );
  assert.equal(result.discordMessages.length, 1);
  assert.equal(
    result.discordMessages[0]?.content,
    "Protocol visualizer indexing summary — Production chains"
  );
  assert.equal(
    result.discordMessages[0]?.embeds?.[0]?.title,
    "Protocol Visualizer Indexing Summary — Production chains"
  );
  assert.equal(
    result.discordMessages[0]?.embeds?.[0]?.description,
    "Environment protocol-visualizer-pr-49"
  );
  assert.deepEqual(result.discordMessages[0]?.embeds?.[0]?.fields, [
    {
      name: "Deployment ID",
      value: "deployment-a",
      inline: false,
    },
    {
      name: "⚪ Ethereum Mainnet",
      value:
        "Status: Readiness unavailable\nBlock: 123\nTime: <t:1780272000:F>",
      inline: false,
    },
  ]);
  assert.equal(result.state.lastDailySummaryAt, "2026-06-05");
});

test("groups all nine indexed chains by catalog environment with full-width status rows", () => {
  const indexed = configuredChains.filter(
    (chain) => chain.availability !== "historical"
  );
  const result = evaluateMonitor({
    chains: configuredChains,
    deploymentId: "deployment-a",
    manifest: manifest("2026-06-05T00:00:00.000Z"),
    progress: {
      chains: Object.fromEntries(
        indexed.map((chain) => [
          chain.key,
          {
            chainId: chain.chainId,
            block: chain.chainId + 123,
            timestamp: null,
            date: null,
          },
        ])
      ),
    },
    notReadyChainIds: [1],
    readyChainIds: indexed
      .filter((chain) => chain.chainId !== 1)
      .map((chain) => chain.chainId),
    state: {},
    now: new Date("2026-06-05T01:00:00.000Z"),
  });
  assert.equal(indexed.length, 9);
  assert.equal(result.discordMessages.length, 2);
  for (const [index, environment] of ["production", "testnet"].entries()) {
    const embed = result.discordMessages[index]?.embeds?.[0];
    assert.equal(embed?.color, index === 0 ? 0xf39c12 : 0x2ecc71);
    assert.match(
      embed?.title ?? "",
      index === 0 ? /Production chains/ : /Testnets/
    );
    const fields = embed?.fields?.slice(1) ?? [];
    const group = indexed.filter((chain) => chain.environment === environment);
    assert.equal(fields.length, index === 0 ? 6 : 3);
    assert.deepEqual(
      fields.map((field) => field.name),
      group.map((chain) => `${chain.chainId === 1 ? "🟠" : "🟢"} ${chain.name}`)
    );
    for (const [i, chain] of group.entries()) {
      assert.equal(fields[i]?.inline, false);
      assert.match(
        fields[i]?.value ?? "",
        new RegExp(`Block: ${chain.chainId + 123}\\n`)
      );
      assert.match(
        fields[i]?.value ?? "",
        chain.chainId === 1 ? /Status: Behind head/ : /Status: Synced to head/
      );
    }
  }
  assert.doesNotMatch(
    JSON.stringify(result.discordMessages),
    /not synced to head|Goerli|Bartio/
  );
});

test("keeps chains with missing progress visible without reporting them synced or behind", () => {
  const result = evaluateMonitor({
    chains: configuredChains,
    deploymentId: "deployment-a",
    progress: {
      chains: {
        Mainnet: { chainId: 1, block: 0, timestamp: null, date: null },
      },
    },
    readyChainIds: [1, 10],
    notReadyChainIds: [1],
    missingChainIds: [1],
    state: {},
    now: new Date("2026-06-05T01:00:00.000Z"),
  });
  const embeds = result.discordMessages.flatMap(
    (message) => message.embeds ?? []
  );
  assert.equal(embeds.length, 2);
  assert(embeds.every((embed) => embed.color === 0x95a5a6));
  const fields = embeds.flatMap((embed) => embed.fields?.slice(1) ?? []);
  assert.equal(fields.length, 9);
  assert(fields.every((field) => field.name.startsWith("⚪ ")));
  assert(
    fields.every(
      (field) =>
        field.value ===
        "Status: Progress unavailable\nBlock: Unavailable\nTime: Timestamp unavailable"
    )
  );
});

test("records active manifest changes without sending handover messages", () => {
  const result = evaluateMonitor({
    chains: [mainnet],
    deploymentId: "deployment-indexing",
    manifest: manifest("2026-06-05T01:00:00.000Z", {
      indexerDeploymentId: "deployment-new-active",
    }),
    state: {
      activeGeneratedAt: "2026-06-04T01:00:00.000Z",
      activeDeploymentId: "deployment-old-active",
      lastDailySummaryAt: "2026-06-05",
    },
    now: new Date("2026-06-05T02:00:00.000Z"),
    staleThresholdMs: Number.MAX_SAFE_INTEGER,
  });
  assert.equal(result.messages.length, 0);
  assert.equal(result.discordMessages.length, 0);
  assert.equal(result.state.activeDeploymentId, "deployment-new-active");
  assert.equal(result.state.activeGeneratedAt, "2026-06-05T01:00:00.000Z");
});

test("warns when no manifest exists", () => {
  const result = evaluateMonitor({
    chains: [mainnet],
    deploymentId: "deployment-c",
    state: { lastDailySummaryAt: "2026-06-05" },
    now: new Date("2026-06-05T02:00:00.000Z"),
  });
  assert.equal(result.messages.length, 1);
  assert.match(result.messages[0] ?? "", /no active manifest/);
});

test("warns when chain progress stops advancing beyond the threshold", () => {
  const result = evaluateMonitor({
    chains: [mainnet],
    deploymentId: "deployment-d",
    manifest: manifest("2026-06-05T00:00:00.000Z"),
    state: {
      lastDailySummaryAt: "2026-06-05",
      chainProgress: {
        Mainnet: {
          block: 123,
          timestamp: 1780272000,
          observedAt: "2026-06-04T00:00:00.000Z",
        },
      },
    },
    now: new Date("2026-06-05T01:00:00.000Z"),
    staleThresholdMs: 24 * 60 * 60 * 1000,
  });
  assert.match(result.messages.join("\n"), /has not advanced/);
  assert.equal(
    result.state.chainProgress?.Mainnet?.observedAt,
    "2026-06-04T00:00:00.000Z"
  );
});

test("warns when Envio metrics report a chain is not ready", () => {
  const result = evaluateMonitor({
    chains: [mainnet],
    deploymentId: "deployment-e",
    manifest: manifest("2026-06-05T00:00:00.000Z"),
    notReadyChainIds: [1],
    state: { lastDailySummaryAt: "2026-06-05" },
    now: new Date("2026-06-05T01:00:00.000Z"),
    staleThresholdMs: Number.MAX_SAFE_INTEGER,
  });
  assert.match(result.messages.join("\n"), /Status: Behind head/);
  assert.equal(result.discordMessages[0]?.embeds?.[0]?.color, 0xf39c12);
  assert.doesNotMatch(
    JSON.stringify(result.discordMessages),
    /is not synced to head/
  );
});

test("warns when active snapshots are older than the stale threshold", () => {
  const result = evaluateMonitor({
    chains: [mainnet],
    deploymentId: "deployment-f",
    manifest: manifest("2026-06-04T00:00:00.000Z"),
    state: { lastDailySummaryAt: "2026-06-05" },
    now: new Date("2026-06-05T01:00:00.000Z"),
    staleThresholdMs: 24 * 60 * 60 * 1000,
  });
  assert.match(result.messages.join("\n"), /active snapshots are 25h old/);
});

test("does not alert when a new deployment is indexing before handover", () => {
  const result = evaluateMonitor({
    chains: [mainnet],
    deploymentId: "deployment-new",
    manifest: manifest("2026-06-05T00:00:00.000Z", {
      indexerDeploymentId: "deployment-active",
    }),
    notReadyChainIds: [1, 10],
    state: { lastDailySummaryAt: "2026-06-05" },
    now: new Date("2026-06-05T01:00:00.000Z"),
    staleThresholdMs: Number.MAX_SAFE_INTEGER,
  });
  assert.doesNotMatch(result.messages.join("\n"), /has not handed over yet/);
  assert.match(result.messages.join("\n"), /Status: Behind head/);
  assert.equal(result.discordMessages[0]?.embeds?.[0]?.color, 0xf39c12);
  assert.doesNotMatch(
    JSON.stringify(result.discordMessages),
    /is not synced to head/
  );
});

test("monitor resolves a missing optional metric to the exact RPC block timestamp", async () => {
  let requestedUrl = "";
  const originalEnv = { ...process.env };
  process.env = {
    ...originalEnv,
    RPC_URL_1: "https://rpc.example/envio",
  };
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (url, init) => {
    if (String(url) === "https://rpc.example/envio") {
      assert.deepEqual(JSON.parse(String(init?.body)).params, ["0x7b", false]);
      return Response.json({
        result: { number: "0x7b", timestamp: "0x6a2023d0" },
      });
    }
    requestedUrl = String(url);
    return new Response(
      `
        hyperindex_synced_to_head 1
        envio_progress_ready{chainId="1"} 1
        envio_progress_block{chainId="1"} 123
      `,
      { status: 200, headers: { "content-type": "text/plain" } }
    );
  }) as typeof fetch;

  try {
    const readiness = await fetchIndexerMetricsReadiness({
      metricsUrl: "http://indexer.internal/metrics",
      chains: [
        {
          key: "Mainnet",
          chainId: 1,
          name: "Mainnet",
          environment: "production",
        },
        {
          key: "Goerli",
          chainId: 5,
          name: "Goerli",
          environment: "testnet",
          availability: "historical",
        },
      ],
    });
    assert.equal(readiness.ready, true);
    assert.deepEqual(readiness.readyChainIds, [1]);
    assert.equal(readiness.indexingProgress.chains.Mainnet?.block, 123);
    assert.equal(readiness.indexingProgress.chains.Mainnet?.date, "2026-06-03");
    assert.equal(requestedUrl, "http://indexer.internal/metrics");
  } finally {
    process.env = originalEnv;
    globalThis.fetch = originalFetch;
  }
});

test("monitor displays unavailable timestamps without epoch dates or Discord epoch markup", () => {
  const result = evaluateMonitor({
    chains: [mainnet],
    deploymentId: "deployment-a",
    manifest: manifest("2026-06-05T00:00:00.000Z"),
    progress: {
      chains: {
        Mainnet: { chainId: 1, block: 123, timestamp: null, date: null },
      },
    },
    state: {},
    now: new Date("2026-06-05T01:00:00.000Z"),
  });
  assert.match(result.messages.join("\n"), /Time: Timestamp unavailable/);
  assert.ok(
    result.discordMessages[0]?.embeds?.[0]?.fields?.some(
      (field) =>
        field.name === "⚪ Ethereum Mainnet" &&
        field.value ===
          "Status: Readiness unavailable\nBlock: 123\nTime: Timestamp unavailable"
    )
  );
  assert.doesNotMatch(JSON.stringify(result), /1970-01-01|<t:0:F>/);
});

test("monitor attempts both groups and saves summary state only after complete delivery", async (t) => {
  const bodies: Array<{ content: string }> = [];
  const savedStates: unknown[] = [];
  let failedIndex = -1;
  t.mock.method(console, "log", () => {});
  t.mock.method(
    globalThis,
    "fetch",
    async (...[_url, init]: Parameters<typeof fetch>) => {
      const index = bodies.length;
      bodies.push(JSON.parse(String(init?.body)));
      if (index === failedIndex) throw new Error("private-webhook-token");
      return new Response(null, { status: 204 });
    }
  );
  for (failedIndex of [0, 1, -1]) {
    bodies.length = 0;
    savedStates.length = 0;
    const run = () =>
      runMonitor({
        chains: configuredChains,
        store: {
          getJson: async <T>(key: string) =>
            (key === ACTIVE_MANIFEST_KEY
              ? manifest("2026-06-05T00:00:00.000Z")
              : undefined) as T | undefined,
          putJson: async (_key, state) => {
            savedStates.push(state);
          },
        },
        webhookUrl: "http://discord.local/private-webhook-token",
        stateKey: "monitor-state",
        environmentName: "protocol-visualizer-pr-49",
        deploymentId: "deployment-a",
        now: new Date("2026-06-05T01:00:00.000Z"),
        staleThresholdMs: Number.MAX_SAFE_INTEGER,
      });
    if (failedIndex === -1) {
      await run();
      assert.equal(savedStates.length, 1);
    } else {
      await assert.rejects(run, {
        message: "Discord delivery failed for 1 of 2 messages",
      });
      assert.equal(savedStates.length, 0);
    }
    assert.equal(bodies.length, 2);
    assert.match(bodies[0]?.content ?? "", /Production chains$/);
    assert.match(bodies[1]?.content ?? "", /Testnets$/);
  }
});

test("reports indexer metrics network failures with safe context", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => {
    throw new Error("fetch failed");
  }) as typeof fetch;

  try {
    await assert.rejects(
      () =>
        fetchIndexerMetricsReadiness({
          metricsUrl:
            "http://user:password@indexer.railway.internal:9898/metrics?secret=value",
          chains: [mainnet],
        }),
      (error) => {
        assert(error instanceof Error);
        assert.match(
          error.message,
          /Indexer metrics request to http:\/\/indexer\.railway\.internal:9898\/metrics failed before response: fetch failed/
        );
        assert.match(error.message, /includes http:\/\/ or https:\/\//);
        assert.doesNotMatch(error.message, /password|secret=value/);
        return true;
      }
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("reports malformed indexer metrics URLs as invalid", async () => {
  await assert.rejects(
    () =>
      fetchIndexerMetricsReadiness({
        metricsUrl: "indexer.railway.internal:9898/metrics",
        chains: [mainnet],
      }),
    (error) => {
      assert(error instanceof Error);
      assert.match(error.message, /Indexer metrics request to <invalid-url>/);
      assert.match(error.message, /includes http:\/\/ or https:\/\//);
      return true;
    }
  );
});

test("reports indexer metrics HTTP failures with safe context", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () =>
    new Response("", { status: 503 })) as typeof fetch;

  try {
    await assert.rejects(
      () =>
        fetchIndexerMetricsReadiness({
          metricsUrl:
            "http://user:password@indexer.railway.internal:9898/metrics?secret=value",
          chains: [mainnet],
        }),
      (error) => {
        assert(error instanceof Error);
        assert.match(
          error.message,
          /Indexer metrics request to http:\/\/indexer\.railway\.internal:9898\/metrics failed with HTTP 503/
        );
        assert.doesNotMatch(error.message, /password|secret=value/);
        return true;
      }
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("logs a sanitized stage when indexer metrics cannot be fetched", async () => {
  const originalFetch = globalThis.fetch;
  const originalEnv = { ...process.env };
  const errors: Array<{
    message: string;
    details: Record<string, unknown>;
  }> = [];
  const infos: Array<{
    message: string;
    details: Record<string, unknown>;
  }> = [];

  globalThis.fetch = (async () => {
    throw new Error("fetch failed");
  }) as typeof fetch;
  Object.assign(process.env, {
    RPC_URL_1: "https://rpc.example/1",
    RPC_URL_10: "https://rpc.example/10",
    RPC_URL_42161: "https://rpc.example/42161",
    RPC_URL_8453: "https://rpc.example/8453",
    RPC_URL_80094: "https://rpc.example/80094",
    RPC_URL_4663: "https://rpc.example/4663",
    RPC_URL_11155111: "https://rpc.example/11155111",
    RPC_URL_421614: "https://rpc.example/421614",
    RPC_URL_84532: "https://rpc.example/84532",

    RAILWAY_ENVIRONMENT_NAME: "protocol-visualizer-pr-63",
    INDEXER_METRICS_URL:
      "http://user:password@indexer.railway.internal:9898/metrics?secret=value",
    PROTOCOL_CHAINS_CONFIG_PATH:
      "../../packages/protocol-config/protocol-chains.json",
    BUCKET: "protocol-snapshots",
    REGION: "us-east-1",
    ENDPOINT: "http://minio.internal:9000",
    ACCESS_KEY_ID: "test-access-key",
    SECRET_ACCESS_KEY: "test-secret-key",
    DISCORD_WEBHOOK_URL: "http://discord.local/webhook",
  });

  try {
    await assert.rejects(
      () =>
        runMonitorFromEnv({
          error: (message, details) => errors.push({ message, details }),
          info: (message, details) => infos.push({ message, details }),
        }),
      /Indexer metrics request/
    );
  } finally {
    globalThis.fetch = originalFetch;
    process.env = originalEnv;
  }

  assert.equal(errors.length, 1);
  assert.equal(errors[0]?.message, "snapshot monitor failed");
  assert.equal(errors[0]?.details.event, "snapshot_monitor_run_failed");
  assert.equal(errors[0]?.details.stage, "fetch_indexer_metrics");
  assert.equal(errors[0]?.details.errorName, "Error");
  assert.match(String(errors[0]?.details.message), /fetch failed/);
  assert.doesNotMatch(
    JSON.stringify(errors[0]?.details),
    /password|secret=value/
  );
  assert.equal(infos.length, 1);
  assert.equal(infos[0]?.message, "snapshot monitor starting");
  assert.equal(
    infos[0]?.details.metricsUrl,
    "http://indexer.railway.internal:9898/metrics"
  );
});

test("logs missing storage configuration during configuration loading", async () => {
  const originalEnv = { ...process.env };
  const errors: Array<{
    message: string;
    details: Record<string, unknown>;
  }> = [];

  Object.assign(process.env, {
    RAILWAY_ENVIRONMENT_NAME: "protocol-visualizer-pr-63",
    INDEXER_METRICS_URL: "http://indexer.railway.internal:9898/metrics",
    REGION: "us-east-1",
    ENDPOINT: "http://minio.internal:9000",
    ACCESS_KEY_ID: "test-access-key",
    SECRET_ACCESS_KEY: "test-secret-key",
    DISCORD_WEBHOOK_URL: "http://discord.local/webhook",
  });
  delete process.env.BUCKET;

  try {
    await assert.rejects(
      () =>
        runMonitorFromEnv({
          error: (message, details) => errors.push({ message, details }),
          info: () => undefined,
        }),
      /BUCKET is required/
    );
  } finally {
    process.env = originalEnv;
  }

  assert.equal(errors.length, 1);
  assert.equal(errors[0]?.details.stage, "load_configuration");
  assert.equal(errors[0]?.details.message, "BUCKET is required");
});

test("rejects over 25 fields per embed before sending, allowing 25 in each embed", async (t) => {
  const fetchMock = t.mock.method(
    globalThis,
    "fetch",
    async () => new Response(null, { status: 204 })
  );
  const embed = (count: number) => ({
    title: "Indexing",
    fields: Array.from({ length: count }, () => ({
      name: "Chain",
      value: "Block: 123",
    })),
  });
  await sendDiscordMessage("http://discord.local/webhook", {
    content: "Progress",
    embeds: [embed(25), embed(25)],
  });
  assert.equal(fetchMock.mock.calls.length, 1);
  await assert.rejects(
    () =>
      sendDiscordMessage("http://discord.local/webhook", {
        content: "Progress",
        embeds: [embed(1), embed(26)],
      }),
    /Discord embeds must have at most 25 fields/
  );
  assert.equal(fetchMock.mock.calls.length, 1);
});

test("sends Discord embed payloads", async () => {
  let body = "";
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (_url, init) => {
    body = String(init?.body ?? "");
    return new Response("", { status: 200 });
  }) as typeof fetch;

  try {
    await sendDiscordMessage("http://discord.local/webhook", {
      content: "Protocol visualizer indexing summary",
      embeds: [
        {
          title: "Protocol Visualizer Indexing Summary",
          fields: [
            {
              name: "Mainnet",
              value: "Date: 2026-06-05\nBlock: 123",
              inline: true,
            },
          ],
        },
      ],
    });
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.deepEqual(JSON.parse(body), {
    content: "Protocol visualizer indexing summary",
    embeds: [
      {
        title: "Protocol Visualizer Indexing Summary",
        fields: [
          {
            name: "Mainnet",
            value: "Date: 2026-06-05\nBlock: 123",
            inline: true,
          },
        ],
      },
    ],
  });
});
