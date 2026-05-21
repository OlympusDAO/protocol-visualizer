type ContractType = "kernel" | "module" | "policy";
type EnvioContractType = "KERNEL" | "MODULE" | "POLICY";

export type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue };

export type Contract = {
  id: string;
  chainId: number;
  address: string;
  lastUpdatedTimestamp: string;
  lastUpdatedBlockNumber: string;
  name: string;
  version?: string | null;
  contractType: EnvioContractType;
  type: ContractType;
  isEnabled: boolean;
  policyPermissions?: JsonValue;
  policyFunctions?: JsonValue;
};

export type Role = {
  id: string;
  chainId: number;
  role: string;
};

export type RoleAssignment = {
  id: string;
  chainId: number;
  role: string;
  assignee: string;
  assigneeName: string;
  lastUpdatedTimestamp: string;
  lastUpdatedBlockNumber: string;
  isGranted: boolean;
};

export type ActionExecutedEvent = {
  id: string;
  chainId: number;
  kernel: string;
  transactionHash: string;
  logIndex: number;
  timestamp: string;
  blockNumber: string;
  action: string;
  target: string;
};

export type ProtocolVisualizerData = {
  contracts: Contract[];
  roles: Role[];
  roleAssignments: RoleAssignment[];
};

type EnvioContract = Omit<Contract, "type">;

type ProtocolVisualizerQueryResult = {
  Contract: EnvioContract[];
  Role: Role[];
  RoleAssignment: RoleAssignment[];
};

type ActionExecutedEventsQueryResult = {
  ActionExecutedEvent: ActionExecutedEvent[];
};

const DEFAULT_ENVIO_GRAPHQL_URL = "http://localhost:8080/v1/graphql";

const PROTOCOL_VISUALIZER_QUERY = `
  query ProtocolVisualizerData($chainId: Int!) {
    Contract(
      where: { chainId: { _eq: $chainId }, isEnabled: { _eq: true } }
      order_by: { name: asc }
    ) {
      id
      chainId
      address
      lastUpdatedTimestamp
      lastUpdatedBlockNumber
      name
      version
      contractType
      isEnabled
      policyPermissions
      policyFunctions
    }
    Role(where: { chainId: { _eq: $chainId } }, order_by: { role: asc }) {
      id
      chainId
      role
    }
    RoleAssignment(
      where: { chainId: { _eq: $chainId }, isGranted: { _eq: true } }
      order_by: { role: asc }
    ) {
      id
      chainId
      role
      assignee
      assigneeName
      lastUpdatedTimestamp
      lastUpdatedBlockNumber
      isGranted
    }
  }
`;

const ACTION_EXECUTED_EVENTS_QUERY = `
  query ActionExecutedEvents {
    ActionExecutedEvent(order_by: { blockNumber: asc }) {
      id
      chainId
      kernel
      transactionHash
      logIndex
      timestamp
      blockNumber
      action
      target
    }
  }
`;

function getEnvioGraphqlUrl(): string {
  const url = import.meta.env.VITE_ENVIO_GRAPHQL_URL;
  if (!url && import.meta.env.PROD) {
    throw new Error("VITE_ENVIO_GRAPHQL_URL is not set");
  }

  return url || DEFAULT_ENVIO_GRAPHQL_URL;
}

async function envioGraphqlRequest<TData>(
  query: string,
  variables?: Record<string, unknown>
): Promise<TData> {
  const response = await fetch(getEnvioGraphqlUrl(), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ query, variables }),
  });

  if (!response.ok) {
    throw new Error(
      `Envio GraphQL request failed with HTTP ${response.status}`
    );
  }

  const payload = (await response.json()) as {
    data?: TData;
    errors?: Array<{ message: string }>;
  };

  if (payload.errors?.length) {
    throw new Error(
      `Envio GraphQL request failed: ${payload.errors
        .map((error) => error.message)
        .join("; ")}`
    );
  }

  if (!payload.data) {
    throw new Error("Envio GraphQL response did not include data");
  }

  return payload.data;
}

function contractTypeToDisplayType(contractType: EnvioContractType): ContractType {
  switch (contractType) {
    case "KERNEL":
      return "kernel";
    case "MODULE":
      return "module";
    case "POLICY":
      return "policy";
  }
}

function mapContract(contract: EnvioContract): Contract {
  return {
    ...contract,
    type: contractTypeToDisplayType(contract.contractType),
  };
}

export async function getProtocolVisualizerData(
  chainId: number
): Promise<ProtocolVisualizerData> {
  const result = await envioGraphqlRequest<ProtocolVisualizerQueryResult>(
    PROTOCOL_VISUALIZER_QUERY,
    { chainId }
  );

  return {
    contracts: result.Contract.map(mapContract),
    roles: result.Role,
    roleAssignments: result.RoleAssignment,
  };
}

export async function getContracts(chainId: number): Promise<Contract[]> {
  return (await getProtocolVisualizerData(chainId)).contracts;
}

export async function getActionExecutedEvents(): Promise<
  ActionExecutedEvent[]
> {
  const result = await envioGraphqlRequest<ActionExecutedEventsQueryResult>(
    ACTION_EXECUTED_EVENTS_QUERY
  );
  return result.ActionExecutedEvent;
}
