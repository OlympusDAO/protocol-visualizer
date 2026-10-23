export const SCHEMA_VERSION = "1.1.0" as const;
export type SnapshotSchemaVersion = "1.0.0" | typeof SCHEMA_VERSION;

export function isSupportedSchemaVersion(
  value: unknown
): value is SnapshotSchemaVersion {
  return value === "1.0.0" || value === SCHEMA_VERSION;
}

export function assertSupportedSchemaVersion(
  value: unknown
): asserts value is SnapshotSchemaVersion {
  if (!isSupportedSchemaVersion(value))
    throw new Error(`Unsupported snapshot schema version: ${String(value)}`);
}

export type BlockObservation = {
  number: string;
  hash: string;
  timestamp: string;
};
export type EventProvenance = BlockObservation & {
  transactionHash: string;
  logIndex: number;
  caller?: string;
  data?: string;
  lastTransitionAt?: string;
};
export type GetterVerification = {
  outcome: "unperformed" | "match" | "mismatch" | "unavailable";
  block?: BlockObservation;
  getterValue?: string;
  reason?: string;
};
export type FunctionContext = {
  signature: string;
  notice?: string;
  details?: string;
  params?: Record<string, string>;
  returns?: Record<string, string>;
  source?: { url: string; codeHash: string; match?: "exact" | "code" };
};
export type AdditionalContract = {
  id: string;
  chainId: number;
  address: string;
  name: string;
  category: "external" | "inactive-core";
  contractType?: "KERNEL" | "MODULE" | "POLICY";
  version?: string | null;
  provenance: { source: "inventory" | "indexer"; startBlock?: number };
};
export type ContractState = {
  id: string;
  chainId: number;
  address: string;
  kernelMembership: "active" | "inactive" | "unknown";
  enablerCapability: "unknown" | "supported" | "unsupported";
  enabled: boolean | null;
  seed?: BlockObservation | null;
  lastChange?: EventProvenance | null;
  indexedThrough?: BlockObservation | null;
  verification: GetterVerification;
  enablementGetter?: string;
  enablementCoverage?: string;
};
export type ContractRelationship = {
  callSelector?: string;
  callSignature?: string;
  id: string;
  chainId: number;
  kind: string;
  source: string;
  target: string | null;
  status: "current" | "pending" | "reference" | "unset";
  scope?: { registry?: string; token?: string } | null;
  provenance: EventProvenance | BlockObservation;
  subject?: string;
  getter?: string;
  value?: string | null;
  seed?: BlockObservation | null;
  lastChange?: EventProvenance | null;
  indexedThrough?: BlockObservation | null;
  verification?: GetterVerification;
  coverage?: string;
  functionContext?: FunctionContext;
  targetCode?: "present" | "absent";
};
export type ChainObservation = {
  chainId: number;
  indexedThrough: BlockObservation;
};
export type PeriodicTask = {
  address: string;
  selector: string;
  signature?: string;
};
export type HeartTasks = {
  id: string;
  chainId: number;
  address: string;
  tasks: PeriodicTask[] | null;
  seed: BlockObservation | null;
  lastChange: EventProvenance | null;
  indexedThrough: BlockObservation | null;
  verification: GetterVerification;
};
export type BridgeRateLimit = {
  isEnabled: boolean;
  capacity: string;
  rate: string;
};
export type BridgeRoute = {
  selector: string;
  routerSupported: boolean | null;
  remoteToken?: string;
  remotePools?: string[];
  outbound?: BridgeRateLimit;
  inbound?: BridgeRateLimit;
  trustedRemote?: string | null;
};
export type BridgeConfiguration = {
  id: string;
  chainId: number;
  address: string;
  kind: "pool" | "bridge";
  configuration: {
    token: string;
    router: string;
    codeHash: string;
    routes: BridgeRoute[];
    /** null means the pool's allowlist is disabled (or this is a bridge). */
    allowList: string[] | null;
  } | null;
  selectors: string[];
  observedAt: BlockObservation | null;
  lastChange: EventProvenance | null;
  verification: GetterVerification;
};
export type SnapshotExtension = {
  bridgeConfigurations?: BridgeConfiguration[];
  periodicTasks?: HeartTasks[];
  additionalContracts?: AdditionalContract[];
  contractStates?: ContractState[];
  relationships?: ContractRelationship[];
  observation?: ChainObservation | null;
};

/** Reader-first rollout: legacy snapshots carry no claim about control state. */
export function readSnapshotData<
  T extends {
    contracts: unknown[];
    roles: unknown[];
    roleAssignments: unknown[];
  },
>(snapshot: {
  schemaVersion: unknown;
  data: T & SnapshotExtension;
}): T & Required<SnapshotExtension> {
  assertSupportedSchemaVersion(snapshot.schemaVersion);
  return {
    ...snapshot.data,
    bridgeConfigurations: snapshot.data.bridgeConfigurations ?? [],
    periodicTasks: snapshot.data.periodicTasks ?? [],
    additionalContracts: snapshot.data.additionalContracts ?? [],
    contractStates: snapshot.data.contractStates ?? [],
    relationships: snapshot.data.relationships ?? [],
    observation: snapshot.data.observation ?? null,
  };
}
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
  schemaVersion: SnapshotSchemaVersion;
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
  _observedAt?: Date
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
    } else if (metricName === "envio_progress_block_time_seconds") {
      timestampByChainId.set(chainId, value);
    }
  }

  const missingChainIds: number[] = [];
  const notReadyChainIds: number[] = [];
  const readyChainIds: number[] = [];
  const progressEntries: Array<[string, ChainIndexingProgress]> = [];

  for (const chain of chains) {
    const readyMetric = readyByChainId.get(chain.chainId);
    const block = blockByChainId.get(chain.chainId);
    const timestamp = timestampByChainId.get(chain.chainId);
    const chainReady =
      readyMetric === 1 &&
      typeof block === "number" &&
      block > 0 &&
      typeof timestamp === "number" &&
      timestamp > 0;
    if (
      readyMetric === undefined ||
      block === undefined ||
      timestamp === undefined
    ) {
      missingChainIds.push(chain.chainId);
    }
    if (!chainReady) {
      notReadyChainIds.push(chain.chainId);
    } else {
      readyChainIds.push(chain.chainId);
    }

    const chainTimestamp = Math.trunc(timestamp ?? 0);

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
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "/v1/schemas/protocol-snapshot-v1.schema.json",
  title: "Protocol Visualizer Protocol Snapshot",
  type: "object",
  additionalProperties: false,
  required: ["schemaVersion", "generatedAt", "chainId", "recordCounts", "data"],
  properties: {
    schemaVersion: { enum: ["1.0.0", SCHEMA_VERSION] },
    generatedAt: { type: "string", format: "date-time" },
    chainId: { type: "integer" },
    recordCounts: {
      type: "object",
      additionalProperties: false,
      required: ["contracts", "roles", "roleAssignments"],
      properties: {
        contracts: { type: "integer", minimum: 0 },
        roles: { type: "integer", minimum: 0 },
        roleAssignments: { type: "integer", minimum: 0 },
      },
    },
    data: {
      type: "object",
      additionalProperties: false,
      required: ["contracts", "roles", "roleAssignments"],
      properties: {
        bridgeConfigurations: {
          type: "array",
          items: { $ref: "#/$defs/bridgeConfiguration" },
        },
        periodicTasks: { type: "array", items: { $ref: "#/$defs/heartTasks" } },
        additionalContracts: {
          type: "array",
          items: { $ref: "#/$defs/additionalContract" },
        },
        contractStates: {
          type: "array",
          items: { $ref: "#/$defs/contractState" },
        },
        relationships: {
          type: "array",
          items: { $ref: "#/$defs/relationship" },
        },
        observation: {
          anyOf: [{ $ref: "#/$defs/observation" }, { type: "null" }],
        },
        contracts: { type: "array", items: { $ref: "#/$defs/contract" } },
        roles: { type: "array", items: { $ref: "#/$defs/role" } },
        roleAssignments: {
          type: "array",
          items: { $ref: "#/$defs/roleAssignment" },
        },
      },
    },
  },
  $defs: {
    bridgeRateLimit: {
      type: "object",
      required: ["isEnabled", "capacity", "rate"],
      additionalProperties: false,
      properties: {
        isEnabled: { type: "boolean" },
        capacity: { type: "string", pattern: "^[0-9]+$" },
        rate: { type: "string", pattern: "^[0-9]+$" },
      },
    },
    bridgeRoute: {
      type: "object",
      required: ["selector", "routerSupported"],
      additionalProperties: false,
      properties: {
        selector: { type: "string", pattern: "^[0-9]+$" },
        routerSupported: { type: ["boolean", "null"] },
        remoteToken: { type: "string" },
        remotePools: { type: "array", items: { type: "string" } },
        outbound: { $ref: "#/$defs/bridgeRateLimit" },
        inbound: { $ref: "#/$defs/bridgeRateLimit" },
        trustedRemote: { type: ["string", "null"] },
      },
    },
    bridgeConfiguration: {
      type: "object",
      required: [
        "id",
        "chainId",
        "address",
        "kind",
        "configuration",
        "selectors",
        "observedAt",
        "lastChange",
        "verification",
      ],
      additionalProperties: false,
      properties: {
        id: { type: "string" },
        chainId: { type: "integer" },
        address: { type: "string", pattern: "^0x[0-9a-f]{40}$" },
        kind: { enum: ["pool", "bridge"] },
        configuration: {
          anyOf: [
            { type: "null" },
            {
              type: "object",
              additionalProperties: false,
              required: ["token", "router", "codeHash", "routes", "allowList"],
              properties: {
                token: { type: "string", pattern: "^0x[0-9a-f]{40}$" },
                router: { type: "string", pattern: "^0x[0-9a-f]{40}$" },
                codeHash: { type: "string", pattern: "^0x[0-9a-f]{64}$" },
                routes: {
                  type: "array",
                  items: { $ref: "#/$defs/bridgeRoute" },
                },
                allowList: {
                  anyOf: [
                    { type: "null" },
                    { type: "array", items: { type: "string" } },
                  ],
                },
              },
            },
          ],
        },
        selectors: {
          type: "array",
          items: { type: "string", pattern: "^[0-9]+$" },
        },
        observedAt: { anyOf: [{ $ref: "#/$defs/block" }, { type: "null" }] },
        lastChange: { anyOf: [{ $ref: "#/$defs/block" }, { type: "null" }] },
        verification: { $ref: "#/$defs/contractState/properties/verification" },
      },
    },
    heartTasks: {
      type: "object",
      required: ["id", "chainId", "address", "tasks", "verification"],
      properties: {
        id: { type: "string" },
        chainId: { type: "integer" },
        address: { type: "string" },
        tasks: {
          anyOf: [
            { type: "null" },
            {
              type: "array",
              items: {
                type: "object",
                required: ["address", "selector"],
                properties: {
                  address: { type: "string" },
                  selector: { type: "string" },
                  signature: { type: "string" },
                },
              },
            },
          ],
        },
        seed: { anyOf: [{ $ref: "#/$defs/block" }, { type: "null" }] },
        lastChange: { anyOf: [{ $ref: "#/$defs/block" }, { type: "null" }] },
        indexedThrough: {
          anyOf: [{ $ref: "#/$defs/block" }, { type: "null" }],
        },
        verification: { $ref: "#/$defs/contractState/properties/verification" },
      },
    },
    block: {
      type: "object",
      required: ["number", "hash", "timestamp"],
      properties: {
        number: { type: "string" },
        hash: { type: "string" },
        timestamp: { type: "string" },
        transactionHash: { type: "string" },
        logIndex: { type: "integer" },
        caller: { type: "string" },
        data: { type: "string" },
        lastTransitionAt: { type: "string" },
      },
    },
    additionalContract: {
      type: "object",
      required: ["id", "chainId", "address", "name", "category", "provenance"],
      properties: {
        id: { type: "string" },
        chainId: { type: "integer" },
        address: { type: "string" },
        name: { type: "string" },
        category: { enum: ["external", "inactive-core"] },
        contractType: { enum: ["KERNEL", "MODULE", "POLICY"] },
        version: { type: ["string", "null"] },
        provenance: {
          type: "object",
          required: ["source"],
          properties: {
            source: { enum: ["inventory", "indexer"] },
            startBlock: { type: "integer" },
          },
        },
      },
    },
    contractState: {
      type: "object",
      required: [
        "id",
        "chainId",
        "address",
        "kernelMembership",
        "enablerCapability",
        "enabled",
        "verification",
      ],
      properties: {
        id: { type: "string" },
        chainId: { type: "integer" },
        address: { type: "string" },
        kernelMembership: { enum: ["active", "inactive", "unknown"] },
        enablerCapability: { enum: ["unknown", "supported", "unsupported"] },
        enablementGetter: { type: "string" },
        enablementCoverage: { type: "string" },
        enabled: { type: ["boolean", "null"] },
        seed: { anyOf: [{ $ref: "#/$defs/block" }, { type: "null" }] },
        lastChange: { anyOf: [{ $ref: "#/$defs/block" }, { type: "null" }] },
        indexedThrough: {
          anyOf: [{ $ref: "#/$defs/block" }, { type: "null" }],
        },
        verification: {
          type: "object",
          required: ["outcome"],
          properties: {
            outcome: {
              enum: ["unperformed", "match", "mismatch", "unavailable"],
            },
            block: { $ref: "#/$defs/block" },
            getterValue: { type: "string" },
            reason: { type: "string" },
          },
        },
      },
    },
    relationship: {
      type: "object",
      required: [
        "id",
        "chainId",
        "kind",
        "source",
        "target",
        "status",
        "provenance",
      ],
      properties: {
        callSignature: { type: "string" },
        callSelector: { type: "string" },
        id: { type: "string" },
        chainId: { type: "integer" },
        kind: { type: "string" },
        source: { type: "string" },
        target: { type: ["string", "null"] },
        status: { enum: ["current", "pending", "reference", "unset"] },
        scope: { type: ["object", "null"] },
        provenance: { $ref: "#/$defs/block" },
        subject: { type: "string" },
        getter: { type: "string" },
        value: { type: ["string", "null"] },
        seed: { anyOf: [{ $ref: "#/$defs/block" }, { type: "null" }] },
        lastChange: { anyOf: [{ $ref: "#/$defs/block" }, { type: "null" }] },
        indexedThrough: {
          anyOf: [{ $ref: "#/$defs/block" }, { type: "null" }],
        },
        verification: { $ref: "#/$defs/contractState/properties/verification" },
        coverage: { type: "string" },
        targetCode: { enum: ["present", "absent"] },
        functionContext: {
          type: "object",
          required: ["signature"],
          properties: {
            signature: { type: "string" },
            notice: { type: "string" },
            details: { type: "string" },
            params: {
              type: "object",
              additionalProperties: { type: "string" },
            },
            returns: {
              type: "object",
              additionalProperties: { type: "string" },
            },
            source: {
              type: "object",
              required: ["url", "codeHash"],
              properties: {
                url: { type: "string" },
                codeHash: { type: "string" },
                match: { enum: ["exact", "code"] },
              },
            },
          },
        },
      },
    },
    observation: {
      type: "object",
      required: ["chainId", "indexedThrough"],
      properties: {
        chainId: { type: "integer" },
        indexedThrough: { $ref: "#/$defs/block" },
      },
    },
    jsonValue: true,
    contract: {
      type: "object",
      additionalProperties: false,
      required: [
        "id",
        "chainId",
        "address",
        "lastUpdatedTimestamp",
        "lastUpdatedBlockNumber",
        "name",
        "contractType",
        "type",
        "isEnabled",
      ],
      properties: {
        id: { type: "string" },
        chainId: { type: "integer" },
        address: { type: "string" },
        lastUpdatedTimestamp: { type: "string" },
        lastUpdatedBlockNumber: { type: "string" },
        name: { type: "string" },
        version: { type: ["string", "null"] },
        contractType: { enum: ["KERNEL", "MODULE", "POLICY"] },
        type: { enum: ["kernel", "module", "policy"] },
        isEnabled: { type: "boolean" },
        policyPermissions: { $ref: "#/$defs/jsonValue" },
        policyFunctions: { $ref: "#/$defs/jsonValue" },
      },
    },
    role: {
      type: "object",
      additionalProperties: false,
      required: ["id", "chainId", "role"],
      properties: {
        id: { type: "string" },
        chainId: { type: "integer" },
        role: { type: "string" },
      },
    },
    roleAssignment: {
      type: "object",
      additionalProperties: false,
      required: [
        "id",
        "chainId",
        "role",
        "assignee",
        "assigneeName",
        "lastUpdatedTimestamp",
        "lastUpdatedBlockNumber",
        "isGranted",
      ],
      properties: {
        id: { type: "string" },
        chainId: { type: "integer" },
        role: { type: "string" },
        assignee: { type: "string" },
        assigneeName: { type: "string" },
        lastUpdatedTimestamp: { type: "string" },
        lastUpdatedBlockNumber: { type: "string" },
        isGranted: { type: "boolean" },
      },
    },
  },
};

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
    schemaVersion: { enum: ["1.0.0", SCHEMA_VERSION] },
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
  const {
    $id: _id,
    $schema: _schema,
    ...snapshotSchema
  } = protocolSnapshotSchema;
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
      "/healthz": {
        get: {
          summary: "Liveness check",
          responses: {
            "200": jsonResponse("#/components/schemas/Ready"),
          },
        },
        head: {
          summary: "Liveness check",
          responses: {
            "200": jsonResponse("#/components/schemas/Ready"),
          },
        },
      },
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
                  environment: {
                    type: "string",
                    enum: ["production", "testnet"],
                  },
                  availability: {
                    type: "string",
                    enum: ["indexed", "historical"],
                  },
                  path: { type: "string" },
                  generatedAt: { type: "string", format: "date-time" },
                  recordCounts: { type: "object" },
                },
              },
            },
          },
        },
        ProtocolSnapshot: JSON.parse(
          JSON.stringify(snapshotSchema)
            .split("#/$defs/")
            .join("#/components/schemas/ProtocolSnapshot/$defs/")
        ),
        OpenApi: { type: "object" },
      },
    },
  };
}
