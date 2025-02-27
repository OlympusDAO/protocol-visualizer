export const OlympusRolesAbi = [
  {
    inputs: [
      { internalType: "contract Kernel", name: "kernel_", type: "address" },
    ],
    stateMutability: "nonpayable",
    type: "constructor",
  },
  {
    inputs: [{ internalType: "address", name: "caller_", type: "address" }],
    name: "KernelAdapter_OnlyKernel",
    type: "error",
  },
  {
    inputs: [{ internalType: "address", name: "policy_", type: "address" }],
    name: "Module_PolicyNotPermitted",
    type: "error",
  },
  {
    inputs: [
      { internalType: "address", name: "addr_", type: "address" },
      { internalType: "bytes32", name: "role_", type: "bytes32" },
    ],
    name: "ROLES_AddressAlreadyHasRole",
    type: "error",
  },
  {
    inputs: [
      { internalType: "address", name: "addr_", type: "address" },
      { internalType: "bytes32", name: "role_", type: "bytes32" },
    ],
    name: "ROLES_AddressDoesNotHaveRole",
    type: "error",
  },
  {
    inputs: [{ internalType: "bytes32", name: "role_", type: "bytes32" }],
    name: "ROLES_InvalidRole",
    type: "error",
  },
  {
    inputs: [{ internalType: "bytes32", name: "role_", type: "bytes32" }],
    name: "ROLES_RequireRole",
    type: "error",
  },
  {
    inputs: [{ internalType: "bytes32", name: "role_", type: "bytes32" }],
    name: "ROLES_RoleDoesNotExist",
    type: "error",
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: "bytes32",
        name: "role_",
        type: "bytes32",
      },
      {
        indexed: true,
        internalType: "address",
        name: "addr_",
        type: "address",
      },
    ],
    name: "RoleGranted",
    type: "event",
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: "bytes32",
        name: "role_",
        type: "bytes32",
      },
      {
        indexed: true,
        internalType: "address",
        name: "addr_",
        type: "address",
      },
    ],
    name: "RoleRevoked",
    type: "event",
  },
  {
    inputs: [],
    name: "INIT",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [],
    name: "KEYCODE",
    outputs: [{ internalType: "Keycode", name: "", type: "bytes5" }],
    stateMutability: "pure",
    type: "function",
  },
  {
    inputs: [],
    name: "VERSION",
    outputs: [
      { internalType: "uint8", name: "major", type: "uint8" },
      { internalType: "uint8", name: "minor", type: "uint8" },
    ],
    stateMutability: "pure",
    type: "function",
  },
  {
    inputs: [
      {
        internalType: "contract Kernel",
        name: "newKernel_",
        type: "address",
      },
    ],
    name: "changeKernel",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [{ internalType: "bytes32", name: "role_", type: "bytes32" }],
    name: "ensureValidRole",
    outputs: [],
    stateMutability: "pure",
    type: "function",
  },
  {
    inputs: [
      { internalType: "address", name: "", type: "address" },
      { internalType: "bytes32", name: "", type: "bytes32" },
    ],
    name: "hasRole",
    outputs: [{ internalType: "bool", name: "", type: "bool" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "kernel",
    outputs: [{ internalType: "contract Kernel", name: "", type: "address" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [
      { internalType: "bytes32", name: "role_", type: "bytes32" },
      { internalType: "address", name: "addr_", type: "address" },
    ],
    name: "removeRole",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [
      { internalType: "bytes32", name: "role_", type: "bytes32" },
      { internalType: "address", name: "caller_", type: "address" },
    ],
    name: "requireRole",
    outputs: [],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [
      { internalType: "bytes32", name: "role_", type: "bytes32" },
      { internalType: "address", name: "addr_", type: "address" },
    ],
    name: "saveRole",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
] as const;
