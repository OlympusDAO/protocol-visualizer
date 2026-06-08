import assert from "node:assert/strict";
import { test } from "node:test";
import {
  SCHEMA_VERSION,
  type SnapshotManifest,
} from "@protocol-visualizer/snapshot-artifacts";
import {
  evaluateMonitor,
  fetchIndexerMetricsReadiness,
  shortId,
} from "../src/monitor.js";

const manifest = (generatedAt: string): SnapshotManifest => ({
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
