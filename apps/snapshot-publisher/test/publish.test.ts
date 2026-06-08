import assert from "node:assert/strict";
import { test } from "node:test";
import { HeadObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import {
  runPublisher,
  type SnapshotS3Client,
  uploadSnapshotFiles,
} from "../src/publish.js";
import type { SnapshotFile } from "../src/types.js";

const snapshotFile = (key: string, publishLast = false): SnapshotFile => ({
  publicPath: `/${key}`,
  key,
  body: "{}",
  contentType: "application/json",
  cacheControl: "public, max-age=60",
  publishLast,
});

test("uploads publish-last files last and destroys the S3 client", async () => {
  const calls: string[] = [];
  let destroyed = false;
  const client = {
    send: async (command) => {
      if (command instanceof PutObjectCommand) {
        calls.push(`put:${command.input.Key}`);
      } else if (command instanceof HeadObjectCommand) {
        calls.push(`head:${command.input.Key}`);
      }
      return {};
    },
    destroy: () => {
      destroyed = true;
    },
  } satisfies SnapshotS3Client;

  await uploadSnapshotFiles(client, "bucket", [
    snapshotFile("v1/manifest.json", true),
    snapshotFile("v1/chain/1/protocol.json"),
  ]);

  assert.deepEqual(calls, [
    "put:v1/chain/1/protocol.json",
    "head:v1/chain/1/protocol.json",
    "put:v1/manifest.json",
    "head:v1/manifest.json",
  ]);
  assert.equal(destroyed, true);
});

test("destroys the S3 client when upload verification fails", async () => {
  let destroyed = false;
  const client = {
    send: async (command) => {
      if (command instanceof HeadObjectCommand) {
        throw new Error("head failed");
      }
      return {};
    },
    destroy: () => {
      destroyed = true;
    },
  } satisfies SnapshotS3Client;

  await assert.rejects(
    () =>
      uploadSnapshotFiles(client, "bucket", [snapshotFile("v1/index.html")]),
    /head failed/
  );
  assert.equal(destroyed, true);
});

test("publisher skips before Hasura reads when indexer metrics are not ready", async () => {
  const originalEnv = { ...process.env };
  const originalFetch = globalThis.fetch;
  const originalLog = console.log;
  const logs: string[] = [];

  process.env = {
    ...originalEnv,
    SNAPSHOT_SOURCE: "hasura",
    SNAPSHOT_CHAIN_IDS: "1,10",
    INDEXER_DEPLOYMENT_ID: "deployment-a",
    INDEXER_METRICS_URL: "http://indexer:9898/metrics",
  };
  delete process.env.HASURA_GRAPHQL_URL;
  delete process.env.BUCKET;

  globalThis.fetch = async (url) => {
    assert.equal(String(url), "http://indexer:9898/metrics");
    return new Response(
      `
        hyperindex_synced_to_head 0
        envio_progress_ready{chainId="1"} 1
        envio_progress_block{chainId="1"} 25272069
        envio_progress_ready{chainId="10"} 0
        envio_progress_block{chainId="10"} 152657692
      `,
      { status: 200 }
    );
  };
  console.log = (message?: unknown) => {
    logs.push(String(message));
  };

  try {
    await runPublisher();
  } finally {
    process.env = originalEnv;
    globalThis.fetch = originalFetch;
    console.log = originalLog;
  }

  const result = JSON.parse(logs.find((line) => line.startsWith("{")) ?? "{}");
  assert.equal(result.published, false);
  assert.equal(result.skipReason, "not_data_ready");
  assert.equal(result.readiness.syncedToHead, false);
  assert.deepEqual(result.readiness.readyChainIds, [1]);
  assert.deepEqual(result.readiness.notReadyChainIds, [10]);
  assert.equal(result.indexingProgress.chains.Mainnet.block, 25272069);
  assert.equal(result.indexingProgress.chains.Optimism.block, 152657692);
});

test("publisher reports indexer metrics network failures with safe context", async () => {
  const originalEnv = { ...process.env };
  const originalFetch = globalThis.fetch;

  process.env = {
    ...originalEnv,
    SNAPSHOT_SOURCE: "hasura",
    SNAPSHOT_CHAIN_IDS: "1",
    INDEXER_DEPLOYMENT_ID: "deployment-a",
    INDEXER_METRICS_URL:
      "http://user:password@indexer:9898/metrics?secret=value",
  };

  globalThis.fetch = async () => {
    throw new Error("fetch failed");
  };

  try {
    await assert.rejects(
      () => runPublisher(),
      (error) => {
        assert(error instanceof Error);
        assert.match(
          error.message,
          /Indexer metrics request to http:\/\/indexer:9898\/metrics failed before response: fetch failed/
        );
        assert.match(error.message, /indexer PORT/);
        assert.doesNotMatch(error.message, /password|secret=value/);
        return true;
      }
    );
  } finally {
    process.env = originalEnv;
    globalThis.fetch = originalFetch;
  }
});
