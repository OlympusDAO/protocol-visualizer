type ProtocolVisualizerQuery = {
  name: string;
  query: string;
};

export const PROTOCOL_VISUALIZER_QUERIES: ProtocolVisualizerQuery[] = [
  {
    name: "graphql-default",
    query: `
      query ProtocolVisualizerData($chainId: Int!) {
        KnownContract: contract(where: { chainId: { _eq: $chainId } }, orderBy: { name: asc }) { address name version contractType isEnabled }
        ContractState: contractState(where: { chainId: { _eq: $chainId } }) { id chainId address enablerCapability enabled seed lastChange indexedThrough verification }
        ContractRelationship: contractRelationship(where: { chainId: { _eq: $chainId } }) { id chainId kind source target status scope provenance subject getter value seed lastChange indexedThrough verification coverage functionContext targetCode }
        ChainObservation: chainObservation(where: { chainId: { _eq: $chainId } }) { chainId indexedThrough }
        Contract: contract(
          where: { chainId: { _eq: $chainId }, isEnabled: { _eq: true } }
          orderBy: { name: asc }
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
        Role: role(where: { chainId: { _eq: $chainId } }, orderBy: { role: asc }) {
          id
          chainId
          role
        }
        RoleAssignment: roleAssignment(
          where: { chainId: { _eq: $chainId }, isGranted: { _eq: true } }
          orderBy: { role: asc }
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
    `,
  },
  {
    name: "hasura-default",
    query: `
      query ProtocolVisualizerData($chainId: Int!) {
        KnownContract: Contract(where: { chainId: { _eq: $chainId } }, order_by: { name: asc }) { address name version contractType isEnabled }
        ContractState: ContractState(where: { chainId: { _eq: $chainId } }) { id chainId address enablerCapability enabled seed lastChange indexedThrough verification }
        ContractRelationship: ContractRelationship(where: { chainId: { _eq: $chainId } }) { id chainId kind source target status scope provenance subject getter value seed lastChange indexedThrough verification coverage functionContext targetCode }
        ChainObservation: ChainObservation(where: { chainId: { _eq: $chainId } }) { chainId indexedThrough }
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
    `,
  },
];
