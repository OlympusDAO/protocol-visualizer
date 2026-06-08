import assert from "node:assert/strict";
import { test } from "node:test";
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
} from "@aws-sdk/client-s3";
import { PUBLISHER_LOCK_KEY } from "@protocol-visualizer/snapshot-artifacts";
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

class MemoryS3Client implements SnapshotS3Client {
  calls: string[] = [];
  destroyed = false;
  failDelete = false;

  constructor(private readonly objects: Record<string, string> = {}) {}

  async send(command: Parameters<SnapshotS3Client["send"]>[0]) {
    if (command instanceof GetObjectCommand) {
      const key = String(command.input.Key);
      this.calls.push(`get:${key}`);
      const body = this.objects[key];
      if (body === undefined) throw new Error(`missing ${key}`);
      return { Body: body };
    }
    if (command instanceof PutObjectCommand) {
      const key = String(command.input.Key);
      this.calls.push(`put:${key}`);
      this.objects[key] = String(command.input.Body ?? "");
      return {};
    }
    if (command instanceof HeadObjectCommand) {
      const key = String(command.input.Key);
      this.calls.push(`head:${key}`);
      if (this.objects[key] === undefined) throw new Error(`missing ${key}`);
      return {};
    }
    if (command instanceof DeleteObjectCommand) {
      const key = String(command.input.Key);
      this.calls.push(`delete:${key}`);
      if (this.failDelete) throw new Error("delete failed");
      delete this.objects[key];
      return {};
    }
    throw new Error(`unsupported command ${command.constructor.name}`);
  }

  destroy() {
    this.calls.push("destroy");
    this.destroyed = true;
  }
}

const withPublisherEnv = async (
  env: Record<string, string | undefined>,
  run: () => Promise<void>
) => {
  const originalEnv = { ...process.env };
  process.env = { ...originalEnv };
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
  try {
    await run();
  } finally {
    process.env = originalEnv;
  }
};

const captureConsole = () => {
  const originalLog = console.log;
  const originalWarn = console.warn;
  const originalError = console.error;
  const logs: string[] = [];
  const warnings: string[] = [];
  const errors: string[] = [];
  console.log = (message?: unknown) => {
    logs.push(String(message));
  };
  console.warn = (message?: unknown) => {
    warnings.push(String(message));
  };
  console.error = (message?: unknown) => {
    errors.push(String(message));
  };
  return {
    logs,
    warnings,
    errors,
    restore: () => {
      console.log = originalLog;
      console.warn = originalWarn;
      console.error = originalError;
    },
  };
};

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
  const consoleCapture = captureConsole();

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

  try {
    await runPublisher();
  } finally {
    process.env = originalEnv;
    globalThis.fetch = originalFetch;
    consoleCapture.restore();
  }

  const result = JSON.parse(
    consoleCapture.logs.find((line) => line.startsWith("{")) ?? "{}"
  );
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

test("publisher exits with lock_held when another publisher owns the lock", async () => {
  const consoleCapture = captureConsole();
  const now = Date.now();
  const client = new MemoryS3Client({
    [PUBLISHER_LOCK_KEY]: JSON.stringify({
      runId: "other-run",
      deploymentId: "other-deployment",
      createdAt: new Date(now).toISOString(),
      expiresAt: new Date(now + 60_000).toISOString(),
    }),
  });

  try {
    await withPublisherEnv(
      {
        SNAPSHOT_SOURCE: "sample",
        SNAPSHOT_CHAIN_IDS: "1",
        INDEXER_DEPLOYMENT_ID: "deployment-a",
        BUCKET: "bucket",
      },
      () =>
        runPublisher({
          createS3Client: () => client,
          notifyHandover: async () => undefined,
        })
    );
  } finally {
    consoleCapture.restore();
  }

  const result = JSON.parse(
    consoleCapture.logs.find((line) => line.startsWith("{")) ?? "{}"
  );
  assert.equal(result.published, false);
  assert.equal(result.skipReason, "lock_held");
  assert.equal(client.destroyed, true);
  assert.deepEqual(
    client.calls.filter((call) => call.startsWith("put:")),
    []
  );
});

test("publisher uploads snapshots, publishes manifest last, and releases lock", async () => {
  const consoleCapture = captureConsole();
  const client = new MemoryS3Client();

  try {
    await withPublisherEnv(
      {
        SNAPSHOT_SOURCE: "sample",
        SNAPSHOT_CHAIN_IDS: "1",
        INDEXER_DEPLOYMENT_ID: "deployment-a",
        BUCKET: "bucket",
      },
      () =>
        runPublisher({
          createS3Client: () => client,
          notifyHandover: async () => undefined,
        })
    );
  } finally {
    consoleCapture.restore();
  }

  const result = JSON.parse(
    consoleCapture.logs.find((line) => line.startsWith("{")) ?? "{}"
  );
  assert.equal(result.published, true);
  assert.equal(result.manifestPublishedLast, true);
  assert.equal(client.destroyed, true);
  assert(client.calls.includes(`delete:${PUBLISHER_LOCK_KEY}`));
  const putCalls = client.calls.filter((call) => call.startsWith("put:"));
  assert.equal(putCalls.at(-1), "put:v1/manifest.json");
  assert(
    putCalls.some(
      (call) => call === "put:v1/deployments/deployment-a/chain/1/protocol.json"
    )
  );
});

test("publisher still destroys S3 client when lock release fails", async () => {
  const consoleCapture = captureConsole();
  const client = new MemoryS3Client();
  client.failDelete = true;

  try {
    await withPublisherEnv(
      {
        SNAPSHOT_SOURCE: "sample",
        SNAPSHOT_CHAIN_IDS: "1",
        INDEXER_DEPLOYMENT_ID: "deployment-a",
        BUCKET: "bucket",
      },
      () =>
        runPublisher({
          createS3Client: () => client,
          notifyHandover: async () => undefined,
        })
    );
  } finally {
    consoleCapture.restore();
  }

  assert.equal(client.destroyed, true);
  assert(
    consoleCapture.errors.some((message) =>
      message.includes("Lock release failed: delete failed")
    )
  );
});
