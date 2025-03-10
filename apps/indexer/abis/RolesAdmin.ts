export const RolesAdminAbi = [
  {
    inputs: [
      { internalType: "contract Kernel", name: "_kernel", type: "address" },
    ],
    stateMutability: "nonpayable",
    type: "constructor",
  },
  {
    inputs: [{ internalType: "address", name: "caller_", type: "address" }],
    name: "KernelAdapter_OnlyKernel",
    type: "error",
  },
  { inputs: [], name: "OnlyAdmin", type: "error" },
  { inputs: [], name: "OnlyNewAdmin", type: "error" },
  {
    inputs: [{ internalType: "Keycode", name: "keycode_", type: "bytes5" }],
    name: "Policy_ModuleDoesNotExist",
    type: "error",
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: "address",
        name: "newAdmin_",
        type: "address",
      },
    ],
    name: "NewAdminPulled",
    type: "event",
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: "address",
        name: "newAdmin_",
        type: "address",
      },
    ],
    name: "NewAdminPushed",
    type: "event",
  },
  {
    inputs: [],
    name: "ROLES",
    outputs: [{ internalType: "contract ROLESv1", name: "", type: "address" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "admin",
    outputs: [{ internalType: "address", name: "", type: "address" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [
      { internalType: "contract Kernel", name: "newKernel_", type: "address" },
    ],
    name: "changeKernel",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [],
    name: "configureDependencies",
    outputs: [
      { internalType: "Keycode[]", name: "dependencies", type: "bytes5[]" },
    ],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [
      { internalType: "bytes32", name: "role_", type: "bytes32" },
      { internalType: "address", name: "wallet_", type: "address" },
    ],
    name: "grantRole",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [],
    name: "isActive",
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
    inputs: [],
    name: "newAdmin",
    outputs: [{ internalType: "address", name: "", type: "address" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "pullNewAdmin",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [{ internalType: "address", name: "newAdmin_", type: "address" }],
    name: "pushNewAdmin",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [],
    name: "requestPermissions",
    outputs: [
      {
        components: [
          { internalType: "Keycode", name: "keycode", type: "bytes5" },
          { internalType: "bytes4", name: "funcSelector", type: "bytes4" },
        ],
        internalType: "struct Permissions[]",
        name: "requests",
        type: "tuple[]",
      },
    ],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [
      { internalType: "bytes32", name: "role_", type: "bytes32" },
      { internalType: "address", name: "wallet_", type: "address" },
    ],
    name: "revokeRole",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
] as const;
