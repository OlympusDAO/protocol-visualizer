export const KernelAbi = [
  { inputs: [], stateMutability: "nonpayable", type: "constructor" },
  {
    inputs: [{ internalType: "Keycode", name: "keycode_", type: "bytes5" }],
    name: "InvalidKeycode",
    type: "error",
  },
  {
    inputs: [{ internalType: "Keycode", name: "module_", type: "bytes5" }],
    name: "Kernel_InvalidModuleUpgrade",
    type: "error",
  },
  {
    inputs: [{ internalType: "Keycode", name: "module_", type: "bytes5" }],
    name: "Kernel_ModuleAlreadyInstalled",
    type: "error",
  },
  {
    inputs: [{ internalType: "address", name: "caller_", type: "address" }],
    name: "Kernel_OnlyExecutor",
    type: "error",
  },
  {
    inputs: [{ internalType: "address", name: "policy_", type: "address" }],
    name: "Kernel_PolicyAlreadyActivated",
    type: "error",
  },
  {
    inputs: [{ internalType: "address", name: "policy_", type: "address" }],
    name: "Kernel_PolicyNotActivated",
    type: "error",
  },
  {
    inputs: [{ internalType: "address", name: "target_", type: "address" }],
    name: "TargetNotAContract",
    type: "error",
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: "enum Actions",
        name: "action_",
        type: "uint8",
      },
      {
        indexed: true,
        internalType: "address",
        name: "target_",
        type: "address",
      },
    ],
    name: "ActionExecuted",
    type: "event",
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: "Keycode",
        name: "keycode_",
        type: "bytes5",
      },
      {
        indexed: true,
        internalType: "contract Policy",
        name: "policy_",
        type: "address",
      },
      {
        indexed: false,
        internalType: "bytes4",
        name: "funcSelector_",
        type: "bytes4",
      },
      {
        indexed: false,
        internalType: "bool",
        name: "granted_",
        type: "bool",
      },
    ],
    name: "PermissionsUpdated",
    type: "event",
  },
  {
    inputs: [{ internalType: "uint256", name: "", type: "uint256" }],
    name: "activePolicies",
    outputs: [{ internalType: "contract Policy", name: "", type: "address" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [{ internalType: "uint256", name: "", type: "uint256" }],
    name: "allKeycodes",
    outputs: [{ internalType: "Keycode", name: "", type: "bytes5" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [
      { internalType: "enum Actions", name: "action_", type: "uint8" },
      { internalType: "address", name: "target_", type: "address" },
    ],
    name: "executeAction",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [],
    name: "executor",
    outputs: [{ internalType: "address", name: "", type: "address" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [
      { internalType: "Keycode", name: "", type: "bytes5" },
      { internalType: "contract Policy", name: "", type: "address" },
    ],
    name: "getDependentIndex",
    outputs: [{ internalType: "uint256", name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [{ internalType: "contract Module", name: "", type: "address" }],
    name: "getKeycodeForModule",
    outputs: [{ internalType: "Keycode", name: "", type: "bytes5" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [{ internalType: "Keycode", name: "", type: "bytes5" }],
    name: "getModuleForKeycode",
    outputs: [{ internalType: "contract Module", name: "", type: "address" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [{ internalType: "contract Policy", name: "", type: "address" }],
    name: "getPolicyIndex",
    outputs: [{ internalType: "uint256", name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [
      {
        internalType: "contract Policy",
        name: "policy_",
        type: "address",
      },
    ],
    name: "isPolicyActive",
    outputs: [{ internalType: "bool", name: "", type: "bool" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [
      { internalType: "Keycode", name: "", type: "bytes5" },
      { internalType: "uint256", name: "", type: "uint256" },
    ],
    name: "moduleDependents",
    outputs: [{ internalType: "contract Policy", name: "", type: "address" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [
      { internalType: "Keycode", name: "", type: "bytes5" },
      { internalType: "contract Policy", name: "", type: "address" },
      { internalType: "bytes4", name: "", type: "bytes4" },
    ],
    name: "modulePermissions",
    outputs: [{ internalType: "bool", name: "", type: "bool" }],
    stateMutability: "view",
    type: "function",
  },
] as const;
