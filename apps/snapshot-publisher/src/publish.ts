import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import {
  ACTIVE_MANIFEST_KEY,
  type EnvioMetricsReadiness,
  parseDeploymentId,
  parseEnvioMetricsReadiness,
  PUBLISHER_LOCK_KEY,
  type IndexingProgress,
} from "@protocol-visualizer/snapshot-artifacts";
import { loadSupportedChains } from "./chains.js";
import { DEFAULT_PUBLIC_BASE_PATH } from "./constants.js";
import {
  createSnapshotBatch,
  fetchProtocolData,
  parseChainIds,
  selectChains,
} from "./snapshot.js";
import { describeFetchError, safeUrlForLog } from "./network-errors.js";
import { getSampleProtocolData } from "./sample-data.js";
import type { Manifest, SnapshotBatch, SnapshotFile } from "./types.js";

type SnapshotSource = "hasura" | "sample";
type SkipReason = "lock_held" | "not_data_ready";

type PublisherResult = {
  deploymentId: string;
  published: boolean;
  manifestPublishedLast: boolean;
  indexingProgress?: IndexingProgress;
  readiness?: {
    syncedToHead: boolean;
    missingChainIds: number[];
    notReadyChainIds: number[];
    readyChainIds: number[];
  };
  skipReason?: SkipReason;
};

type PublisherLock = {
  runId: string;
  deploymentId: string;
  createdAt: string;
  expiresAt: string;
};

type PublisherDependencies = {
  createS3Client?: () => SnapshotS3Client;
  notifyHandover?: (
    manifest: Manifest,
    environmentName: string
  ) => Promise<DiscordNotificationResult | undefined>;
};

type DiscordNotificationResult = {
  configured: boolean;
  attempted: boolean;
  delivered: boolean;
  skipReason?: "missing_webhook_url";
};

type DiscordEmbedField = {
  name: string;
  value: string;
  inline?: boolean;
};

type DiscordEmbed = {
  title: string;
  description?: string;
  fields?: DiscordEmbedField[];
  footer?: {
    text: string;
  };
  timestamp?: string;
};

type DiscordWebhookPayload = {
  content: string;
  embeds?: DiscordEmbed[];
};

type PublisherNotificationDecision =
  | "handover_in_progress"
  | "indexing_continues"
  | "handover_completed"
  | "no_notification";

type PublisherNotificationState = {
  lastObservedDeploymentId?: string;
  lastActiveDeploymentId?: string;
  lastActiveGeneratedAt?: string;
  lastDecision?: PublisherNotificationDecision;
  updatedAt: string;
};

const DEFAULT_LOCK_TTL_MS = 55 * 60 * 1000;
export const PUBLISHER_NOTIFICATION_STATE_KEY =
  "v1/publisher-notification-state.json";

const getRequiredEnv = (key: string): string => {
  const value = process.env[key]?.trim();
  if (!value) {
    throw new Error(`${key} is required`);
  }
  return value;
};

const createS3Client = () =>
  new S3Client({
    region: getRequiredEnv("REGION"),
    endpoint: getRequiredEnv("ENDPOINT"),
    forcePathStyle: true,
    credentials: {
      accessKeyId: getRequiredEnv("ACCESS_KEY_ID"),
      secretAccessKey: getRequiredEnv("SECRET_ACCESS_KEY"),
    },
  });

const getRailwayEnvironmentName = () =>
  getRequiredEnv("RAILWAY_ENVIRONMENT_NAME");

export type SnapshotS3Client = {
  send: S3Client["send"];
  destroy: () => void;
};

const json = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`;

const uploadAndVerify = async (
  client: SnapshotS3Client,
  bucket: string,
  file: SnapshotFile
) => {
  await client.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: file.key,
      Body: file.body,
      ContentType: file.contentType,
      CacheControl: file.cacheControl,
    })
  );

  await client.send(
    new HeadObjectCommand({
      Bucket: bucket,
      Key: file.key,
    })
  );
};

export const uploadSnapshotFiles = async (
  client: SnapshotS3Client,
  bucket: string,
  files: SnapshotFile[],
  options: { destroyClient?: boolean } = {}
) => {
  const destroyClient = options.destroyClient ?? true;
  const regularFiles = files.filter((file) => !file.publishLast);
  const publishLastFiles = files.filter((file) => file.publishLast);

  try {
    for (const file of regularFiles) {
      await uploadAndVerify(client, bucket, file);
    }
    for (const file of publishLastFiles) {
      await uploadAndVerify(client, bucket, file);
    }
  } finally {
    if (destroyClient) {
      client.destroy();
    }
  }
};

const objectBodyToString = async (body: unknown): Promise<string> => {
  if (typeof body === "string") return body;
  if (body instanceof Uint8Array) return Buffer.from(body).toString("utf8");
  if (
    body &&
    typeof body === "object" &&
    "transformToString" in body &&
    typeof body.transformToString === "function"
  ) {
    return body.transformToString();
  }
  if (body && typeof body === "object" && Symbol.asyncIterator in body) {
    const chunks: Buffer[] = [];
    for await (const chunk of body as AsyncIterable<Uint8Array | string>) {
      chunks.push(Buffer.from(chunk));
    }
    return Buffer.concat(chunks).toString("utf8");
  }
  return "";
};

const isConditionalWriteFailure = (error: unknown) =>
  error instanceof Error &&
  ["PreconditionFailed", "ConditionalRequestConflict", "NotModified"].includes(
    error.name
  );

const getJsonObjectWithMetadata = async <T>(
  client: SnapshotS3Client,
  bucket: string,
  key: string
): Promise<{ value: T; etag?: string } | undefined> => {
  try {
    const output = await client.send(
      new GetObjectCommand({ Bucket: bucket, Key: key })
    );
    return {
      value: JSON.parse(await objectBodyToString(output.Body)) as T,
      etag: typeof output.ETag === "string" ? output.ETag : undefined,
    };
  } catch {
    return undefined;
  }
};

const getJsonObject = async <T>(
  client: SnapshotS3Client,
  bucket: string,
  key: string
): Promise<T | undefined> => {
  return (await getJsonObjectWithMetadata<T>(client, bucket, key))?.value;
};

const putJsonObjectIfAbsent = async (
  client: SnapshotS3Client,
  bucket: string,
  key: string,
  value: unknown
) => {
  try {
    await client.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: json(value),
        ContentType: "application/json",
        CacheControl: "no-store",
        IfNoneMatch: "*",
      })
    );
    return true;
  } catch (error) {
    if (isConditionalWriteFailure(error)) return false;
    throw error;
  }
};

const putJsonObject = async (
  client: SnapshotS3Client,
  bucket: string,
  key: string,
  value: unknown
) => {
  await client.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: json(value),
      ContentType: "application/json",
      CacheControl: "no-store",
    })
  );
};

const putJsonObjectIfMatch = async (
  client: SnapshotS3Client,
  bucket: string,
  key: string,
  value: unknown,
  etag: string
) => {
  try {
    await client.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: json(value),
        ContentType: "application/json",
        CacheControl: "no-store",
        IfMatch: etag,
      })
    );
    return true;
  } catch (error) {
    if (isConditionalWriteFailure(error)) return false;
    throw error;
  }
};

const deleteObject = async (
  client: SnapshotS3Client,
  bucket: string,
  key: string
) => {
  await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
};

const deleteObjectIfMatch = async (
  client: SnapshotS3Client,
  bucket: string,
  key: string,
  etag: string
) => {
  try {
    await client.send(
      new DeleteObjectCommand({ Bucket: bucket, Key: key, IfMatch: etag })
    );
    return true;
  } catch (error) {
    if (isConditionalWriteFailure(error)) return false;
    throw error;
  }
};

const resolveDeploymentId = (source: SnapshotSource, outputDir?: string) => {
  const value =
    process.env.INDEXER_DEPLOYMENT_ID?.trim() ||
    process.env.RAILWAY_GIT_COMMIT_SHA?.trim() ||
    (source === "sample" || outputDir ? "local-sample" : "");
  return parseDeploymentId(value);
};

const readinessForResult = (readiness: EnvioMetricsReadiness) => ({
  syncedToHead: readiness.syncedToHead,
  missingChainIds: readiness.missingChainIds,
  notReadyChainIds: readiness.notReadyChainIds,
  readyChainIds: readiness.readyChainIds,
});

const readinessBlockReasons = (readiness: EnvioMetricsReadiness) => {
  const reasons: string[] = [];
  if (!readiness.syncedToHead) reasons.push("indexer_not_synced_to_head");
  if (readiness.missingChainIds.length > 0) {
    reasons.push("missing_chain_metrics");
  }
  if (readiness.notReadyChainIds.length > 0) {
    reasons.push("chains_not_ready");
  }
  return reasons;
};

const notificationDecisionForUnreadyIndexer = (
  deploymentId: string,
  activeManifest: Manifest | undefined,
  notificationState: PublisherNotificationState | undefined,
  readiness: EnvioMetricsReadiness
) => {
  const previouslyObservedDeploymentId =
    notificationState?.lastObservedDeploymentId;
  const activeDeploymentId = activeManifest?.indexerDeploymentId;
  const reasons = readinessBlockReasons(readiness);

  if (!activeManifest) {
    reasons.push("no_active_manifest");
  } else if (activeDeploymentId === deploymentId) {
    reasons.push("active_manifest_matches_indexing_deployment");
  } else {
    reasons.push("active_manifest_is_previous_deployment");
  }

  if (previouslyObservedDeploymentId === deploymentId) {
    reasons.push("indexing_deployment_seen_before");
    return {
      decision: "indexing_continues" as const,
      reasons,
    };
  }

  if (previouslyObservedDeploymentId) {
    reasons.push("indexing_deployment_changed_since_last_run");
  } else {
    reasons.push("indexing_deployment_first_seen");
  }
  return {
    decision: "handover_in_progress" as const,
    reasons,
  };
};

const notificationDecisionForReadyBatch = (
  deploymentId: string,
  activeManifest: Manifest | undefined
) => {
  const activeDeploymentId = activeManifest?.indexerDeploymentId;
  const reasons = ["all_chains_ready", "manifest_publish_last"];
  if (!activeManifest) {
    reasons.push("no_active_manifest");
    return {
      decision: "handover_completed" as const,
      reasons,
    };
  }
  if (activeDeploymentId !== deploymentId) {
    reasons.push("active_manifest_is_previous_deployment");
    return {
      decision: "handover_completed" as const,
      reasons,
    };
  }
  reasons.push("active_manifest_already_matches_indexing_deployment");
  return {
    decision: "no_notification" as const,
    reasons,
  };
};

const logPublisherNotificationDecision = (input: {
  decision: PublisherNotificationDecision;
  reasons: string[];
  deploymentId: string;
  environmentName?: string;
  activeManifest?: Manifest;
  notificationState?: PublisherNotificationState;
  readiness?: EnvioMetricsReadiness;
}) => {
  console.log(
    JSON.stringify({
      event: "snapshot_publisher_notification_decision",
      decision: input.decision,
      reasons: input.reasons,
      environmentName: input.environmentName,
      indexingDeploymentId: input.deploymentId,
      activeDeploymentId: input.activeManifest?.indexerDeploymentId,
      activeGeneratedAt: input.activeManifest?.generatedAt,
      previouslyObservedDeploymentId:
        input.notificationState?.lastObservedDeploymentId,
      previousDecision: input.notificationState?.lastDecision,
      ...(input.readiness
        ? {
            readiness: readinessForResult(input.readiness),
          }
        : {}),
    })
  );
};

const writePublisherNotificationState = async (
  client: SnapshotS3Client,
  bucket: string,
  input: {
    deploymentId: string;
    activeManifest?: Manifest;
    decision: PublisherNotificationDecision;
  }
) => {
  await putJsonObject(client, bucket, PUBLISHER_NOTIFICATION_STATE_KEY, {
    lastObservedDeploymentId: input.deploymentId,
    lastActiveDeploymentId: input.activeManifest?.indexerDeploymentId,
    lastActiveGeneratedAt: input.activeManifest?.generatedAt,
    lastDecision: input.decision,
    updatedAt: new Date().toISOString(),
  } satisfies PublisherNotificationState);
};

const lockTtlMs = () => {
  const raw = process.env.PUBLISHER_LOCK_TTL_MS?.trim();
  if (!raw) return DEFAULT_LOCK_TTL_MS;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`PUBLISHER_LOCK_TTL_MS must be a positive integer`);
  }
  return parsed;
};

const acquireLock = async (
  client: SnapshotS3Client,
  bucket: string,
  deploymentId: string,
  now = new Date()
): Promise<{ acquired: boolean; lock: PublisherLock }> => {
  const ttlMs = lockTtlMs();
  const lock: PublisherLock = {
    runId: `${deploymentId}-${now.getTime()}`,
    deploymentId,
    createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + ttlMs).toISOString(),
  };

  if (await putJsonObjectIfAbsent(client, bucket, PUBLISHER_LOCK_KEY, lock)) {
    return { acquired: true, lock };
  }

  const existing = await getJsonObjectWithMetadata<PublisherLock>(
    client,
    bucket,
    PUBLISHER_LOCK_KEY
  );
  if (!existing || Date.parse(existing.value.expiresAt) > now.getTime()) {
    return { acquired: false, lock: existing?.value ?? lock };
  }

  const replaced = existing.etag
    ? await putJsonObjectIfMatch(
        client,
        bucket,
        PUBLISHER_LOCK_KEY,
        lock,
        existing.etag
      )
    : await putJsonObjectIfAbsent(client, bucket, PUBLISHER_LOCK_KEY, lock);
  if (!replaced) {
    const current = await getJsonObject<PublisherLock>(
      client,
      bucket,
      PUBLISHER_LOCK_KEY
    );
    return { acquired: false, lock: current ?? lock };
  }

  const verified = await getJsonObject<PublisherLock>(
    client,
    bucket,
    PUBLISHER_LOCK_KEY
  );
  return verified?.runId === lock.runId
    ? { acquired: true, lock }
    : { acquired: false, lock: verified ?? lock };
};

const releaseLock = async (
  client: SnapshotS3Client,
  bucket: string,
  lock: PublisherLock
) => {
  const current = await getJsonObjectWithMetadata<PublisherLock>(
    client,
    bucket,
    PUBLISHER_LOCK_KEY
  );
  if (current?.value.runId === lock.runId) {
    if (current.etag) {
      const deleted = await deleteObjectIfMatch(
        client,
        bucket,
        PUBLISHER_LOCK_KEY,
        current.etag
      );
      if (!deleted) {
        console.warn(
          `Lock release skipped for ${PUBLISHER_LOCK_KEY}: lock changed before conditional delete. Publish may have exceeded TTL.`
        );
      }
      return;
    }
    await deleteObject(client, bucket, PUBLISHER_LOCK_KEY);
  } else {
    console.warn(
      `Lock release skipped for ${PUBLISHER_LOCK_KEY}: current lock runId ${
        current?.value.runId ?? "<none>"
      } does not match expected ${lock.runId}. Publish may have exceeded TTL.`
    );
  }
};

export const sendDiscordMessage = async (
  webhookUrl: string | undefined,
  message: string | DiscordWebhookPayload
): Promise<DiscordNotificationResult> => {
  const url = webhookUrl?.trim();
  if (!url) {
    return {
      configured: false,
      attempted: false,
      delivered: false,
      skipReason: "missing_webhook_url",
    };
  }
  const payload = typeof message === "string" ? { content: message } : message;
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    throw new Error(`Discord webhook returned HTTP ${response.status}`);
  }
  return {
    configured: true,
    attempted: true,
    delivered: true,
  };
};

const shortId = (value: string | undefined): string =>
  value && value.length > 12 ? value.slice(0, 12) : (value ?? "<none>");

const indexingProgressFields = (
  progress: IndexingProgress | undefined
): DiscordEmbedField[] => {
  const entries = Object.entries(progress?.chains ?? {});
  if (entries.length === 0) {
    return [
      {
        name: "Progress",
        value: "No per-chain progress available.",
        inline: false,
      },
    ];
  }
  return entries.flatMap(([name, chain]) => [
    {
      name: "Chain",
      value: name,
      inline: true,
    },
    {
      name: "Block",
      value: String(chain.block),
      inline: true,
    },
    {
      name: "Date",
      value: `<t:${chain.timestamp}:F>`,
      inline: true,
    },
  ]);
};

const reasonsField = (reasons: string[]) =>
  reasons.length > 0 ? reasons.join(", ") : "No blocking reason recorded.";

const notifyHandover = async (manifest: Manifest, environmentName: string) => {
  const webhookConfigured = Boolean(process.env.DISCORD_WEBHOOK_URL?.trim());
  console.log(
    JSON.stringify({
      event: "snapshot_publisher_discord_decision",
      notification: "handover",
      environmentName,
      deploymentId: manifest.indexerDeploymentId,
      webhookConfigured,
    })
  );
  if (!webhookConfigured) {
    console.warn(
      "Discord handover notification skipped: DISCORD_WEBHOOK_URL is blank"
    );
  }
  const result = await sendDiscordMessage(process.env.DISCORD_WEBHOOK_URL, {
    content: "Protocol visualizer snapshot handover completed",
    embeds: [
      {
        title: "Protocol Visualizer Snapshot Handover",
        description: `Environment ${environmentName}`,
        fields: [
          {
            name: "Published deployment",
            value: shortId(manifest.indexerDeploymentId),
            inline: true,
          },
          {
            name: "Generated at",
            value: manifest.generatedAt,
            inline: true,
          },
          ...manifest.chains.flatMap((chain) => [
            {
              name: "Chain",
              value: chain.name,
              inline: true,
            },
            {
              name: "Contracts",
              value: String(chain.recordCounts.contracts),
              inline: true,
            },
            {
              name: "Roles",
              value: String(chain.recordCounts.roles),
              inline: true,
            },
          ]),
        ],
        timestamp: manifest.generatedAt,
      },
    ],
  });
  console.log(
    JSON.stringify({
      event: "snapshot_publisher_discord_result",
      notification: "handover",
      environmentName,
      deploymentId: manifest.indexerDeploymentId,
      ...result,
    })
  );
  return result;
};

const notifyIndexingProgress = async (input: {
  decision: "handover_in_progress" | "indexing_continues";
  deploymentId: string;
  environmentName: string;
  activeManifest?: Manifest;
  readiness: EnvioMetricsReadiness;
  reasons: string[];
}) => {
  const webhookConfigured = Boolean(process.env.DISCORD_WEBHOOK_URL?.trim());
  const notification = input.decision;
  console.log(
    JSON.stringify({
      event: "snapshot_publisher_discord_decision",
      notification,
      environmentName: input.environmentName,
      indexingDeploymentId: input.deploymentId,
      activeDeploymentId: input.activeManifest?.indexerDeploymentId,
      webhookConfigured,
      reasons: input.reasons,
    })
  );
  if (!webhookConfigured) {
    console.warn(
      `Discord ${notification} notification skipped: DISCORD_WEBHOOK_URL is blank`
    );
  }
  const result = await sendDiscordMessage(process.env.DISCORD_WEBHOOK_URL, {
    content:
      input.decision === "handover_in_progress"
        ? "Protocol visualizer new deployment indexing"
        : "Protocol visualizer indexing continues",
    embeds: [
      {
        title:
          input.decision === "handover_in_progress"
            ? "Protocol Visualizer New Deployment Indexing"
            : "Protocol Visualizer Indexing Continues",
        description: `Environment ${input.environmentName}`,
        fields: [
          {
            name: "Indexing deployment",
            value: shortId(input.deploymentId),
            inline: true,
          },
          {
            name: "Published deployment",
            value: shortId(input.activeManifest?.indexerDeploymentId),
            inline: true,
          },
          {
            name: "Synced to head",
            value: input.readiness.syncedToHead ? "yes" : "no",
            inline: true,
          },
          {
            name: "Decision reasons",
            value: reasonsField(input.reasons),
            inline: false,
          },
          ...indexingProgressFields(input.readiness.indexingProgress),
        ],
        footer: input.activeManifest
          ? { text: `Active manifest: ${input.activeManifest.generatedAt}` }
          : undefined,
        timestamp: new Date().toISOString(),
      },
    ],
  });
  console.log(
    JSON.stringify({
      event: "snapshot_publisher_discord_result",
      notification,
      environmentName: input.environmentName,
      indexingDeploymentId: input.deploymentId,
      activeDeploymentId: input.activeManifest?.indexerDeploymentId,
      ...result,
    })
  );
  return result;
};

const writeLocalFile = async (outputDir: string, file: SnapshotFile) => {
  const filePath = path.join(outputDir, file.key);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, file.body);
};

const fetchIndexerReadiness = async (
  url: string,
  chains: Array<{ key: string; chainId: number }>
) => {
  let response: Response;
  try {
    response = await fetch(url, {
      method: "GET",
      headers: { accept: "text/plain" },
    });
  } catch (error) {
    throw new Error(
      `Indexer metrics request to ${safeUrlForLog(
        url
      )} failed before response: ${describeFetchError(
        error
      )}. Check INDEXER_METRICS_URL, indexer PORT, and private networking.`
    );
  }

  if (!response.ok) {
    throw new Error(
      `Indexer metrics request to ${safeUrlForLog(
        url
      )} failed with HTTP ${response.status}`
    );
  }
  return parseEnvioMetricsReadiness(await response.text(), chains);
};

export async function runPublisher(deps: PublisherDependencies = {}) {
  const publicBasePath =
    process.env.SNAPSHOT_PUBLIC_BASE_PATH || DEFAULT_PUBLIC_BASE_PATH;
  const publicOrigin = process.env.SNAPSHOT_PUBLIC_ORIGIN;
  const supportedChains = await loadSupportedChains();
  const chainIds = parseChainIds(
    process.env.SNAPSHOT_CHAIN_IDS,
    supportedChains
  );
  const chains = selectChains(chainIds, supportedChains);
  const outputDir = process.env.SNAPSHOT_OUTPUT_DIR;
  const source = (process.env.SNAPSHOT_SOURCE ||
    (outputDir ? "sample" : "hasura")) as SnapshotSource;
  if (source !== "sample" && source !== "hasura") {
    throw new Error(
      `SNAPSHOT_SOURCE must be sample or hasura; received ${source}`
    );
  }

  const deploymentId = resolveDeploymentId(source, outputDir);
  const environmentName =
    source === "hasura" ? getRailwayEnvironmentName() : undefined;
  const indexerReadiness =
    source === "hasura"
      ? await fetchIndexerReadiness(
          getRequiredEnv("INDEXER_METRICS_URL"),
          chains
        )
      : undefined;

  const loadProtocolData =
    source === "sample"
      ? (chainId: number) => getSampleProtocolData(chainId)
      : (chainId: number) =>
          fetchProtocolData(
            getRequiredEnv("HASURA_GRAPHQL_URL"),
            chainId,
            process.env.HASURA_GRAPHQL_ADMIN_SECRET?.trim()
          );

  let batch: SnapshotBatch | undefined;
  if (!indexerReadiness || indexerReadiness.ready) {
    batch = await createSnapshotBatch({
      chains,
      loadProtocolData,
      deploymentId,
      publicBasePath,
      publicOrigin,
      indexingProgressOverride: indexerReadiness?.indexingProgress,
    });
  }

  if (outputDir) {
    if (!batch) {
      const result: PublisherResult = {
        deploymentId,
        published: false,
        manifestPublishedLast: false,
        indexingProgress: indexerReadiness?.indexingProgress,
        readiness: indexerReadiness
          ? readinessForResult(indexerReadiness)
          : undefined,
        skipReason: "not_data_ready",
      };
      console.log(JSON.stringify(result));
      console.log("Snapshot publisher completed successfully; exiting");
      return;
    }
    const files = batch.files;
    const regularFiles = files.filter((file) => !file.publishLast);
    const publishLastFiles = files.filter((file) => file.publishLast);
    for (const file of [...regularFiles, ...publishLastFiles]) {
      await writeLocalFile(outputDir, file);
    }
    console.log(`Wrote ${files.length} snapshot files to ${outputDir}`);
    const result: PublisherResult = {
      deploymentId,
      published: batch.ready,
      manifestPublishedLast:
        batch.ready && files.at(-1)?.key === ACTIVE_MANIFEST_KEY,
      indexingProgress: batch.indexingProgress,
      ...(batch.ready ? {} : { skipReason: "not_data_ready" }),
    };
    console.log(JSON.stringify(result));
    console.log("Snapshot publisher completed successfully; exiting");
    return;
  }

  const bucket = getRequiredEnv("BUCKET");
  const client = (deps.createS3Client ?? createS3Client)();
  let lock: PublisherLock | undefined;

  try {
    const acquiredLock = await acquireLock(client, bucket, deploymentId);
    lock = acquiredLock.lock;
    if (!acquiredLock.acquired) {
      const result: PublisherResult = {
        deploymentId,
        published: false,
        manifestPublishedLast: false,
        indexingProgress:
          batch?.indexingProgress ?? indexerReadiness?.indexingProgress,
        readiness: indexerReadiness
          ? readinessForResult(indexerReadiness)
          : undefined,
        skipReason: "lock_held",
      };
      console.log(JSON.stringify(result));
      console.log("Snapshot publisher completed successfully; exiting");
      return;
    }

    const activeManifest = await getJsonObject<Manifest>(
      client,
      bucket,
      ACTIVE_MANIFEST_KEY
    );
    const notificationState = await getJsonObject<PublisherNotificationState>(
      client,
      bucket,
      PUBLISHER_NOTIFICATION_STATE_KEY
    );

    if (indexerReadiness && !indexerReadiness.ready) {
      const decision = notificationDecisionForUnreadyIndexer(
        deploymentId,
        activeManifest,
        notificationState,
        indexerReadiness
      );
      logPublisherNotificationDecision({
        decision: decision.decision,
        reasons: decision.reasons,
        deploymentId,
        environmentName,
        activeManifest,
        notificationState,
        readiness: indexerReadiness,
      });
      await writePublisherNotificationState(client, bucket, {
        deploymentId,
        activeManifest,
        decision: decision.decision,
      });
      try {
        await notifyIndexingProgress({
          decision: decision.decision,
          deploymentId,
          environmentName: environmentName ?? getRailwayEnvironmentName(),
          activeManifest,
          readiness: indexerReadiness,
          reasons: decision.reasons,
        });
      } catch (error) {
        console.error(
          `Discord indexing notification failed: ${
            error instanceof Error ? error.message : String(error)
          }`
        );
      }
      const result: PublisherResult = {
        deploymentId,
        published: false,
        manifestPublishedLast: false,
        indexingProgress: indexerReadiness.indexingProgress,
        readiness: readinessForResult(indexerReadiness),
        skipReason: "not_data_ready",
      };
      if (!activeManifest) {
        console.log("No existing snapshot manifest is active yet");
      }
      console.log(JSON.stringify(result));
      console.log("Snapshot publisher completed successfully; exiting");
      return;
    }

    if (!batch) {
      throw new Error("Snapshot batch was not generated");
    }

    if (!batch.ready) {
      const result: PublisherResult = {
        deploymentId,
        published: false,
        manifestPublishedLast: false,
        indexingProgress: batch.indexingProgress,
        skipReason: "not_data_ready",
      };
      if (!activeManifest) {
        console.log("No existing snapshot manifest is active yet");
      }
      console.log(JSON.stringify(result));
      console.log("Snapshot publisher completed successfully; exiting");
      return;
    }

    const files = batch.files;
    const decision = notificationDecisionForReadyBatch(
      deploymentId,
      activeManifest
    );
    logPublisherNotificationDecision({
      decision: decision.decision,
      reasons: decision.reasons,
      deploymentId,
      environmentName,
      activeManifest,
      notificationState,
    });

    await uploadSnapshotFiles(client, bucket, files, { destroyClient: false });
    if (decision.decision === "handover_completed") {
      try {
        await (deps.notifyHandover ?? notifyHandover)(
          batch.manifest,
          environmentName ?? getRailwayEnvironmentName()
        );
      } catch (error) {
        console.error(
          `Discord handover notification failed: ${
            error instanceof Error ? error.message : String(error)
          }`
        );
      }
    }
    await writePublisherNotificationState(client, bucket, {
      deploymentId,
      activeManifest: batch.manifest,
      decision: decision.decision,
    });

    const result: PublisherResult = {
      deploymentId,
      published: true,
      manifestPublishedLast: files.at(-1)?.key === ACTIVE_MANIFEST_KEY,
      indexingProgress: batch.indexingProgress,
    };
    console.log(JSON.stringify(result));
    console.log(`Published ${files.length} snapshot files to ${bucket}`);
    console.log("Snapshot publisher completed successfully; exiting");
  } finally {
    try {
      if (lock) {
        await releaseLock(client, bucket, lock);
      }
    } catch (error) {
      console.error(
        `Lock release failed: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
    try {
      client.destroy();
    } catch (error) {
      console.error(
        `S3 client destroy failed: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runPublisher().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
