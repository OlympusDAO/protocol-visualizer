type ProtocolVisualizerQuery = {
  name: string;
  query: string;
};

export const PROTOCOL_VISUALIZER_QUERIES: ProtocolVisualizerQuery[] = [
  {
    name: "graphql-default",
    query: `
      query ProtocolVisualizerData($chainId: Int!) {
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
