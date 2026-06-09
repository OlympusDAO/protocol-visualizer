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
import type { Manifest, SnapshotFile } from "./types.js";

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
  ) => Promise<void>;
};

const DEFAULT_LOCK_TTL_MS = 55 * 60 * 1000;

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
  content: string
) => {
  const url = webhookUrl?.trim();
  if (!url) return;
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ content }),
  });
  if (!response.ok) {
    throw new Error(`Discord webhook returned HTTP ${response.status}`);
  }
};

const notifyHandover = async (manifest: Manifest, environmentName: string) => {
  const chainSummary = manifest.chains
    .map((chain) => `${chain.name}: ${chain.recordCounts.contracts} contracts`)
    .join(", ");
  await sendDiscordMessage(
    process.env.DISCORD_WEBHOOK_URL,
    `Protocol visualizer snapshot handover completed in ${environmentName} at ${manifest.generatedAt}. ${chainSummary}`
  );
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
  if (indexerReadiness && !indexerReadiness.ready) {
    const result: PublisherResult = {
      deploymentId,
      published: false,
      manifestPublishedLast: false,
      indexingProgress: indexerReadiness.indexingProgress,
      readiness: {
        syncedToHead: indexerReadiness.syncedToHead,
        missingChainIds: indexerReadiness.missingChainIds,
        notReadyChainIds: indexerReadiness.notReadyChainIds,
        readyChainIds: indexerReadiness.readyChainIds,
      },
      skipReason: "not_data_ready",
    };
    console.log(JSON.stringify(result));
    console.log("Snapshot publisher completed successfully; exiting");
    return;
  }

  const loadProtocolData =
    source === "sample"
      ? (chainId: number) => getSampleProtocolData(chainId)
      : (chainId: number) =>
          fetchProtocolData(
            getRequiredEnv("HASURA_GRAPHQL_URL"),
            chainId,
            process.env.HASURA_GRAPHQL_ADMIN_SECRET?.trim()
          );

  const batch = await createSnapshotBatch({
    chains,
    loadProtocolData,
    deploymentId,
    publicBasePath,
    publicOrigin,
    indexingProgressOverride: indexerReadiness?.indexingProgress,
  });
  const files = batch.files;

  const regularFiles = files.filter((file) => !file.publishLast);
  const publishLastFiles = files.filter((file) => file.publishLast);

  if (outputDir) {
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
        indexingProgress: batch.indexingProgress,
        skipReason: "lock_held",
      };
      console.log(JSON.stringify(result));
      console.log("Snapshot publisher completed successfully; exiting");
      return;
    }

    if (!batch.ready) {
      const existingManifest = await getJsonObject<Manifest>(
        client,
        bucket,
        ACTIVE_MANIFEST_KEY
      );
      const result: PublisherResult = {
        deploymentId,
        published: false,
        manifestPublishedLast: false,
        indexingProgress: batch.indexingProgress,
        skipReason: "not_data_ready",
      };
      if (!existingManifest) {
        console.log("No existing snapshot manifest is active yet");
      }
      console.log(JSON.stringify(result));
      console.log("Snapshot publisher completed successfully; exiting");
      return;
    }

    await uploadSnapshotFiles(client, bucket, files, { destroyClient: false });
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
