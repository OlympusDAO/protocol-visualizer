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
  activeDeployment: {
    generatedAt: string;
  };
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
  const { indexerDeploymentId: _deploymentId, artifacts: _artifacts, ...publicManifest } =
    manifest;
  return publicManifest;
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
              required: ["generatedAt", "activeDeployment"],
              properties: {
                generatedAt: { type: "string", format: "date-time" },
                activeDeployment: {
                  type: "object",
                  required: ["generatedAt"],
                  properties: {
                    generatedAt: { type: "string", format: "date-time" },
                  },
                },
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
