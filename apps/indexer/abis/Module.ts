export const ModuleAbi = [
  {
    type: 'function',
    name: 'INIT',
    inputs: [],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'KEYCODE',
    inputs: [],
    outputs: [{ name: '', type: 'bytes5', internalType: 'Keycode' }],
    stateMutability: 'pure',
  },
  {
    type: 'function',
    name: 'VERSION',
    inputs: [],
    outputs: [
      { name: 'major', type: 'uint8', internalType: 'uint8' },
      { name: 'minor', type: 'uint8', internalType: 'uint8' },
    ],
    stateMutability: 'pure',
  },
  {
    type: 'function',
    name: 'changeKernel',
    inputs: [
      { name: 'newKernel_', type: 'address', internalType: 'contract Kernel' },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'kernel',
    inputs: [],
    outputs: [{ name: '', type: 'address', internalType: 'contract Kernel' }],
    stateMutability: 'view',
  },
  {
    type: 'error',
    name: 'KernelAdapter_OnlyKernel',
    inputs: [{ name: 'caller_', type: 'address', internalType: 'address' }],
  },
  {
    type: 'error',
    name: 'Module_PolicyNotPermitted',
    inputs: [{ name: 'policy_', type: 'address', internalType: 'address' }],
  },
] as const;
