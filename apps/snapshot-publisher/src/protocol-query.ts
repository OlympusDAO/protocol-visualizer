export const PROTOCOL_VISUALIZER_QUERY = `
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
