import { createConfig } from 'ponder';
import { http } from 'viem';

import { KernelAbi } from './abis/Kernel';

export default createConfig({
  networks: {
    mainnet: { chainId: 1, transport: http(process.env.PONDER_RPC_URL_1) },
  },
  contracts: {
    Kernel: {
      abi: KernelAbi,
      address: '0x2286d7f9639e8158FaD1169e76d1FbC38247f54b',
      network: 'mainnet',
      startBlock: 15998125,
    },
  },
});
