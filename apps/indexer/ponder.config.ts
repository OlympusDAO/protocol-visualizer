import { createConfig } from "ponder";
import { http } from "viem";

import { KernelAbi } from "./abis/Kernel";
import { OlympusRolesAbi } from "./abis/OlympusRoles";
import { RolesAdminAbi } from "./abis/RolesAdmin";
import {
  ChainId,
  getKernelConstants,
  getRolesAdminConstants,
  getRolesConstants,
} from "./src/constants";

const mainnetKernel = getKernelConstants(ChainId.Mainnet);
const mainnetRoles = getRolesConstants(ChainId.Mainnet);
const mainnetRolesAdmin = getRolesAdminConstants(ChainId.Mainnet);

const arbitrumKernel = getKernelConstants(ChainId.Arbitrum);
const arbitrumRoles = getRolesConstants(ChainId.Arbitrum);
const arbitrumRolesAdmin = getRolesAdminConstants(ChainId.Arbitrum);

const baseKernel = getKernelConstants(ChainId.Base);
const baseRoles = getRolesConstants(ChainId.Base);
const baseRolesAdmin = getRolesAdminConstants(ChainId.Base);

const berachainKernel = getKernelConstants(ChainId.Berachain);
const berachainRoles = getRolesConstants(ChainId.Berachain);
const berachainRolesAdmin = getRolesAdminConstants(ChainId.Berachain);

const optimismKernel = getKernelConstants(ChainId.Optimism);
const optimismRoles = getRolesConstants(ChainId.Optimism);
const optimismRolesAdmin = getRolesAdminConstants(ChainId.Optimism);

const sepoliaKernel = getKernelConstants(ChainId.Sepolia);
const sepoliaRoles = getRolesConstants(ChainId.Sepolia);
const sepoliaRolesAdmin = getRolesAdminConstants(ChainId.Sepolia);

export default createConfig({
  ordering: "multichain",
  networks: {
    // Production chains
    mainnet: {
      chainId: ChainId.Mainnet,
      transport: http(process.env.PONDER_RPC_URL_1),
    },
    arbitrum: {
      chainId: ChainId.Arbitrum,
      transport: http(process.env.PONDER_RPC_URL_42161),
    },
    base: {
      chainId: ChainId.Base,
      transport: http(process.env.PONDER_RPC_URL_8453),
    },
    berachain: {
      chainId: ChainId.Berachain,
      transport: http(process.env.PONDER_RPC_URL_80094),
    },
    optimism: {
      chainId: ChainId.Optimism,
      transport: http(process.env.PONDER_RPC_URL_10),
    },
    // Testnets
    sepolia: {
      chainId: ChainId.Sepolia,
      transport: http(process.env.PONDER_RPC_URL_11155111),
    },
  },
  contracts: {
    Kernel: {
      abi: KernelAbi,
      network: {
        mainnet: {
          address: mainnetKernel.address,
          startBlock: mainnetKernel.creationBlockNumber,
        },
        arbitrum: {
          address: arbitrumKernel.address,
          startBlock: arbitrumKernel.creationBlockNumber,
        },
        base: {
          address: baseKernel.address,
          startBlock: baseKernel.creationBlockNumber,
        },
        berachain: {
          address: berachainKernel.address,
          startBlock: berachainKernel.creationBlockNumber,
        },
        optimism: {
          address: optimismKernel.address,
          startBlock: optimismKernel.creationBlockNumber,
        },
        sepolia: {
          address: sepoliaKernel.address,
          startBlock: sepoliaKernel.creationBlockNumber,
        },
      },
    },
    ROLES: {
      abi: OlympusRolesAbi,
      network: {
        mainnet: {
          address: mainnetRoles.address,
          startBlock: mainnetRoles.creationBlockNumber,
        },
        arbitrum: {
          address: arbitrumRoles.address,
          startBlock: arbitrumRoles.creationBlockNumber,
        },
        base: {
          address: baseRoles.address,
          startBlock: baseRoles.creationBlockNumber,
        },
        berachain: {
          address: berachainRoles.address,
          startBlock: berachainRoles.creationBlockNumber,
        },
        optimism: {
          address: optimismRoles.address,
          startBlock: optimismRoles.creationBlockNumber,
        },
        sepolia: {
          address: sepoliaRoles.address,
          startBlock: sepoliaRoles.creationBlockNumber,
        },
      },
    },
    RolesAdmin: {
      abi: RolesAdminAbi,
      network: {
        mainnet: {
          address: mainnetRolesAdmin.address,
          startBlock: mainnetRolesAdmin.creationBlockNumber,
        },
        arbitrum: {
          address: arbitrumRolesAdmin.address,
          startBlock: arbitrumRolesAdmin.creationBlockNumber,
        },
        base: {
          address: baseRolesAdmin.address,
          startBlock: baseRolesAdmin.creationBlockNumber,
        },
        berachain: {
          address: berachainRolesAdmin.address,
          startBlock: berachainRolesAdmin.creationBlockNumber,
        },
        optimism: {
          address: optimismRolesAdmin.address,
          startBlock: optimismRolesAdmin.creationBlockNumber,
        },
        sepolia: {
          address: sepoliaRolesAdmin.address,
          startBlock: sepoliaRolesAdmin.creationBlockNumber,
        },
      },
    },
  },
});
