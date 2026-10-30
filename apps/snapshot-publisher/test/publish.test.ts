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
  sendDiscordMessage,
  type SnapshotS3Client,
  uploadSnapshotFiles,
} from "../src/publish.js";
import type { SnapshotFile } from "../src/types.js";
import { loadSupportedChains } from "../src/chains.js";

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

test("publisher rejects missing RPC variables before metrics or storage access", async (t) => {
  const originalEnv = { ...process.env };
  process.env = {
    ...originalEnv,
    SNAPSHOT_SOURCE: "hasura",
    SNAPSHOT_CHAIN_IDS: "1",
    INDEXER_DEPLOYMENT_ID: "deployment-a",
    RAILWAY_ENVIRONMENT_NAME: "preview",
  };
  delete process.env.RPC_URL_1;
  const fetchMock = t.mock.method(globalThis, "fetch", async () => {
    throw new Error("unexpected network request");
  });
  try {
    await assert.rejects(
      () => runPublisher(),
      /Missing required RPC variables: RPC_URL_1/
    );
    assert.equal(fetchMock.mock.calls.length, 0);
  } finally {
    process.env = originalEnv;
  }
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
    RPC_URL_10: "https://rpc.example/optimism",
    RPC_URL_1: "https://rpc.example/mainnet",
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
        envio_progress_block_time_seconds{chainId="1"} 1780876800
        envio_progress_ready{chainId="10"} 0
        envio_progress_block{chainId="10"} 152657692
        envio_progress_block_time_seconds{chainId="10"} 1780876800
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
    RPC_URL_1: "https://rpc.example/mainnet",
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
        envio_progress_block_time_seconds{chainId="1"} 1780876800
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

test("publisher reports the RPC block date during backfill in its result and Discord embed", async () => {
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
    RPC_URL_1: "https://rpc.example/envio",
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
        `,
        { status: 200 }
      );
    }
    if (String(url) === "https://rpc.example/envio") {
      assert.deepEqual(JSON.parse(String(init?.body)).params, [
        "0x1819f05",
        false,
      ]);
      return Response.json({
        result: { number: "0x1819f05", timestamp: "0x6a2023d0" },
      });
    }
    assert.equal(String(url), "https://discord.example/webhook");
    discordBodies.push(JSON.parse(String(init?.body)));
    return new Response(null, { status: 204 });
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
  const result = publisherResultFrom(consoleCapture.logs);
  assert.equal(result.published, false);
  assert.equal(result.indexingProgress.chains.Mainnet.date, "2026-06-03");
  const body = discordBodies[0] as {
    content: string;
    embeds: Array<{
      title: string;
      fields: Array<{ name: string; value: string }>;
    }>;
  };
  assert.equal(
    body.content,
    "Protocol visualizer new deployment indexing — Production chains"
  );
  assert.ok(
    body.embeds[0]?.fields.some(
      (field) =>
        field.name === "🟠 Ethereum Mainnet" &&
        field.value ===
          "Status: Indexing\nBlock: 25272069\nTime: <t:1780491216:F>"
    )
  );
  assert.equal(
    body.embeds[0]?.title,
    "Protocol Visualizer New Deployment Indexing — Production chains"
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
});

test("publisher reports indexer metrics network failures with safe context", async () => {
  const originalEnv = { ...process.env };
  const originalFetch = globalThis.fetch;

  process.env = {
    ...originalEnv,
    SNAPSHOT_SOURCE: "hasura",
    RPC_URL_1: "https://rpc.example/mainnet",
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
    RPC_URL_1: "https://rpc.example/mainnet",
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

test("publisher sends all nine chains in a handover embed within Discord's field limit", async () => {
  const originalFetch = globalThis.fetch;
  const consoleCapture = captureConsole();
  const client = new MemoryS3Client();
  const discordBodies: unknown[] = [];

  globalThis.fetch = async (url, init) => {
    assert.equal(String(url), "https://discord.example/webhook");
    discordBodies.push(JSON.parse(String(init?.body)));
    return new Response(null, { status: 204 });
  };

  try {
    await withPublisherEnv(
      {
        SNAPSHOT_SOURCE: "sample",
        SNAPSHOT_CHAIN_IDS: undefined,
        INDEXER_DEPLOYMENT_ID: "deployment-a",
        RAILWAY_ENVIRONMENT_NAME: "protocol-visualizer-pr-49",
        DISCORD_WEBHOOK_URL: "https://discord.example/webhook",
        BUCKET: "bucket",
      },
      () =>
        runPublisher({
          createS3Client: () => client,
        })
    );
  } finally {
    globalThis.fetch = originalFetch;
    consoleCapture.restore();
  }

  assert.equal(discordBodies.length, 2);
  const bodies = discordBodies as Array<{
    content: string;
    embeds: Array<{
      color: number;
      fields: Array<{ name: string; value: string; inline?: boolean }>;
    }>;
  }>;
  const active = JSON.parse(client.objects[ACTIVE_MANIFEST_KEY] ?? "{}");
  assert.equal(active.chains.length, 9);
  const fields = bodies.flatMap((body, index) => {
    assert.equal(
      body.content,
      `Protocol visualizer snapshot handover completed — ${index === 0 ? "Production chains" : "Testnets"}`
    );
    assert.equal(body.embeds[0]?.color, 0x2ecc71);
    const fields = body.embeds[0]?.fields ?? [];
    assert.equal(fields.length, index === 0 ? 7 : 4);
    assert(fields.every((field) => field.inline === false));
    assert.equal(fields[0]?.name, "Deployment ID");
    assert.equal(fields[0]?.value, "deployment-a");
    assert(
      fields
        .slice(1)
        .every((field) =>
          /^Status: Published\nBlock: \d+\nTime: <t:\d+:F>$/.test(field.value)
        )
    );
    return fields.slice(1);
  });
  const chains = await loadSupportedChains();
  for (const [index, environment] of ["production", "testnet"].entries()) {
    assert.deepEqual(
      bodies[index]?.embeds[0]?.fields.slice(1).map((field) => field.name),
      chains
        .filter((chain) => chain.environment === environment)
        .map((chain) => `🟢 ${chain.name}`)
    );
  }
  for (const chain of active.chains)
    assert.equal(
      fields.filter((field) => field.name === `🟢 ${chain.name}`).length,
      1
    );
  assert(
    consoleCapture.logs.some(
      (line) =>
        line.includes('"event":"snapshot_publisher_discord_result"') &&
        line.includes('"delivered":true')
    )
  );
});

test("publisher groups new and continuing deployment notifications, including unavailable chains", async (t) => {
  const chains = await loadSupportedChains();
  assert.equal(chains.length, 9);
  const bodies: Array<{
    content: string;
    embeds: Array<{
      title: string;
      color: number;
      fields: Array<{ name: string; value: string; inline?: boolean }>;
    }>;
  }> = [];
  t.mock.method(
    globalThis,
    "fetch",
    async (...[url, init]: Parameters<typeof fetch>) => {
      if (String(url) === "http://indexer:9898/metrics") {
        return new Response(
          `hyperindex_synced_to_head 0\n${chains
            .filter((chain) => chain.chainId !== 84532)
            .map(
              (chain) =>
                `envio_progress_ready{chainId="${chain.chainId}"} ${chain.chainId === 1 ? 0 : 1}\nenvio_progress_block{chainId="${chain.chainId}"} 123\nenvio_progress_block_time_seconds{chainId="${chain.chainId}"} 1780491216`
            )
            .join("\n")}`
        );
      }
      assert.equal(String(url), "https://discord.example/webhook");
      bodies.push(JSON.parse(String(init?.body)));
      return new Response(null, { status: 204 });
    }
  );
  const capture = captureConsole();
  try {
    for (const seenBefore of [false, true]) {
      const client = new MemoryS3Client({
        [ACTIVE_MANIFEST_KEY]: manifestBody("deployment-active"),
        ...(seenBefore
          ? {
              [PUBLISHER_NOTIFICATION_STATE_KEY]: JSON.stringify({
                lastObservedDeploymentId: "deployment-a",
              }),
            }
          : {}),
      });
      bodies.length = 0;
      await withPublisherEnv(
        {
          SNAPSHOT_SOURCE: "hasura",
          SNAPSHOT_CHAIN_IDS: undefined,
          INDEXER_DEPLOYMENT_ID: "deployment-a",
          RAILWAY_ENVIRONMENT_NAME: "protocol-visualizer-pr-49",
          INDEXER_METRICS_URL: "http://indexer:9898/metrics",
          DISCORD_WEBHOOK_URL: "https://discord.example/webhook",
          BUCKET: "bucket",
          ...Object.fromEntries(
            chains.map((chain) => [
              `RPC_URL_${chain.chainId}`,
              "https://rpc.example/envio",
            ])
          ),
        },
        () => runPublisher({ createS3Client: () => client })
      );
      assert.equal(bodies.length, 2);
      for (const [index, environment] of ["production", "testnet"].entries()) {
        const body = bodies[index];
        assert.equal(
          body?.content,
          `Protocol visualizer ${seenBefore ? "indexing continues" : "new deployment indexing"} — ${index === 0 ? "Production chains" : "Testnets"}`
        );
        const embed = body?.embeds[0];
        assert.match(
          embed?.title ?? "",
          seenBefore ? /Indexing Continues/ : /New Deployment Indexing/
        );
        assert.equal(embed?.color, index === 0 ? 0xf39c12 : 0x95a5a6);
        assert.equal(embed?.fields.length, index === 0 ? 10 : 7);
        const fields = embed?.fields.slice(4) ?? [];
        assert(fields.every((field) => field.inline === false));
        const group = chains.filter(
          (chain) => chain.environment === environment
        );
        assert.deepEqual(
          fields.map((field) => field.name),
          group.map(
            (chain) =>
              `${chain.chainId === 1 ? "🟠" : chain.chainId === 84532 ? "⚪" : "🟢"} ${chain.name}`
          )
        );
        for (const [i, chain] of group.entries())
          assert.match(
            fields[i]?.value ?? "",
            chain.chainId === 1
              ? /Status: Indexing/
              : chain.chainId === 84532
                ? /Status: Progress unavailable\nBlock: Unavailable/
                : /Status: Ready for publication/
          );
      }
    }
  } finally {
    capture.restore();
  }
});

test("publisher rejects over 25 fields per embed before sending, allowing 25 in each embed", async (t) => {
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
