export const SCHEMA_VERSION = "1.0.0" as const;
export const ACTIVE_MANIFEST_KEY = "v1/manifest.json";
export const PUBLISHER_LOCK_KEY = "v1/publisher.lock";
export const DEFAULT_MONITOR_STATE_KEY = "v1/monitor-state.json";

export type RecordCounts = {
  contracts: number;
  roles: number;
  roleAssignments: number;
};

export type ChainIndexingProgress = {
  chainId: number;
  date: string;
  timestamp: number;
  block: number;
};

export type IndexingProgress = {
  chains: Record<string, ChainIndexingProgress>;
};

export type EnvioMetricsChainConfig = {
  key: string;
  chainId: number;
};

export type EnvioMetricsReadiness = {
  ready: boolean;
  syncedToHead: boolean;
  missingChainIds: number[];
  notReadyChainIds: number[];
  readyChainIds: number[];
  indexingProgress: IndexingProgress;
};

export type SnapshotManifestChain = {
  chainId: number;
  name: string;
  path: string;
  generatedAt: string;
  recordCounts: RecordCounts;
};

export type SnapshotManifest = {
  schemaVersion: typeof SCHEMA_VERSION;
  generatedAt: string;
  schemas: {
    openapi: string;
    manifest: string;
    protocolSnapshot: string;
  };
  chains: SnapshotManifestChain[];
  indexingProgress?: IndexingProgress;
  indexerDeploymentId?: string;
  artifacts?: Record<string, string>;
};

export type PublicSnapshotManifest = Omit<
  SnapshotManifest,
  "indexerDeploymentId" | "artifacts"
>;

export type BoundsResponse = {
  generatedAt: string;
  indexingProgress?: IndexingProgress;
};

export type OpenApiDocument = {
  openapi: "3.1.0";
  info: { title: string; version: string };
  paths: Record<string, unknown>;
  components: {
    schemas: Record<string, unknown>;
  };
};

export const deploymentArtifactKey = (
  deploymentId: string,
  chainId: number
): string => `v1/deployments/${deploymentId}/chain/${chainId}/protocol.json`;

export const restProtocolPath = (chainId: number): string =>
  `/v1/chains/${chainId}/protocol`;

export const isSafeDeploymentId = (value: string): boolean =>
  /^[A-Za-z0-9._-]+$/.test(value) && !value.includes("..");

export function parseDeploymentId(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error("INDEXER_DEPLOYMENT_ID is required");
  }
  if (!isSafeDeploymentId(trimmed)) {
    throw new Error(
      "INDEXER_DEPLOYMENT_ID may contain only letters, numbers, dots, underscores, and dashes"
    );
  }
  return trimmed;
}

export function sanitizeManifestForPublic(
  manifest: SnapshotManifest
): PublicSnapshotManifest {
  const {
    indexerDeploymentId: _deploymentId,
    artifacts: _artifacts,
    ...publicManifest
  } = manifest;
  return publicManifest;
}

const parsePrometheusChainIdLabel = (value: string): number | undefined => {
  const labelName = 'chainId="';
  const labelStart = value.indexOf(labelName);
  if (labelStart === -1) {
    return undefined;
  }

  const valueStart = labelStart + labelName.length;
  const valueEnd = value.indexOf('"', valueStart);
  if (valueEnd === -1) {
    return undefined;
  }

  const chainId = Number(value.slice(valueStart, valueEnd));
  return Number.isInteger(chainId) ? chainId : undefined;
};

const isPrometheusMetricName = (value: string): boolean => {
  if (!value) {
    return false;
  }

  const firstCode = value.charCodeAt(0);
  if (
    !(
      firstCode === 58 ||
      firstCode === 95 ||
      (firstCode >= 65 && firstCode <= 90) ||
      (firstCode >= 97 && firstCode <= 122)
    )
  ) {
    return false;
  }

  for (let index = 1; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (
      code !== 58 &&
      code !== 95 &&
      !(code >= 48 && code <= 57) &&
      !(code >= 65 && code <= 90) &&
      !(code >= 97 && code <= 122)
    ) {
      return false;
    }
  }

  return true;
};

const parsePrometheusMetricLine = (
  line: string
): { metricName: string; rawLabels: string; rawValue: string } | undefined => {
  let valueSeparator = -1;
  for (let index = 0; index < line.length; index += 1) {
    const code = line.charCodeAt(index);
    if (
      code === 9 ||
      code === 10 ||
      code === 11 ||
      code === 12 ||
      code === 13 ||
      code === 32
    ) {
      valueSeparator = index;
      break;
    }
  }

  if (valueSeparator <= 0) {
    return undefined;
  }

  const metricAndLabels = line.slice(0, valueSeparator);
  const rawValue = line.slice(valueSeparator).trim();
  if (!rawValue) {
    return undefined;
  }

  const labelStart = metricAndLabels.indexOf("{");
  if (labelStart === -1) {
    return isPrometheusMetricName(metricAndLabels)
      ? { metricName: metricAndLabels, rawLabels: "", rawValue }
      : undefined;
  }

  if (!metricAndLabels.endsWith("}")) {
    return undefined;
  }

  const metricName = metricAndLabels.slice(0, labelStart);
  if (!isPrometheusMetricName(metricName)) {
    return undefined;
  }

  return {
    metricName,
    rawLabels: metricAndLabels.slice(labelStart + 1, -1),
    rawValue,
  };
};

function* iterateLines(value: string): Generator<string> {
  let lineStart = 0;
  for (let index = 0; index < value.length; index += 1) {
    if (value.charCodeAt(index) !== 10) {
      continue;
    }

    const lineEnd =
      index > lineStart && value.charCodeAt(index - 1) === 13
        ? index - 1
        : index;
    yield value.slice(lineStart, lineEnd);
    lineStart = index + 1;
  }

  if (lineStart <= value.length) {
    yield value.slice(lineStart);
  }
}

const parsePrometheusNumber = (value: string): number | undefined => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
};

export function parseEnvioMetricsReadiness(
  metricsText: string,
  chains: EnvioMetricsChainConfig[],
  observedAt = new Date()
): EnvioMetricsReadiness {
  const readyByChainId = new Map<number, number>();
  const blockByChainId = new Map<number, number>();
  const timestampByChainId = new Map<number, number>();
  let syncedToHead = false;

  for (const rawLine of iterateLines(metricsText)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    const parsedLine = parsePrometheusMetricLine(line);
    if (!parsedLine) continue;

    const { metricName, rawLabels, rawValue } = parsedLine;
    const value = parsePrometheusNumber(rawValue);
    if (value === undefined) continue;

    if (metricName === "hyperindex_synced_to_head") {
      syncedToHead = value === 1;
      continue;
    }

    const chainId = parsePrometheusChainIdLabel(rawLabels);
    if (chainId === undefined) continue;

    if (metricName === "envio_progress_ready") {
      readyByChainId.set(chainId, value);
    } else if (metricName === "envio_progress_block") {
      blockByChainId.set(chainId, value);
    } else if (metricName === "envio_progress_timestamp") {
      timestampByChainId.set(chainId, value);
    }
  }

  const fallbackTimestamp = Math.floor(observedAt.getTime() / 1000);
  const missingChainIds: number[] = [];
  const notReadyChainIds: number[] = [];
  const readyChainIds: number[] = [];
  const progressEntries: Array<[string, ChainIndexingProgress]> = [];

  for (const chain of chains) {
    const readyMetric = readyByChainId.get(chain.chainId);
    const block = blockByChainId.get(chain.chainId);
    const chainReady =
      readyMetric === 1 && typeof block === "number" && block > 0;
    if (readyMetric === undefined || block === undefined) {
      missingChainIds.push(chain.chainId);
    }
    if (!chainReady) {
      notReadyChainIds.push(chain.chainId);
    } else {
      readyChainIds.push(chain.chainId);
    }

    const chainTimestamp = Math.trunc(
      timestampByChainId.get(chain.chainId) ?? fallbackTimestamp
    );

    progressEntries.push([
      chain.key,
      {
        chainId: chain.chainId,
        date: new Date(chainTimestamp * 1000).toISOString().slice(0, 10),
        timestamp: chainTimestamp,
        block: Math.trunc(block ?? 0),
      },
    ]);
  }

  return {
    ready:
      syncedToHead &&
      missingChainIds.length === 0 &&
      notReadyChainIds.length === 0,
    syncedToHead,
    missingChainIds,
    notReadyChainIds,
    readyChainIds,
    indexingProgress: { chains: Object.fromEntries(progressEntries) },
  };
}

export const protocolSnapshotSchema = {
  type: "object",
  required: ["schemaVersion", "generatedAt", "chainId", "recordCounts", "data"],
  additionalProperties: true,
  properties: {
    schemaVersion: { const: SCHEMA_VERSION },
    generatedAt: { type: "string", format: "date-time" },
    chainId: { type: "integer" },
    recordCounts: {
      type: "object",
      required: ["contracts", "roles", "roleAssignments"],
      properties: {
        contracts: { type: "integer", minimum: 0 },
        roles: { type: "integer", minimum: 0 },
        roleAssignments: { type: "integer", minimum: 0 },
      },
    },
    data: {
      type: "object",
      required: ["contracts", "roles", "roleAssignments"],
      properties: {
        contracts: { type: "array", items: { type: "object" } },
        roles: { type: "array", items: { type: "object" } },
        roleAssignments: { type: "array", items: { type: "object" } },
      },
    },
  },
} as const;

export const indexingProgressSchema = {
  type: "object",
  required: ["chains"],
  properties: {
    chains: {
      type: "object",
      additionalProperties: {
        type: "object",
        required: ["chainId", "date", "timestamp", "block"],
        properties: {
          chainId: { type: "integer" },
          date: { type: "string" },
          timestamp: { type: "integer" },
          block: { type: "integer" },
        },
      },
    },
  },
} as const;

export const manifestSchema = {
  type: "object",
  required: ["schemaVersion", "generatedAt", "schemas", "chains"],
  additionalProperties: false,
  properties: {
    schemaVersion: { const: SCHEMA_VERSION },
    generatedAt: { type: "string", format: "date-time" },
    schemas: {
      type: "object",
      required: ["openapi", "manifest", "protocolSnapshot"],
      properties: {
        openapi: { type: "string" },
        manifest: { type: "string" },
        protocolSnapshot: { type: "string" },
      },
    },
    chains: {
      type: "array",
      items: {
        type: "object",
        required: ["chainId", "name", "path", "generatedAt", "recordCounts"],
        properties: {
          chainId: { type: "integer" },
          name: { type: "string" },
          path: { type: "string" },
          generatedAt: { type: "string", format: "date-time" },
          recordCounts: { type: "object" },
        },
      },
    },
    indexingProgress: indexingProgressSchema,
  },
} as const;

export function createOpenApiDocument(): OpenApiDocument {
  const jsonResponse = (schemaRef: string) => ({
    description: "JSON response",
    content: {
      "application/json": {
        schema: { $ref: schemaRef },
      },
    },
  });

  return {
    openapi: "3.1.0",
    info: {
      title: "Protocol Visualizer Snapshot API",
      version: SCHEMA_VERSION,
    },
    paths: {
      "/ready": {
        get: {
          summary: "Readiness check",
          responses: {
            "200": jsonResponse("#/components/schemas/Ready"),
            "503": jsonResponse("#/components/schemas/Error"),
          },
        },
      },
      "/v1/bounds": {
        get: {
          summary: "Published snapshot bounds and indexing progress",
          responses: {
            "200": jsonResponse("#/components/schemas/Bounds"),
          },
        },
      },
      "/v1/manifest": {
        get: {
          summary: "Published snapshot manifest",
          responses: {
            "200": jsonResponse("#/components/schemas/Manifest"),
          },
        },
      },
      "/v1/chains": {
        get: {
          summary: "Supported chains",
          responses: {
            "200": jsonResponse("#/components/schemas/Chains"),
          },
        },
      },
      "/v1/chains/{chainId}/protocol": {
        get: {
          summary: "Protocol snapshot for a chain",
          parameters: [
            {
              name: "chainId",
              in: "path",
              required: true,
              schema: { type: "integer" },
            },
          ],
          responses: {
            "200": jsonResponse("#/components/schemas/ProtocolSnapshot"),
            "404": jsonResponse("#/components/schemas/Error"),
          },
        },
      },
      "/v1/openapi.json": {
        get: {
          summary: "OpenAPI document",
          responses: {
            "200": jsonResponse("#/components/schemas/OpenApi"),
          },
        },
      },
    },
    components: {
      schemas: {
        Ready: {
          type: "object",
          required: ["ok"],
          properties: { ok: { type: "boolean" } },
        },
        Error: {
          type: "object",
          required: ["error"],
          properties: { error: { type: "string" } },
        },
        Bounds: {
          type: "object",
          required: ["data"],
          properties: {
            data: {
              type: "object",
              required: ["generatedAt"],
              properties: {
                generatedAt: { type: "string", format: "date-time" },
                indexingProgress: indexingProgressSchema,
              },
            },
          },
        },
        Manifest: manifestSchema,
        Chains: {
          type: "object",
          required: ["data"],
          properties: {
            data: {
              type: "array",
              items: {
                type: "object",
                required: ["chainId", "name", "path"],
                properties: {
                  chainId: { type: "integer" },
                  name: { type: "string" },
                  path: { type: "string" },
                  generatedAt: { type: "string", format: "date-time" },
                  recordCounts: { type: "object" },
                },
              },
            },
          },
        },
        ProtocolSnapshot: protocolSnapshotSchema,
        OpenApi: { type: "object" },
      },
    },
  };
}
