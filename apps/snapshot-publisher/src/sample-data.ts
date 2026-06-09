import type { ProtocolGraphqlData } from "./types.js";

const contractTypes = [
  ["kernel", "KERNEL", "Kernel"],
  ["module", "MODULE", "MINTR: Minter"],
  ["policy", "POLICY", "Operator"],
] as const;

const addressFor = (chainId: number, offset: number) =>
  `0x${chainId.toString(16).padStart(8, "0")}${offset
    .toString(16)
    .padStart(32, "0")}`;

export function getSampleProtocolData(chainId: number): ProtocolGraphqlData {
  const contracts = contractTypes.map(([type, contractType, name], index) => ({
    id: `${chainId}-${type}`,
    chainId,
    address: addressFor(chainId, index + 1),
    lastUpdatedTimestamp: "1700000000",
    lastUpdatedBlockNumber: "1000000",
    name,
    version: type === "kernel" ? "1.0" : null,
    contractType,
    isEnabled: true,
    policyPermissions:
      type === "policy"
        ? [{ keycode: "MINTR", target: addressFor(chainId, 2) }]
        : null,
    policyFunctions:
      type === "policy" ? [{ name: "operate", roles: ["operator"] }] : null,
  }));

  return {
    Contract: contracts,
    Role: [{ id: `${chainId}-operator`, chainId, role: "operator" }],
    RoleAssignment: [
      {
        id: `${chainId}-operator-assignee`,
        chainId,
        role: "operator",
        assignee: addressFor(chainId, 3),
        assigneeName: "Operator Policy",
        lastUpdatedTimestamp: "1700000000",
        lastUpdatedBlockNumber: "1000000",
        isGranted: true,
      },
    ],
  };
}
