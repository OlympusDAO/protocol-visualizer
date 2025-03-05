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

export default createConfig({
  networks: {
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
      },
    },
  },
});
