import assert from "node:assert/strict";
import { test } from "node:test";
import {
  SCHEMA_VERSION,
  type SnapshotManifest,
} from "@protocol-visualizer/snapshot-artifacts";
import {
  evaluateMonitor,
  fetchIndexerMetricsReadiness,
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
    deploymentId: "deployment-a",
    manifest: manifest("2026-06-05T00:00:00.000Z"),
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
  assert.deepEqual(result.discordMessages[0]?.embeds?.[0]?.fields, [
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
      name: "Date",
      value: "<t:1780272000:F>",
      inline: true,
    },
  ]);
  assert.equal(result.state.lastDailySummaryAt, "2026-06-05");
});

test("detects handover when active manifest changes", () => {
  const result = evaluateMonitor({
    deploymentId: "deployment-b",
    manifest: manifest("2026-06-05T01:00:00.000Z"),
    state: {
      activeGeneratedAt: "2026-06-04T01:00:00.000Z",
      lastDailySummaryAt: "2026-06-05",
    },
    now: new Date("2026-06-05T02:00:00.000Z"),
    staleThresholdMs: Number.MAX_SAFE_INTEGER,
  });
  assert.equal(result.messages.length, 1);
  assert.match(result.messages[0] ?? "", /handover detected/);
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

test("alerts once when a new deployment is indexing before handover", () => {
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
  assert.match(result.messages.join("\n"), /deployment deployment-n/);
  assert.match(result.messages.join("\n"), /has not handed over yet/);
  assert.equal(result.state.lastIndexingDeploymentId, "deployment-new");

  const repeated = evaluateMonitor({
    deploymentId: "deployment-new",
    manifest: manifest("2026-06-05T00:00:00.000Z", {
      indexerDeploymentId: "deployment-active",
    }),
    notReadyChainIds: [1, 10],
    state: {
      lastDailySummaryAt: "2026-06-05",
      lastIndexingDeploymentId: "deployment-new",
    },
    now: new Date("2026-06-05T02:00:00.000Z"),
    staleThresholdMs: Number.MAX_SAFE_INTEGER,
  });
  assert.doesNotMatch(repeated.messages.join("\n"), /has not handed over yet/);
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
