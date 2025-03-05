import { Chain } from "viem";

type ChainContractConstants = {
  creationTransactionHash: `0x${string}`;
  creationBlockNumber: number;
  creationTimestamp: number;
  address: `0x${string}`;
};

const KERNEL_CONSTANTS: Record<number, ChainContractConstants> = {
  1: {
    creationTransactionHash:
      "0xda3facf1f77124cdf4bddff8fa09221354ad663ec2f8b03dcc4657086ebf5e72",
    creationBlockNumber: 15998125,
    creationTimestamp: 1668790475,
    address: "0x2286d7f9639e8158FaD1169e76d1FbC38247f54b",
  },
};

export const getKernelConstants = (chainId: number) => {
  const constants = KERNEL_CONSTANTS[chainId];
  if (!constants) {
    throw new Error(`Kernel constants for chain ${chainId} not found`);
  }

  return constants;
};

const ROLES_CONSTANTS: Record<number, ChainContractConstants> = {
  1: {
    creationTransactionHash:
      "0xbf00e197abe1961dc9992b29c5471949df1947be69d462ff48bb574aed2fab42",
    creationBlockNumber: 15998132,
    creationTimestamp: 1668789359,
    address: "0x6CAfd730Dc199Df73C16420C4fCAb18E3afbfA59",
  },
};

export const getRolesConstants = (chainId: number) => {
  const constants = ROLES_CONSTANTS[chainId];
  if (!constants) {
    throw new Error(`ROLES constants for chain ${chainId} not found`);
  }

  return constants;
};

const ROLES_ADMIN_CONSTANTS: Record<number, ChainContractConstants> = {
  1: {
    creationTransactionHash:
      "0xcc820ca2f75e32ae5f98eb861c08d663501878f18b8888983bec07a007da6b78",
    creationBlockNumber: 15998137,
    creationTimestamp: 1668789419,
    address: "0xb216d714d91eeC4F7120a732c11428857C659eC8",
  },
};

export const getRolesAdminConstants = (chainId: number) => {
  const constants = ROLES_ADMIN_CONSTANTS[chainId];
  if (!constants) {
    throw new Error(`RolesAdmin constants for chain ${chainId} not found`);
  }

  return constants;
};
