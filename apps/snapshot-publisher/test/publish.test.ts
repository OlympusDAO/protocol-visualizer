import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
} from "@aws-sdk/client-s3";
import {
  ACTIVE_MANIFEST_KEY,
  PUBLISHER_LOCK_KEY,
} from "@protocol-visualizer/snapshot-artifacts";
import {
  PUBLISHER_NOTIFICATION_STATE_KEY,
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

const etagFor = (body: string) =>
  `"${createHash("sha256").update(body).digest("hex")}"`;

const preconditionFailed = () => {
  const error = new Error("precondition failed");
  error.name = "PreconditionFailed";
  return error;
};

const manifestBody = (
  deploymentId: string,
  generatedAt = "2026-06-09T08:00:00.000Z"
) =>
  JSON.stringify({
    schemaVersion: "1.0.0",
    generatedAt,
    schemas: {
      openapi: "/v1/openapi.json",
      manifest: "/v1/manifest",
      protocolSnapshot: "/v1/schemas/protocol-snapshot-v1.schema.json",
    },
    chains: [],
    indexerDeploymentId: deploymentId,
  });

class MemoryS3Client implements SnapshotS3Client {
  calls: string[] = [];
  destroyed = false;
  failDelete = false;

  constructor(readonly objects: Record<string, string> = {}) {}

  async send(command: Parameters<SnapshotS3Client["send"]>[0]) {
    if (command instanceof GetObjectCommand) {
      const key = String(command.input.Key);
      this.calls.push(`get:${key}`);
      const body = this.objects[key];
      if (body === undefined) throw new Error(`missing ${key}`);
      return { Body: body, ETag: etagFor(body) };
    }
    if (command instanceof PutObjectCommand) {
      const key = String(command.input.Key);
      const callPrefix = command.input.IfNoneMatch
        ? "put-if-none-match"
        : command.input.IfMatch
          ? "put-if-match"
          : "put";
      this.calls.push(`${callPrefix}:${key}`);
      const currentBody = this.objects[key];
      if (command.input.IfNoneMatch === "*" && currentBody !== undefined) {
        throw preconditionFailed();
      }
      if (
        command.input.IfMatch &&
        (currentBody === undefined ||
          etagFor(currentBody) !== command.input.IfMatch)
      ) {
        throw preconditionFailed();
      }
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
      const callPrefix = command.input.IfMatch ? "delete-if-match" : "delete";
      this.calls.push(`${callPrefix}:${key}`);
      if (this.failDelete) throw new Error("delete failed");
      const currentBody = this.objects[key];
      if (
        command.input.IfMatch &&
        (currentBody === undefined ||
          etagFor(currentBody) !== command.input.IfMatch)
      ) {
        throw preconditionFailed();
      }
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

const publisherResultFrom = (logs: string[]) => {
  const line = logs.find((candidate) => {
    try {
      const value = JSON.parse(candidate);
      return "published" in value && "manifestPublishedLast" in value;
    } catch {
      return false;
    }
  });
  return JSON.parse(line ?? "{}");
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
  const client = new MemoryS3Client({
    [ACTIVE_MANIFEST_KEY]: manifestBody("deployment-active"),
  });

  process.env = {
    ...originalEnv,
    SNAPSHOT_SOURCE: "hasura",
    SNAPSHOT_CHAIN_IDS: "1,10",
    INDEXER_DEPLOYMENT_ID: "deployment-a",
    RAILWAY_ENVIRONMENT_NAME: "protocol-visualizer-pr-49",
    INDEXER_METRICS_URL: "http://indexer:9898/metrics",
    BUCKET: "bucket",
  };
  delete process.env.HASURA_GRAPHQL_URL;

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
    await runPublisher({
      createS3Client: () => client,
    });
  } finally {
    process.env = originalEnv;
    globalThis.fetch = originalFetch;
    consoleCapture.restore();
  }

  const result = publisherResultFrom(consoleCapture.logs);
  assert.equal(result.published, false);
  assert.equal(result.skipReason, "not_data_ready");
  assert.equal(result.readiness.syncedToHead, false);
  assert.deepEqual(result.readiness.readyChainIds, [1]);
  assert.deepEqual(result.readiness.notReadyChainIds, [10]);
  assert.equal(result.indexingProgress.chains.Mainnet.block, 25272069);
  assert.equal(result.indexingProgress.chains.Optimism.block, 152657692);
  const decision = JSON.parse(
    consoleCapture.logs.find((line) =>
      line.includes('"event":"snapshot_publisher_notification_decision"')
    ) ?? "{}"
  );
  assert.equal(decision.decision, "handover_in_progress");
  assert.equal(decision.indexingDeploymentId, "deployment-a");
  assert.equal(decision.activeDeploymentId, "deployment-active");
  assert.deepEqual(decision.readiness.notReadyChainIds, [10]);
  assert(decision.reasons.includes("indexing_deployment_first_seen"));
  assert(decision.reasons.includes("active_manifest_is_previous_deployment"));
  assert(decision.reasons.includes("indexer_not_synced_to_head"));
  assert.equal(
    client.objects[PUBLISHER_NOTIFICATION_STATE_KEY] !== undefined,
    true
  );
});

test("publisher logs continuing indexing for a previously observed deployment", async () => {
  const originalEnv = { ...process.env };
  const originalFetch = globalThis.fetch;
  const consoleCapture = captureConsole();
  const client = new MemoryS3Client({
    [ACTIVE_MANIFEST_KEY]: manifestBody("deployment-active"),
    [PUBLISHER_NOTIFICATION_STATE_KEY]: JSON.stringify({
      lastObservedDeploymentId: "deployment-a",
      lastActiveDeploymentId: "deployment-active",
      lastActiveGeneratedAt: "2026-06-09T08:00:00.000Z",
      lastDecision: "handover_in_progress",
      updatedAt: "2026-06-09T08:30:00.000Z",
    }),
  });

  process.env = {
    ...originalEnv,
    SNAPSHOT_SOURCE: "hasura",
    SNAPSHOT_CHAIN_IDS: "1",
    INDEXER_DEPLOYMENT_ID: "deployment-a",
    RAILWAY_ENVIRONMENT_NAME: "protocol-visualizer-pr-49",
    INDEXER_METRICS_URL: "http://indexer:9898/metrics",
    BUCKET: "bucket",
  };
  delete process.env.HASURA_GRAPHQL_URL;

  globalThis.fetch = async () =>
    new Response(
      `
        hyperindex_synced_to_head 0
        envio_progress_ready{chainId="1"} 0
        envio_progress_block{chainId="1"} 25272069
      `,
      { status: 200 }
    );

  try {
    await runPublisher({
      createS3Client: () => client,
    });
  } finally {
    process.env = originalEnv;
    globalThis.fetch = originalFetch;
    consoleCapture.restore();
  }

  const decision = JSON.parse(
    consoleCapture.logs.find((line) =>
      line.includes('"event":"snapshot_publisher_notification_decision"')
    ) ?? "{}"
  );
  assert.equal(decision.decision, "indexing_continues");
  assert.equal(decision.indexingDeploymentId, "deployment-a");
  assert.equal(decision.previouslyObservedDeploymentId, "deployment-a");
  assert(decision.reasons.includes("indexing_deployment_seen_before"));
  assert(decision.reasons.includes("chains_not_ready"));
});

test("publisher sends handover-in-progress Discord embed for an unready new deployment", async () => {
  const originalEnv = { ...process.env };
  const originalFetch = globalThis.fetch;
  const consoleCapture = captureConsole();
  const client = new MemoryS3Client({
    [ACTIVE_MANIFEST_KEY]: manifestBody("deployment-active"),
  });
  const discordBodies: unknown[] = [];

  process.env = {
    ...originalEnv,
    SNAPSHOT_SOURCE: "hasura",
    SNAPSHOT_CHAIN_IDS: "1",
    INDEXER_DEPLOYMENT_ID: "deployment-a",
    RAILWAY_ENVIRONMENT_NAME: "protocol-visualizer-pr-49",
    INDEXER_METRICS_URL: "http://indexer:9898/metrics",
    DISCORD_WEBHOOK_URL: "https://discord.example/webhook",
    BUCKET: "bucket",
  };
  delete process.env.HASURA_GRAPHQL_URL;

  globalThis.fetch = async (url, init) => {
    if (String(url) === "http://indexer:9898/metrics") {
      return new Response(
        `
          hyperindex_synced_to_head 0
          envio_progress_ready{chainId="1"} 0
          envio_progress_block{chainId="1"} 25272069
          envio_progress_timestamp{chainId="1"} 1780491216
        `,
        { status: 200 }
      );
    }
    assert.equal(String(url), "https://discord.example/webhook");
    discordBodies.push(JSON.parse(String(init?.body)));
    return new Response("", { status: 204 });
  };

  try {
    await runPublisher({
      createS3Client: () => client,
    });
  } finally {
    process.env = originalEnv;
    globalThis.fetch = originalFetch;
    consoleCapture.restore();
  }

  assert.equal(discordBodies.length, 1);
  const body = discordBodies[0] as {
    content: string;
    embeds: Array<{
      title: string;
      fields: Array<{ name: string; value: string }>;
    }>;
  };
  assert.equal(body.content, "Protocol visualizer new deployment indexing");
  assert.equal(
    body.embeds[0]?.title,
    "Protocol Visualizer New Deployment Indexing"
  );
  assert(
    body.embeds[0]?.fields.some(
      (field) =>
        field.name === "Indexing deployment" && field.value === "deployment-a"
    )
  );
  assert(
    body.embeds[0]?.fields.some(
      (field) =>
        field.name === "Published deployment" && field.value === "deployment-a"
    )
  );
  assert(
    body.embeds[0]?.fields.some(
      (field) => field.name === "Chain" && field.value === "Mainnet"
    )
  );
});

test("publisher reports indexer metrics network failures with safe context", async () => {
  const originalEnv = { ...process.env };
  const originalFetch = globalThis.fetch;

  process.env = {
    ...originalEnv,
    SNAPSHOT_SOURCE: "hasura",
    SNAPSHOT_CHAIN_IDS: "1",
    INDEXER_DEPLOYMENT_ID: "deployment-a",
    RAILWAY_ENVIRONMENT_NAME: "protocol-visualizer-pr-49",
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

test("publisher requires Railway environment name for live Hasura runs", async () => {
  const originalEnv = { ...process.env };
  const originalFetch = globalThis.fetch;
  let fetched = false;

  process.env = {
    ...originalEnv,
    SNAPSHOT_SOURCE: "hasura",
    SNAPSHOT_CHAIN_IDS: "1",
    INDEXER_DEPLOYMENT_ID: "deployment-a",
    INDEXER_METRICS_URL: "http://indexer:9898/metrics",
  };
  delete process.env.RAILWAY_ENVIRONMENT_NAME;

  globalThis.fetch = async () => {
    fetched = true;
    return new Response("", { status: 200 });
  };

  try {
    await assert.rejects(
      () => runPublisher(),
      /RAILWAY_ENVIRONMENT_NAME is required/
    );
    assert.equal(fetched, false);
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

  const result = publisherResultFrom(consoleCapture.logs);
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

  const result = publisherResultFrom(consoleCapture.logs);
  assert.equal(result.published, true);
  assert.equal(result.manifestPublishedLast, true);
  assert.equal(client.destroyed, true);
  assert(client.calls.includes(`delete-if-match:${PUBLISHER_LOCK_KEY}`));
  const putCalls = client.calls.filter((call) => call.startsWith("put:"));
  const snapshotPutCalls = putCalls.filter(
    (call) => call !== `put:${PUBLISHER_NOTIFICATION_STATE_KEY}`
  );
  assert.equal(snapshotPutCalls.at(-1), "put:v1/manifest.json");
  assert(putCalls.includes(`put:${PUBLISHER_NOTIFICATION_STATE_KEY}`));
  assert(
    putCalls.some(
      (call) => call === "put:v1/deployments/deployment-a/chain/1/protocol.json"
    )
  );
});

test("publisher logs when Discord handover is skipped because webhook is missing", async () => {
  const consoleCapture = captureConsole();
  const client = new MemoryS3Client();

  try {
    await withPublisherEnv(
      {
        SNAPSHOT_SOURCE: "sample",
        SNAPSHOT_CHAIN_IDS: "1",
        INDEXER_DEPLOYMENT_ID: "deployment-a",
        RAILWAY_ENVIRONMENT_NAME: "protocol-visualizer-pr-49",
        BUCKET: "bucket",
        DISCORD_WEBHOOK_URL: undefined,
      },
      () =>
        runPublisher({
          createS3Client: () => client,
        })
    );
  } finally {
    consoleCapture.restore();
  }

  const decision = JSON.parse(
    consoleCapture.logs.find((line) =>
      line.includes('"event":"snapshot_publisher_discord_decision"')
    ) ?? "{}"
  );
  const result = JSON.parse(
    consoleCapture.logs.find((line) =>
      line.includes('"event":"snapshot_publisher_discord_result"')
    ) ?? "{}"
  );
  assert.equal(decision.webhookConfigured, false);
  assert.equal(result.configured, false);
  assert.equal(result.attempted, false);
  assert.equal(result.delivered, false);
  assert.equal(result.skipReason, "missing_webhook_url");
  assert(
    consoleCapture.warnings.some((message) =>
      message.includes("DISCORD_WEBHOOK_URL is blank")
    )
  );
});

test("publisher takes over a stale lock with conditional replacement", async () => {
  const consoleCapture = captureConsole();
  const now = Date.now();
  const client = new MemoryS3Client({
    [PUBLISHER_LOCK_KEY]: JSON.stringify({
      runId: "stale-run",
      deploymentId: "old-deployment",
      createdAt: new Date(now - 120_000).toISOString(),
      expiresAt: new Date(now - 60_000).toISOString(),
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

  const result = publisherResultFrom(consoleCapture.logs);
  assert.equal(result.published, true);
  assert(client.calls.includes(`put-if-match:${PUBLISHER_LOCK_KEY}`));
  assert(client.calls.includes(`delete-if-match:${PUBLISHER_LOCK_KEY}`));
});

test("publisher treats failed stale-lock replacement as lock_held", async () => {
  const consoleCapture = captureConsole();
  const now = Date.now();

  class RacingLockClient extends MemoryS3Client {
    private raced = false;

    async send(command: Parameters<SnapshotS3Client["send"]>[0]) {
      if (
        command instanceof PutObjectCommand &&
        command.input.Key === PUBLISHER_LOCK_KEY &&
        command.input.IfMatch &&
        !this.raced
      ) {
        this.raced = true;
        this.objects[PUBLISHER_LOCK_KEY] = JSON.stringify({
          runId: "other-fresh-run",
          deploymentId: "other-deployment",
          createdAt: new Date(now).toISOString(),
          expiresAt: new Date(now + 60_000).toISOString(),
        });
      }
      return super.send(command);
    }
  }

  const client = new RacingLockClient({
    [PUBLISHER_LOCK_KEY]: JSON.stringify({
      runId: "stale-run",
      deploymentId: "old-deployment",
      createdAt: new Date(now - 120_000).toISOString(),
      expiresAt: new Date(now - 60_000).toISOString(),
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

  const result = publisherResultFrom(consoleCapture.logs);
  assert.equal(result.published, false);
  assert.equal(result.skipReason, "lock_held");
  assert(client.calls.includes(`put-if-match:${PUBLISHER_LOCK_KEY}`));
  assert.deepEqual(
    client.calls.filter((call) => call.startsWith("put:")),
    []
  );
});

test("publisher skips conditional lock release when lock changes", async () => {
  const consoleCapture = captureConsole();

  class ReleaseRaceClient extends MemoryS3Client {
    private raced = false;

    async send(command: Parameters<SnapshotS3Client["send"]>[0]) {
      if (
        command instanceof DeleteObjectCommand &&
        command.input.Key === PUBLISHER_LOCK_KEY &&
        command.input.IfMatch &&
        !this.raced
      ) {
        this.raced = true;
        this.objects[PUBLISHER_LOCK_KEY] = JSON.stringify({
          runId: "other-fresh-run",
          deploymentId: "other-deployment",
          createdAt: new Date().toISOString(),
          expiresAt: new Date(Date.now() + 60_000).toISOString(),
        });
      }
      return super.send(command);
    }
  }

  const client = new ReleaseRaceClient();

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
    consoleCapture.warnings.some((message) =>
      message.includes("lock changed before conditional delete")
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
