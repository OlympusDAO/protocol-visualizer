export const PolicyAbi = [
  {
    type: "function",
    name: "changeKernel",
    inputs: [
      {
        name: "newKernel_",
        type: "address",
        internalType: "contract Kernel",
      },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "configureDependencies",
    inputs: [],
    outputs: [
      {
        name: "dependencies",
        type: "bytes5[]",
        internalType: "Keycode[]",
      },
    ],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "isActive",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "bool",
        internalType: "bool",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "kernel",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "address",
        internalType: "contract Kernel",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "requestPermissions",
    inputs: [],
    outputs: [
      {
        name: "requests",
        type: "tuple[]",
        internalType: "struct Permissions[]",
        components: [
          {
            name: "keycode",
            type: "bytes5",
            internalType: "Keycode",
          },
          {
            name: "funcSelector",
            type: "bytes4",
            internalType: "bytes4",
          },
        ],
      },
    ],
    stateMutability: "view",
  },
  {
    type: "error",
    name: "KernelAdapter_OnlyKernel",
    inputs: [
      {
        name: "caller_",
        type: "address",
        internalType: "address",
      },
    ],
  },
  {
    type: "error",
    name: "Policy_ModuleDoesNotExist",
    inputs: [
      {
        name: "keycode_",
        type: "bytes5",
        internalType: "Keycode",
      },
    ],
  },
  {
    type: "error",
    name: "Policy_WrongModuleVersion",
    inputs: [
      {
        name: "expected_",
        type: "bytes",
        internalType: "bytes",
      },
    ],
  },
] as const;
