export enum ChainId {
  Mainnet = 1,
  Arbitrum = 42161,
  Base = 8453,
}

type ChainContractConstants = {
  creationTransactionHash: `0x${string}`;
  creationBlockNumber: number;
  creationTimestamp: number;
  address: `0x${string}`;
};

const KERNEL_CONSTANTS: Record<number, ChainContractConstants> = {
  [ChainId.Mainnet]: {
    creationTransactionHash:
      "0xda3facf1f77124cdf4bddff8fa09221354ad663ec2f8b03dcc4657086ebf5e72",
    creationBlockNumber: 15998125,
    creationTimestamp: 1668790475,
    address: "0x2286d7f9639e8158FaD1169e76d1FbC38247f54b",
  },
  [ChainId.Arbitrum]: {
    creationTransactionHash:
      "0x3f55f2ce3af9f803343c6b3361ccde1cf4853c931c9410ad935586cc3c21519d",
    creationBlockNumber: 85886527,
    creationTimestamp: 1682868260,
    address: "0xeac3eC0CC130f4826715187805d1B50e861F2DaC",
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
  [ChainId.Mainnet]: {
    creationTransactionHash:
      "0xbf00e197abe1961dc9992b29c5471949df1947be69d462ff48bb574aed2fab42",
    creationBlockNumber: 15998132,
    creationTimestamp: 1668789359,
    address: "0x6CAfd730Dc199Df73C16420C4fCAb18E3afbfA59",
  },
  [ChainId.Arbitrum]: {
    creationTransactionHash:
      "0x87fd19b730e0fc2223b0ead36454ac21ac942abdc3162e0abb65983b6f634043",
    creationBlockNumber: 85886592,
    creationTimestamp: 1682868279,
    address: "0xFF5F09D5efE13A9a424F30EC2e1af89D867834d6",
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
  [ChainId.Mainnet]: {
    creationTransactionHash:
      "0xcc820ca2f75e32ae5f98eb861c08d663501878f18b8888983bec07a007da6b78",
    creationBlockNumber: 15998137,
    creationTimestamp: 1668789419,
    address: "0xb216d714d91eeC4F7120a732c11428857C659eC8",
  },
  [ChainId.Arbitrum]: {
    creationTransactionHash:
      "0x266c2c373e058c9f3c9336709f3feade66d62702d7abfc211504da3327cc1e48",
    creationBlockNumber: 85886660,
    creationTimestamp: 1682868296,
    address: "0x69168c08AcF66f002fd02E1B169f38C022c93b70",
  },
};

export const getRolesAdminConstants = (chainId: number) => {
  const constants = ROLES_ADMIN_CONSTANTS[chainId];
  if (!constants) {
    throw new Error(`RolesAdmin constants for chain ${chainId} not found`);
  }

  return constants;
};
