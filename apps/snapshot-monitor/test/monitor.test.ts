import assert from "node:assert/strict";
import { test } from "node:test";
import {
  SCHEMA_VERSION,
  type SnapshotManifest,
} from "@protocol-visualizer/snapshot-artifacts";
import {
  evaluateMonitor,
  fetchIndexerMetricsReadiness,
  runMonitorFromEnv,
  sendDiscordMessage,
  shortId,
} from "../src/monitor.js";

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

test("shortens deployment ids for Discord output", () => {
  assert.equal(shortId("1234567890abcdef"), "1234567890ab");
});

test("sends one daily indexing summary", () => {
  const result = evaluateMonitor({
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
  assert.match(result.messages[0] ?? "", /Mainnet: 2026-06-05/);
  assert.equal(result.discordMessages.length, 1);
  assert.equal(
    result.discordMessages[0]?.content,
    "Protocol visualizer indexing summary"
  );
  assert.equal(
    result.discordMessages[0]?.embeds?.[0]?.title,
    "Protocol Visualizer Indexing Summary"
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
      name: "Chain",
      value: "Mainnet",
      inline: true,
    },
    {
      name: "Block",
      value: "123",
      inline: true,
    },
    {
      name: "Time",
      value: "<t:1780272000:F>",
      inline: true,
    },
  ]);
  assert.equal(result.state.lastDailySummaryAt, "2026-06-05");
});

test("records active manifest changes without sending handover messages", () => {
  const result = evaluateMonitor({
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
    deploymentId: "deployment-c",
    state: { lastDailySummaryAt: "2026-06-05" },
    now: new Date("2026-06-05T02:00:00.000Z"),
  });
  assert.equal(result.messages.length, 1);
  assert.match(result.messages[0] ?? "", /no active manifest/);
});

test("warns when chain progress stops advancing beyond the threshold", () => {
  const result = evaluateMonitor({
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
    deploymentId: "deployment-e",
    manifest: manifest("2026-06-05T00:00:00.000Z"),
    notReadyChainIds: [1],
    state: { lastDailySummaryAt: "2026-06-05" },
    now: new Date("2026-06-05T01:00:00.000Z"),
    staleThresholdMs: Number.MAX_SAFE_INTEGER,
  });
  assert.match(result.messages.join("\n"), /is not synced to head/);
});

test("warns when active snapshots are older than the stale threshold", () => {
  const result = evaluateMonitor({
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
  assert.match(result.messages.join("\n"), /is not synced to head/);
});

test("fetches current indexing readiness from Envio metrics", async () => {
  let requestedUrl = "";
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (url) => {
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
      chains: [{ key: "Mainnet", chainId: 1, name: "Mainnet" }],
    });
    assert.equal(readiness.ready, true);
    assert.deepEqual(readiness.readyChainIds, [1]);
    assert.equal(readiness.indexingProgress.chains.Mainnet?.block, 123);
    assert.equal(requestedUrl, "http://indexer.internal/metrics");
  } finally {
    globalThis.fetch = originalFetch;
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
          chains: [{ key: "Mainnet", chainId: 1, name: "Mainnet" }],
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
        chains: [{ key: "Mainnet", chainId: 1, name: "Mainnet" }],
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
          chains: [{ key: "Mainnet", chainId: 1, name: "Mainnet" }],
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
