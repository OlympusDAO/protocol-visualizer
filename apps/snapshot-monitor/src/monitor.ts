import {
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { readFile } from "node:fs/promises";
import {
  ACTIVE_MANIFEST_KEY,
  DEFAULT_MONITOR_STATE_KEY,
  parseDeploymentId,
  parseEnvioMetricsReadiness,
  type IndexingProgress,
  type SnapshotManifest,
} from "@protocol-visualizer/snapshot-artifacts";

type MonitorState = {
  activeGeneratedAt?: string;
  lastDailySummaryAt?: string;
  chainProgress?: Record<
    string,
    {
      block: number;
      timestamp: number;
      observedAt: string;
    }
  >;
};

type ChainConfig = {
  key: string;
  chainId: number;
  name: string;
};

type MonitorStore = {
  getJson: <T>(key: string) => Promise<T | undefined>;
  putJson: (key: string, value: unknown) => Promise<void>;
};

type MonitorInput = {
  deploymentId: string;
  manifest?: SnapshotManifest;
  progress?: IndexingProgress;
  notReadyChainIds?: number[];
  state: MonitorState;
  now: Date;
  staleThresholdMs?: number;
};

type MonitorResult = {
  messages: string[];
  state: MonitorState;
};

const requiredEnv = (key: string): string => {
  const value = process.env[key]?.trim();
  if (!value) throw new Error(`${key} is required`);
  return value;
};

const safeUrlForLog = (value: string): string => {
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return "<invalid-url>";
    }
    url.username = "";
    url.password = "";
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch {
    return "<invalid-url>";
  }
};

const describeFetchError = (error: unknown): string => {
  if (!(error instanceof Error)) {
    return String(error);
  }

  const cause =
    error.cause instanceof Error && error.cause.message !== error.message
      ? `: ${error.cause.message}`
      : "";
  return `${error.message}${cause}`;
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
  return "";
};

function createS3Store(): MonitorStore {
  const bucket = requiredEnv("BUCKET");
  const client = new S3Client({
    region: requiredEnv("REGION"),
    endpoint: requiredEnv("ENDPOINT"),
    forcePathStyle: true,
    credentials: {
      accessKeyId: requiredEnv("ACCESS_KEY_ID"),
      secretAccessKey: requiredEnv("SECRET_ACCESS_KEY"),
    },
  });

  return {
    getJson: async (key) => {
      try {
        const output = await client.send(
          new GetObjectCommand({ Bucket: bucket, Key: key })
        );
        return JSON.parse(await objectBodyToString(output.Body));
      } catch {
        return undefined;
      }
    },
    putJson: async (key, value) => {
      await client.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: key,
          Body: `${JSON.stringify(value, null, 2)}\n`,
          ContentType: "application/json",
          CacheControl: "no-store",
        })
      );
    },
  };
}

const resolveDeploymentId = () =>
  parseDeploymentId(
    process.env.INDEXER_DEPLOYMENT_ID?.trim() ||
      process.env.RAILWAY_GIT_COMMIT_SHA?.trim() ||
      "local-monitor"
  );

export const shortId = (value: string): string =>
  value.length > 12 ? value.slice(0, 12) : value;

async function loadChains(
  configPath = process.env.PROTOCOL_CHAINS_CONFIG_PATH ||
    "config/protocol-chains.json"
): Promise<ChainConfig[]> {
  return JSON.parse(await readFile(configPath, "utf8")) as ChainConfig[];
}

export async function fetchIndexerMetricsReadiness(input: {
  metricsUrl: string;
  chains: ChainConfig[];
}) {
  let response: Response;
  try {
    response = await fetch(input.metricsUrl, {
      method: "GET",
      headers: { accept: "text/plain" },
    });
  } catch (error) {
    throw new Error(
      `Indexer metrics request to ${safeUrlForLog(
        input.metricsUrl
      )} failed before response: ${describeFetchError(
        error
      )}. Check INDEXER_METRICS_URL includes http:// or https://, indexer PORT, and private networking.`
    );
  }
  if (!response.ok) {
    throw new Error(
      `Indexer metrics request to ${safeUrlForLog(
        input.metricsUrl
      )} failed with HTTP ${response.status}`
    );
  }
  return parseEnvioMetricsReadiness(await response.text(), input.chains);
}

export function evaluateMonitor(input: MonitorInput): MonitorResult {
  const messages: string[] = [];
  const staleThresholdMs = input.staleThresholdMs ?? 24 * 60 * 60 * 1000;
  const nextState: MonitorState = {
    ...input.state,
    activeGeneratedAt: input.manifest?.generatedAt,
  };
  const progress = input.progress ?? input.manifest?.indexingProgress;
  const nextChainProgress: MonitorState["chainProgress"] = {};

  if (!input.manifest) {
    messages.push(
      `Protocol visualizer snapshot monitor: no active manifest is published for deployment ${shortId(
        input.deploymentId
      )}.`
    );
  } else if (
    input.state.activeGeneratedAt &&
    input.state.activeGeneratedAt !== input.manifest.generatedAt
  ) {
    messages.push(
      `Protocol visualizer handover detected: active snapshots changed from ${input.state.activeGeneratedAt} to ${input.manifest.generatedAt}.`
    );
  }

  const today = input.now.toISOString().slice(0, 10);
  if (input.state.lastDailySummaryAt !== today) {
    const chainLines = Object.entries(progress?.chains ?? {})
      .map(
        ([name, chain]) =>
          `${name}: ${chain.date} / block ${chain.block} / timestamp ${chain.timestamp}`
      )
      .join("; ");
    messages.push(
      `Protocol visualizer indexing summary for ${shortId(
        input.deploymentId
      )}: ${chainLines || "no per-chain progress available"}.`
    );
    nextState.lastDailySummaryAt = today;
  }

  for (const [name, chain] of Object.entries(progress?.chains ?? {})) {
    const previous = input.state.chainProgress?.[name];
    const unchanged = previous?.block === chain.block;
    const observedAt =
      unchanged && previous?.observedAt
        ? previous.observedAt
        : input.now.toISOString();
    nextChainProgress[name] = {
      block: chain.block,
      timestamp: chain.timestamp,
      observedAt,
    };

    if (
      unchanged &&
      previous?.observedAt &&
      input.now.getTime() - Date.parse(previous.observedAt) >= staleThresholdMs
    ) {
      messages.push(
        `Protocol visualizer indexing warning: ${name} has not advanced since ${previous.observedAt} at block ${chain.block}.`
      );
    }

    if (input.notReadyChainIds?.includes(chain.chainId)) {
      messages.push(
        `Protocol visualizer indexing warning: ${name} is not synced to head at block ${chain.block}.`
      );
    }
  }
  nextState.chainProgress = nextChainProgress;

  return { messages, state: nextState };
}

export async function sendDiscordMessage(webhookUrl: string, content: string) {
  const response = await fetch(webhookUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ content }),
  });
  if (!response.ok) {
    throw new Error(`Discord webhook returned HTTP ${response.status}`);
  }
}

export async function runMonitor(input: {
  store: MonitorStore;
  webhookUrl: string;
  stateKey: string;
  deploymentId: string;
  progress?: IndexingProgress;
  notReadyChainIds?: number[];
  now?: Date;
  staleThresholdMs?: number;
}) {
  const [manifest, state] = await Promise.all([
    input.store.getJson<SnapshotManifest>(ACTIVE_MANIFEST_KEY),
    input.store.getJson<MonitorState>(input.stateKey),
  ]);
  const result = evaluateMonitor({
    deploymentId: input.deploymentId,
    manifest,
    progress: input.progress,
    notReadyChainIds: input.notReadyChainIds,
    state: state ?? {},
    now: input.now ?? new Date(),
    staleThresholdMs: input.staleThresholdMs,
  });

  for (const message of result.messages) {
    await sendDiscordMessage(input.webhookUrl, message);
  }
  await input.store.putJson(input.stateKey, result.state);
  console.log(
    JSON.stringify({
      deploymentId: input.deploymentId,
      messagesSent: result.messages.length,
      activeGeneratedAt: result.state.activeGeneratedAt,
    })
  );
}

export async function runMonitorFromEnv() {
  const staleThresholdHours = Number(
    process.env.MONITOR_STALE_CHAIN_HOURS ?? "24"
  );
  if (!Number.isFinite(staleThresholdHours) || staleThresholdHours <= 0) {
    throw new Error("MONITOR_STALE_CHAIN_HOURS must be a positive number");
  }
  const chains = await loadChains();
  const readiness = await fetchIndexerMetricsReadiness({
    metricsUrl: requiredEnv("INDEXER_METRICS_URL"),
    chains,
  });
  await runMonitor({
    store: createS3Store(),
    webhookUrl: requiredEnv("DISCORD_WEBHOOK_URL"),
    stateKey: process.env.MONITOR_STATE_KEY || DEFAULT_MONITOR_STATE_KEY,
    deploymentId: resolveDeploymentId(),
    progress: readiness.indexingProgress,
    notReadyChainIds: readiness.notReadyChainIds,
    staleThresholdMs: staleThresholdHours * 60 * 60 * 1000,
  });
}
