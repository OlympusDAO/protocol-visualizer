export const PROTOCOL_VISUALIZER_QUERY = `
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
`;
