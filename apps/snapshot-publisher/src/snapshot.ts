import {
  CACHE_CONTROL,
  DEFAULT_PUBLIC_BASE_PATH,
  SCHEMA_VERSION,
} from "./constants.js";
import { PROTOCOL_VISUALIZER_QUERIES } from "./protocol-query.js";
import { manifestSchema, protocolSnapshotSchema } from "./schema.js";
import type {
  ChainConfig,
  Contract,
  EnvioContractType,
  GraphqlContract,
  GraphqlRole,
  GraphqlRoleAssignment,
  Manifest,
  ProtocolGraphqlData,
  ProtocolSnapshot,
  Role,
  RoleAssignment,
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
  now?: Date;
  publicBasePath?: string;
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

const isSchemaFieldError = (errors: Array<{ message: string }>): boolean =>
  errors.some(
    (error) =>
      error.message.includes("field 'contract' not found") ||
      error.message.includes("field 'Contract' not found")
  );

export async function fetchProtocolData(
  hasuraGraphqlUrl: string,
  chainId: number
): Promise<ProtocolGraphqlData> {
  const queryErrors: string[] = [];

  for (const query of PROTOCOL_VISUALIZER_QUERIES) {
    let response: Response;
    try {
      response = await fetch(hasuraGraphqlUrl, {
        method: "POST",
        headers: {
          accept: "application/json",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          query: query.query,
          variables: { chainId },
        }),
      });
    } catch (error) {
      const cause =
        error instanceof Error && error.cause instanceof Error
          ? `: ${error.cause.message}`
          : "";
      throw new Error(
        `Hasura request for chain ${chainId} failed before response${cause}`
      );
    }

    if (!response.ok) {
      throw new Error(
        `Hasura request for chain ${chainId} failed with HTTP ${response.status}`
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

  throw new Error(
    `Hasura request for chain ${chainId} returned schema errors for all query naming modes: ${queryErrors.join(
      " | "
    )}`
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

const createManifest = ({
  generatedAt,
  chains,
  basePath,
}: {
  generatedAt: string;
  chains: ChainSnapshot[];
  basePath: string;
}): Manifest => ({
  schemaVersion: SCHEMA_VERSION,
  generatedAt,
  schemas: {
    manifest: `${basePath}/schemas/manifest-v1.schema.json`,
    protocolSnapshot: `${basePath}/schemas/protocol-snapshot-v1.schema.json`,
  },
  chains: chains.map(({ chain, snapshot }) => ({
    chainId: chain.chainId,
    name: chain.name,
    path: `${basePath}/chain/${chain.chainId}/protocol.json`,
    generatedAt: snapshot.generatedAt,
    recordCounts: snapshot.recordCounts,
  })),
});

const createIndexHtml = ({
  generatedAt,
  manifest,
  basePath,
}: {
  generatedAt: string;
  manifest: Manifest;
  basePath: string;
}) => `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Protocol Visualizer Snapshots</title>
  </head>
  <body>
    <main>
      <h1>Protocol Visualizer Snapshots</h1>
      <p>Generated at ${generatedAt}</p>
      <ul>
        <li><a href="${basePath}/manifest.json">manifest.json</a></li>
        <li><a href="${basePath}/schemas/manifest-v1.schema.json">manifest schema</a></li>
        <li><a href="${basePath}/schemas/protocol-snapshot-v1.schema.json">protocol snapshot schema</a></li>
      </ul>
      <h2>Chains</h2>
      <ul>
        ${manifest.chains
          .map(
            (chain) =>
              `<li><a href="${chain.path}">${chain.name} (${chain.chainId})</a></li>`
          )
          .join("\n        ")}
      </ul>
    </main>
  </body>
</html>
`;

export async function createSnapshotFiles({
  chains,
  loadProtocolData,
  now = new Date(),
  publicBasePath = DEFAULT_PUBLIC_BASE_PATH,
}: CreateSnapshotFilesInput): Promise<SnapshotFile[]> {
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
    chainSnapshots.push({ chain, snapshot });
  }

  const manifest = createManifest({
    generatedAt,
    chains: chainSnapshots,
    basePath,
  });
  const indexHtml = createIndexHtml({ generatedAt, manifest, basePath });

  const files: Omit<SnapshotFile, "key">[] = [
    {
      publicPath: `${basePath}/index.html`,
      contentType: "text/html; charset=utf-8",
      cacheControl: CACHE_CONTROL.index,
      body: indexHtml,
    },
    {
      publicPath: `${basePath}/schemas/manifest-v1.schema.json`,
      contentType: "application/schema+json",
      cacheControl: CACHE_CONTROL.schema,
      body: json(manifestSchema),
    },
    {
      publicPath: `${basePath}/schemas/protocol-snapshot-v1.schema.json`,
      contentType: "application/schema+json",
      cacheControl: CACHE_CONTROL.schema,
      body: json(protocolSnapshotSchema),
    },
    ...chainSnapshots.map(({ chain, snapshot }) => ({
      publicPath: `${basePath}/chain/${chain.chainId}/protocol.json`,
      contentType: "application/json",
      cacheControl: CACHE_CONTROL.protocol,
      body: json(snapshot),
    })),
    {
      publicPath: `${basePath}/manifest.json`,
      contentType: "application/json",
      cacheControl: CACHE_CONTROL.manifest,
      body: json(manifest),
      publishLast: true,
    },
  ];

  return files.map((file) => ({
    ...file,
    key: publicPathToKey(file.publicPath),
  }));
}
