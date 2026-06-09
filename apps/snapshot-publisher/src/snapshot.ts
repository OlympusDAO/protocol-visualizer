import {
  deploymentArtifactKey,
  type IndexingProgress,
  restProtocolPath,
  type SnapshotManifest,
  SCHEMA_VERSION,
  ACTIVE_MANIFEST_KEY,
  type ChainIndexingProgress,
} from "@protocol-visualizer/snapshot-artifacts";
import { CACHE_CONTROL, DEFAULT_PUBLIC_BASE_PATH } from "./constants.js";
import { describeFetchError, safeUrlForLog } from "./network-errors.js";
import { PROTOCOL_VISUALIZER_QUERIES } from "./protocol-query.js";
import type {
  ChainConfig,
  Contract,
  EnvioContractType,
  GraphqlContract,
  GraphqlRole,
  GraphqlRoleAssignment,
  ProtocolGraphqlData,
  ProtocolSnapshot,
  Role,
  RoleAssignment,
  SnapshotBatch,
  SnapshotFile,
} from "./types.js";

const CONTRACT_TYPE_MAP: Record<EnvioContractType, Contract["type"]> = {
  KERNEL: "kernel",
  MODULE: "module",
  POLICY: "policy",
};

type ChainSnapshot = {
  chain: ChainConfig;
  snapshot: ProtocolSnapshot;
  progress: ChainIndexingProgress;
};

type CreateProtocolSnapshotInput = {
  chainId: number;
  generatedAt: string;
  graphqlData: ProtocolGraphqlData;
};

type CreateSnapshotFilesInput = {
  chains: ChainConfig[];
  loadProtocolData: (
    chainId: number
  ) => Promise<ProtocolGraphqlData> | ProtocolGraphqlData;
  deploymentId?: string;
  now?: Date;
  publicBasePath?: string;
  publicOrigin?: string;
  indexingProgressOverride?: IndexingProgress;
};

const json = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`;

const normalizeBasePath = (basePath = DEFAULT_PUBLIC_BASE_PATH): string => {
  const trimmed = basePath.trim();
  if (!trimmed || trimmed === "/") {
    return "";
  }
  return `/${trimmed.replace(/^\/+|\/+$/g, "")}`;
};

const publicPathToKey = (publicPath: string) => publicPath.replace(/^\/+/, "");

export function parseChainIds(
  value: string | undefined,
  chains: ChainConfig[]
): number[] {
  if (!value) {
    return chains.map((chain) => chain.chainId);
  }

  return value.split(",").map((chainId) => {
    const parsed = Number(chainId.trim());
    if (!Number.isInteger(parsed)) {
      throw new Error(`Invalid chain id: ${chainId}`);
    }
    return parsed;
  });
}

export function selectChains(
  chainIds: number[],
  chains: ChainConfig[]
): ChainConfig[] {
  const supported = new Map(chains.map((chain) => [chain.chainId, chain]));

  return chainIds.map((chainId) => {
    const chain = supported.get(chainId);
    if (!chain) {
      throw new Error(`Unsupported chain id: ${chainId}`);
    }
    return chain;
  });
}

type GraphqlResponse = {
  data?: ProtocolGraphqlData;
  errors?: Array<{ message: string }>;
};

type QueryRootIntrospectionResponse = {
  data?: {
    __schema?: {
      queryType?: {
        fields?: Array<{ name: string }>;
      };
    };
  };
};

const HASURA_FETCH_TIMEOUT_MS = 15_000;

const isSchemaFieldError = (errors: Array<{ message: string }>): boolean =>
  errors.some(
    (error) =>
      error.message.includes("field 'contract' not found") ||
      error.message.includes("field 'Contract' not found")
  );

const fetchHasura = (
  hasuraGraphqlUrl: string,
  init: RequestInit
): Promise<Response> =>
  fetch(hasuraGraphqlUrl, {
    ...init,
    signal: AbortSignal.timeout(HASURA_FETCH_TIMEOUT_MS),
  });

const fetchRelevantQueryRootFields = async (
  hasuraGraphqlUrl: string,
  headers: Record<string, string>
): Promise<string[]> => {
  let response: Response;
  try {
    response = await fetchHasura(hasuraGraphqlUrl, {
      method: "POST",
      headers,
      body: JSON.stringify({
        query: `
          query SnapshotPublisherQueryRootFields {
            __schema {
              queryType {
                fields {
                  name
                }
              }
            }
          }
        `,
      }),
    });
  } catch (error) {
    return [
      `introspection request to ${safeUrlForLog(
        hasuraGraphqlUrl
      )} failed before response: ${describeFetchError(error)}`,
    ];
  }

  if (!response.ok) {
    return [
      `introspection request to ${safeUrlForLog(
        hasuraGraphqlUrl
      )} failed with HTTP ${response.status}`,
    ];
  }

  const payload = (await response.json()) as QueryRootIntrospectionResponse;
  const fields = payload.data?.__schema?.queryType?.fields ?? [];
  return fields
    .map((field) => field.name)
    .filter((name) => /contract|role/i.test(name))
    .sort();
};

export async function fetchProtocolData(
  hasuraGraphqlUrl: string,
  chainId: number,
  adminSecret?: string
): Promise<ProtocolGraphqlData> {
  const queryErrors: string[] = [];
  const headers: Record<string, string> = {
    accept: "application/json",
    "content-type": "application/json",
  };
  if (adminSecret) {
    headers["x-hasura-admin-secret"] = adminSecret;
  }

  for (const query of PROTOCOL_VISUALIZER_QUERIES) {
    let response: Response;
    try {
      response = await fetchHasura(hasuraGraphqlUrl, {
        method: "POST",
        headers,
        body: JSON.stringify({
          query: query.query,
          variables: { chainId },
        }),
      });
    } catch (error) {
      throw new Error(
        `Hasura GraphQL request to ${safeUrlForLog(
          hasuraGraphqlUrl
        )} for chain ${chainId} failed before response: ${describeFetchError(
          error
        )}. Check HASURA_GRAPHQL_URL, hasura PORT, and private networking.`
      );
    }

    if (!response.ok) {
      throw new Error(
        `Hasura GraphQL request to ${safeUrlForLog(
          hasuraGraphqlUrl
        )} for chain ${chainId} failed with HTTP ${response.status}`
      );
    }

    const payload = (await response.json()) as GraphqlResponse;
    if (payload.errors?.length) {
      const messages = payload.errors.map((error) => error.message).join("; ");
      queryErrors.push(`${query.name}: ${messages}`);
      if (isSchemaFieldError(payload.errors)) {
        continue;
      }
      throw new Error(
        `Hasura request for chain ${chainId} returned errors: ${messages}`
      );
    }

    if (!payload.data) {
      throw new Error(`Hasura request for chain ${chainId} returned no data`);
    }

    return payload.data;
  }

  const relevantFields = await fetchRelevantQueryRootFields(
    hasuraGraphqlUrl,
    headers
  );

  throw new Error(
    `Hasura request for chain ${chainId} returned schema errors for all query naming modes: ${queryErrors.join(
      " | "
    )}. Relevant query root fields: ${relevantFields.join(", ") || "none"}`
  );
}

const normalizeTimestamp = (value: unknown): string => {
  if (typeof value === "number" || typeof value === "bigint") {
    return value.toString();
  }
  if (typeof value === "string") {
    return value;
  }
  throw new Error(
    `Expected numeric string timestamp, received ${typeof value}`
  );
};

const normalizeContract = (
  contract: GraphqlContract,
  chainId: number
): Contract => {
  const type = CONTRACT_TYPE_MAP[contract.contractType];
  if (!type) {
    throw new Error(`Unknown contractType: ${contract.contractType}`);
  }

  return {
    id: String(contract.id),
    chainId,
    address: String(contract.address),
    lastUpdatedTimestamp: normalizeTimestamp(contract.lastUpdatedTimestamp),
    lastUpdatedBlockNumber: normalizeTimestamp(contract.lastUpdatedBlockNumber),
    name: String(contract.name),
    version:
      typeof contract.version === "string" || contract.version === null
        ? contract.version
        : null,
    contractType: contract.contractType,
    type,
    isEnabled: Boolean(contract.isEnabled),
    policyPermissions: contract.policyPermissions ?? null,
    policyFunctions: contract.policyFunctions ?? null,
  };
};

const normalizeRole = (role: GraphqlRole, chainId: number): Role => ({
  id: String(role.id),
  chainId,
  role: String(role.role),
});

const normalizeRoleAssignment = (
  assignment: GraphqlRoleAssignment,
  chainId: number
): RoleAssignment => ({
  id: String(assignment.id),
  chainId,
  role: String(assignment.role),
  assignee: String(assignment.assignee),
  assigneeName: String(assignment.assigneeName),
  lastUpdatedTimestamp: normalizeTimestamp(assignment.lastUpdatedTimestamp),
  lastUpdatedBlockNumber: normalizeTimestamp(assignment.lastUpdatedBlockNumber),
  isGranted: Boolean(assignment.isGranted),
});

export function createProtocolSnapshot({
  chainId,
  generatedAt,
  graphqlData,
}: CreateProtocolSnapshotInput): ProtocolSnapshot {
  const contracts = (graphqlData.Contract ?? []).map((contract) =>
    normalizeContract(contract, chainId)
  );
  const roles = (graphqlData.Role ?? []).map((role) =>
    normalizeRole(role, chainId)
  );
  const roleAssignments = (graphqlData.RoleAssignment ?? []).map((assignment) =>
    normalizeRoleAssignment(assignment, chainId)
  );

  return {
    schemaVersion: SCHEMA_VERSION,
    generatedAt,
    chainId,
    recordCounts: {
      contracts: contracts.length,
      roles: roles.length,
      roleAssignments: roleAssignments.length,
    },
    data: {
      contracts,
      roles,
      roleAssignments,
    },
  };
}

export function validateProtocolSnapshot(snapshot: ProtocolSnapshot): string[] {
  const errors: string[] = [];
  if (snapshot.schemaVersion !== SCHEMA_VERSION) {
    errors.push("schemaVersion must be 1.0.0");
  }
  if (!Number.isInteger(snapshot.chainId)) {
    errors.push("chainId must be an integer");
  }
  if (!Number.isInteger(Date.parse(snapshot.generatedAt))) {
    errors.push("generatedAt must be an ISO timestamp");
  }

  const contracts = snapshot.data?.contracts;
  const roles = snapshot.data?.roles;
  const roleAssignments = snapshot.data?.roleAssignments;
  if (!Array.isArray(contracts)) errors.push("data.contracts must be an array");
  if (!Array.isArray(roles)) errors.push("data.roles must be an array");
  if (!Array.isArray(roleAssignments)) {
    errors.push("data.roleAssignments must be an array");
  }

  if (Array.isArray(contracts)) {
    for (const [index, contract] of contracts.entries()) {
      if (contract.chainId !== snapshot.chainId) {
        errors.push(
          `contract ${index} chainId does not match snapshot chainId`
        );
      }
      if (!CONTRACT_TYPE_MAP[contract.contractType]) {
        errors.push(`contract ${index} contractType is invalid`);
      }
      if (CONTRACT_TYPE_MAP[contract.contractType] !== contract.type) {
        errors.push(`contract ${index} type does not match contractType`);
      }
    }
  }

  const expectedCounts = {
    contracts: contracts?.length ?? -1,
    roles: roles?.length ?? -1,
    roleAssignments: roleAssignments?.length ?? -1,
  };
  const countKeys = ["contracts", "roles", "roleAssignments"] as const;
  for (const key of countKeys) {
    const expected = expectedCounts[key];
    if (snapshot.recordCounts?.[key] !== expected) {
      errors.push(`recordCounts.${key} does not match data.${key}.length`);
    }
  }

  return errors;
}

const maxNumericString = (values: string[]): number =>
  values.reduce((max, value) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > max ? parsed : max;
  }, 0);

const progressFromSnapshot = (
  chain: ChainConfig,
  snapshot: ProtocolSnapshot
): ChainIndexingProgress => {
  const timestamps = [
    ...snapshot.data.contracts.map((contract) => contract.lastUpdatedTimestamp),
    ...snapshot.data.roleAssignments.map(
      (assignment) => assignment.lastUpdatedTimestamp
    ),
  ];
  const blocks = [
    ...snapshot.data.contracts.map(
      (contract) => contract.lastUpdatedBlockNumber
    ),
    ...snapshot.data.roleAssignments.map(
      (assignment) => assignment.lastUpdatedBlockNumber
    ),
  ];
  const timestamp = maxNumericString(timestamps);
  const block = maxNumericString(blocks);
  const date =
    timestamp > 0
      ? new Date(timestamp * 1000).toISOString().slice(0, 10)
      : snapshot.generatedAt.slice(0, 10);

  return {
    chainId: chain.chainId,
    date,
    timestamp,
    block,
  };
};

const createManifest = ({
  generatedAt,
  chains,
  basePath,
  deploymentId,
  indexingProgress,
}: {
  generatedAt: string;
  chains: ChainSnapshot[];
  basePath: string;
  deploymentId?: string;
  indexingProgress: IndexingProgress;
}): SnapshotManifest => ({
  schemaVersion: SCHEMA_VERSION,
  generatedAt,
  schemas: {
    openapi: `${basePath}/openapi.json`,
    manifest: `${basePath}/manifest`,
    protocolSnapshot: `${basePath}/chains/{chainId}/protocol`,
  },
  ...(deploymentId ? { indexerDeploymentId: deploymentId } : {}),
  indexingProgress,
  artifacts: deploymentId
    ? Object.fromEntries(
        chains.map(({ chain }) => [
          String(chain.chainId),
          deploymentArtifactKey(deploymentId, chain.chainId),
        ])
      )
    : undefined,
  chains: chains.map(({ chain, snapshot }) => ({
    chainId: chain.chainId,
    name: chain.name,
    path: restProtocolPath(chain.chainId),
    generatedAt: snapshot.generatedAt,
    recordCounts: snapshot.recordCounts,
  })),
});

export async function createSnapshotBatch({
  chains,
  loadProtocolData,
  deploymentId,
  now = new Date(),
  publicBasePath = DEFAULT_PUBLIC_BASE_PATH,
  indexingProgressOverride,
}: CreateSnapshotFilesInput): Promise<SnapshotBatch> {
  const generatedAt = now.toISOString();
  const basePath = normalizeBasePath(publicBasePath);
  const chainSnapshots: ChainSnapshot[] = [];

  for (const chain of chains) {
    const graphqlData = await loadProtocolData(chain.chainId);
    const snapshot = createProtocolSnapshot({
      chainId: chain.chainId,
      generatedAt,
      graphqlData,
    });
    const errors = validateProtocolSnapshot(snapshot);
    if (errors.length > 0) {
      throw new Error(
        `Protocol snapshot for chain ${chain.chainId} is invalid: ${errors.join(
          "; "
        )}`
      );
    }
    chainSnapshots.push({
      chain,
      snapshot,
      progress: progressFromSnapshot(chain, snapshot),
    });
  }

  const indexingProgress: IndexingProgress = indexingProgressOverride ?? {
    chains: Object.fromEntries(
      chainSnapshots.map(({ chain, progress }) => [chain.key, progress])
    ),
  };
  const ready = chainSnapshots.every(
    ({ snapshot, progress }) =>
      snapshot.recordCounts.contracts +
        snapshot.recordCounts.roles +
        snapshot.recordCounts.roleAssignments >
        0 &&
      progress.block > 0 &&
      progress.timestamp > 0
  );

  const manifest = createManifest({
    generatedAt,
    chains: chainSnapshots,
    basePath,
    deploymentId,
    indexingProgress,
  });

  const files: SnapshotFile[] = [
    ...chainSnapshots.map(({ chain, snapshot }) => ({
      publicPath: restProtocolPath(chain.chainId),
      key: deploymentId
        ? deploymentArtifactKey(deploymentId, chain.chainId)
        : publicPathToKey(`${basePath}/chain/${chain.chainId}/protocol.json`),
      contentType: "application/json",
      cacheControl: CACHE_CONTROL.protocol,
      body: json(snapshot),
    })),
    {
      publicPath: `${basePath}/manifest`,
      key: ACTIVE_MANIFEST_KEY,
      contentType: "application/json",
      cacheControl: CACHE_CONTROL.manifest,
      body: json(manifest),
      publishLast: true,
    },
  ];

  return { files, manifest, indexingProgress, ready };
}

export async function createSnapshotFiles(
  input: CreateSnapshotFilesInput
): Promise<SnapshotFile[]> {
  return (await createSnapshotBatch(input)).files;
}
