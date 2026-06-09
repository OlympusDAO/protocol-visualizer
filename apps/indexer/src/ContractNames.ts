import { ChainId } from "./constants";

type ContractDetails = {
  name: string;
  type?: "kernel" | "module" | "policy" | "external";
  startBlock?: number;
  /**
   * e.g. "1.1"
   *
   * Stored as a string to avoid precision loss
   */
  version?: string;
};

type ChainContracts = Record<`0x${string}`, ContractDetails>;

type MultiChainContracts = {
  [chainId: number]: ChainContracts;
};

const contractNames: MultiChainContracts = {
  [ChainId.Mainnet]: {
    "0x0374c001204eF5e7E4F5362A5A2430CB6c219326": {
      name: "Operator",
      version: "1.3",
      type: "policy",
    },
    "0x04906695D6D12CF5459975d7C3C03356E4Ccd460": {
      name: "Legacy sOHM",
    },
    "0x0941233c964e7d7Efeb05D253176E5E634cEFfcD": {
      name: "Governor",
    },
    "0x0ab87046fBb341D058F17CBC4c1133F25a20a52f": {
      name: "Legacy gOHM",
    },
    "0x0AE561226896dA978EaDA0Bec4a7d3CfAE04f506": {
      name: "Operator",
      version: "1.4",
      type: "policy",
    },
    "0x0cf30dc0d48604a301df8010cdc028c055336b2e": {
      name: "Policy MS",
    },
    "0x1652b503e0f1cf38b6246ed3b91cb3786bb11656": {
      name: "Heart",
      version: "1.1",
      type: "policy",
    },
    "0x1Ce568DbB34B2631aCDB5B453c3195EA0070EC65": {
      name: "Operator",
      version: "1.1",
      type: "policy",
    },
    "0x1e094fE00E13Fd06D64EeA4FB3cD912893606fE0": {
      name: "Clearinghouse",
      version: "1.2",
      type: "policy",
    },
    // tx: https://etherscan.io/tx/0xda3facf1f77124cdf4bddff8fa09221354ad663ec2f8b03dcc4657086ebf5e72
    "0x2286d7f9639e8158FaD1169e76d1FbC38247f54b": {
      name: "Kernel",
      type: "kernel",
      startBlock: 15998125,
    },
    "0x245cc372C84B3645Bf0Ffe6538620B04a217988B": {
      name: "DAO MS",
    },
    "0x271e35a8555a62F6bA76508E85dfD76D580B0692": {
      name: "YieldRepurchaseFacility",
      version: "1.2",
      type: "policy",
    },
    "0x27e606fdb5C922F8213dC588A434BF7583697866": {
      name: "Distributor",
      type: "policy",
    },
    "0x30A967eB957E5B1eE053B75F1A57ea6bfb2e907E": {
      name: "YieldRepurchaseFacility",
      version: "1.0",
      type: "policy",
    },
    "0x30Ce56e80aA96EbbA1E1a74bC5c0FEB5B0dB4216": {
      name: "CoolerFactory",
    },
    "0x367149cf2d04D3114fFD1Cc6b273222664908D0B": {
      name: "LegacyBurner",
      type: "policy",
    },
    "0x375E06C694B5E50aF8be8FB03495A612eA3e2275": {
      name: "BLREG",
      version: "1.0",
      type: "module",
    },
    "0x399cD3685912bb56aAeD0949119dB6cE5Df60FB5": {
      name: "RANGE",
      version: "2.0",
      type: "module",
    },
    "0x39F6AA3d445e6Dd8eC232c6Bd589889A88E3034d": {
      name: "Heart",
      version: "1.5",
      type: "policy",
    },
    "0x44a7a09ccddb4338e062f1a3849f9a82bdbf2aaa": {
      name: "ZeroDistributor",
    },
    "0x45e563c39cDdbA8699A90078F42353A57509543a": {
      name: "CrossChainBridge",
      type: "policy",
    },
    "0x50f441a3387625bDA8B8081cE3fd6C04CC48C0A2": {
      name: "EmissionManager",
      type: "policy",
    },
    "0x5131654eFCd63f7b797e00118792e0d0dD90B8B0": {
      name: "V1Migrator",
      type: "policy",
      version: "1.0",
    },
    "0x6417F206a0a6628Da136C0Faa39026d0134D2b52": {
      name: "Operator",
      version: "1.5",
      type: "policy",
    },
    "0x64aa3364F17a4D01c6f1751Fd97C2BD3D7e7f1D5": {
      name: "LegacyOHM",
    },
    "0x24b96f2150bf1ed10d3e8b28ed33e392fbb4cad5": {
      name: "CHREG",
      version: "1.0",
      type: "module",
    },
    "0x69a3E97027d21a5984B6a543b36603fFbC6543a4": {
      name: "CHREG",
      version: "1.1",
      type: "module",
    },
    // tx: https://etherscan.io/tx/0xbf00e197abe1961dc9992b29c5471949df1947be69d462ff48bb574aed2fab42
    "0x6CAfd730Dc199Df73C16420C4fCAb18E3afbfA59": {
      name: "ROLES",
      type: "module",
      startBlock: 15998132,
      version: "1.0",
    },
    "0x73df08CE9dcC8d74d22F23282c4d49F13b4c795E": {
      name: "BondCallback",
      version: "1.1",
      type: "policy",
    },
    "0x784cA0C006b8651BAB183829A99fA46BeCe50dBc": {
      name: "LoanConsolidator",
    },
    "0x7fdD4e808ee9608f1b2f05157A2A8098e3D432cD": {
      name: "BLVaultLido",
    },
    "0x89631595649Cc6dEBa249A8012a5b2d88C8ddE48": {
      name: "RGSTY",
      version: "1.0",
      type: "module",
    },
    "0x9229b0b6FA4A58D67Eb465567DaA2c6A34714A75": {
      name: "Emergency",
      type: "policy",
    },
    "0x953EA3223d2dd3c1A91E9D6cca1bf7Af162C9c39": {
      name: "Governance Timelock",
    },
    "0x986b99579BEc7B990331474b66CcDB94Fa2419F5": {
      name: "ReserveMigrator",
      version: "1.0",
      type: "policy",
    },
    "0x9C6220fE829d6FC889cde9b4966D2033C4EfFD48": {
      name: "Heart",
      version: "1.2",
      type: "policy",
    },
    "0xa8687A15D4BE32CC8F0a8a7B9704a4C3993D9613": {
      name: "TRSRY",
      version: "1.0",
      type: "module",
    },
    "0xa8A6ff2606b24F61AFA986381D8991DFcCCd2D55": {
      name: "Emergency MS",
    },
    "0xa90bFe53217da78D900749eb6Ef513ee5b6a491e": {
      name: "MINTR",
      version: "1.0",
      type: "module",
    },
    "0xafe729d57d2CC58978C2e01b4EC39C47FB7C4b23": {
      name: "BLVaultManagerLido",
      type: "policy",
    },
    "0xb212D9584cfc56EFf1117F412Fe0bBdc53673954": {
      name: "RANGE",
      version: "1.0",
      type: "module",
    },
    // tx: https://etherscan.io/tx/0xcc820ca2f75e32ae5f98eb861c08d663501878f18b8888983bec07a007da6b78
    "0xb216d714d91eeC4F7120a732c11428857C659eC8": {
      name: "RolesAdmin",
      type: "policy",
      startBlock: 15998137,
    },
    "0xb37796941cA55b7E4243841930C104Ee325Da5a1": {
      name: "pOLY",
      type: "policy",
    },
    "0xB63cac384247597756545b500253ff8E607a8020": {
      name: "LegacyStaking",
    },
    "0xBA05d48Fb94dC76820EB7ea1B360fd6DfDEabdc5": {
      name: "ContractRegistryAdmin",
      version: "1.0",
      type: "policy",
    },
    "0xbb47C3FFf4eF85703907d3ffca30de278b85df3f": {
      name: "Operator",
      version: "1.0",
      type: "policy",
    },
    "0xbf2b6e99b0e8d4c96b946c182132f5752eaa55c6": {
      name: "BondCallback",
      version: "1.0",
      type: "policy",
    },
    "0xC9518AC915e46D707585116451Dc19c164513Ccf": {
      name: "TreasuryCustodian",
      version: "1.0",
      type: "policy",
    },
    "0xcaA3d3E653A626e2656d2E799564fE952D39d855": {
      name: "YieldRepurchaseFacility",
      version: "1.1",
      type: "policy",
    },
    "0xD5a0Ae3Bf7309416e70cB14399bDd508fE82C658": {
      name: "Heart",
      version: "1.4",
      type: "policy",
    },
    "0xd6a6e8d9e82534bd65821142fccd91ec9cf31880": {
      name: "Clearinghouse",
      version: "1.0",
      type: "policy",
    },
    "0x9ded6a8b099c57bbeb9f81b76400a5a9c63a6880": {
      name: "PRICE",
      version: "1.0",
      type: "module",
    },
    "0xd6C4D723fdadCf0D171eF9A2a3Bfa870675b282f": {
      name: "PRICE",
      version: "1.1",
      type: "module",
    },
    "0xda9fedbcaf319ecf8ab11fe874fb1abfc2181766": {
      name: "pOLY MS",
    },
    "0xdE3F82D378c3b4E3F3f848b8DF501914b3317E96": {
      name: "GovernorDelegate",
      version: "2.0",
    },
    "0xE05646971Ec444f8449d1CA6Fc8D9793986017d5": {
      name: "Heart",
      version: "1.3",
      type: "policy",
    },
    "0xE6343ad0675C9b8D3f32679ae6aDbA0766A2ab4c": {
      name: "Clearinghouse",
      version: "1.1",
      type: "policy",
    },
    "0xeaf46BD21dd9b263F28EEd7260a269fFba9ace6E": {
      name: "Heart",
      version: "1.0",
      type: "policy",
    },
    "0xF451c45C7a26e2248a0EA02382579Eb4858cAdA1": {
      name: "BLVaultManager LUSD",
      type: "policy",
    },
    "0xf577c77ee3578c7F216327F41B5D7221EaD2B2A3": {
      name: "BondManager",
      type: "policy",
    },
    "0xf6D5d06A4e8e6904E4360108749C177692F59E90": {
      name: "PriceConfig",
      type: "policy",
    },
    "0x3019ff96bd8308d1b66846b795e0aeefbdf14ba5": {
      name: "PriceConfig",
      type: "policy",
    },
    "0xf7602C0421c283A2fc113172EBDf64C30F21654D": {
      name: "Heart",
      version: "1.6",
      type: "policy",
    },
    "0xfbB3742628e8D19E0E2d7D8dde208821C09dE960": {
      name: "BLVault LUSD",
    },
    "0x473f86ebfa7ab57c4c82c3592d6147104996c19b": {
      name: "BondCallback",
      type: "policy",
    },
    "0x5f15b91b59ad65d490921016d4134c2301197485": {
      name: "Operator",
      type: "policy",
    },
    "0xdb591Ea2e5Db886dA872654D58f6cc584b68e7cC": {
      name: "CoolerV2",
      version: "1.0",
      type: "policy",
    },
    "0x9ee9f0c2e91E4f6B195B988a9e6e19efcf91e8dc": {
      name: "CoolerV2LtvOracle",
      version: "1.0",
      type: "policy",
    },
    "0xD58d7406E9CE34c90cf849Fc3eed3764EB3779B0": {
      name: "CoolerV2TreasuryBorrower",
      version: "1.0",
      type: "policy",
    },
    "0x6593768feBF9C95aC857Fb7Ef244D5738D1C57Fd": {
      name: "CoolerV2Composites",
      version: "1.0",
    },
    "0xE045BD0A0d85E980AA152064C06EAe6B6aE358D2": {
      name: "CoolerV2Migrator",
      version: "1.0",
    },
    "0xC84157C2306238C9330fEa14774a82A53a127A59": {
      name: "DelegateEscrowFactory",
      version: "1.0",
    },
    "0xD3204Ae00d6599Ba6e182c6D640A79d76CdAad74": {
      name: "DLGTE",
      version: "1.0",
      type: "module",
    },
    "0xFbf6383dC3F6010d403Ecdf12DDC1311701D143D": {
      name: "CCIPCrossChainBridge",
      version: "1.0",
    },
    "0xa5588e518CE5ee0e4628C005E4edAbD5e87de3aD": {
      name: "CCIPLockReleaseTokenPool",
      version: "1.0",
    },
    "0x1a5309f208f161a393e8b5a253de8ab894a67188": {
      name: "Deployer",
    },
    "0x02331A4c97a4841084dF54d7c0eC04DD3f1A9F1c": {
      name: "DEPOS",
      version: "1.0",
      type: "module",
    },
    "0x9c859Dc91DB65bD7375660341231227336dAa134": {
      name: "PositionTokenRenderer",
      version: "1.0",
    },
    "0xD98B5b2E4D5d6Cd554115DE19EfB7A9084BEddd1": {
      name: "ReceiptTokenManager",
      version: "1.0",
    },
    "0xF35193DA8C10e44aF10853Ba5a3a1a6F7529E39a": {
      name: "ConvertibleDepositAuctioneer",
      version: "1.0",
      type: "policy",
    },
    "0xEBDe552D851DD6Dfd3D360C596D3F4aF6e5F9678": {
      name: "ConvertibleDepositFacility",
      version: "1.0",
      type: "policy",
    },
    "0xcb4E21Eb404d80F3e1dB781aAd9AD6A1217fbbf2": {
      name: "DepositManager",
      version: "1.0",
      type: "policy",
    },
    "0x20a3d8510f2e1176E8Db4CeA9883a8287a9029Db": {
      name: "DepositRedemptionVault",
      version: "1.0",
      type: "policy",
    },
    "0xA61b846D5D8b757e3d541E0e4F80390E28f0B6Ff": {
      name: "EmissionManager",
      version: "1.2",
      type: "policy",
    },
    "0x5824850D8A6E46a473445a5AF214C7EbD46c5ECB": {
      name: "Heart",
      version: "1.7",
      type: "policy",
    },
    "0xcA6cd4F0a0033f8C20cF68d6dF277E7001a386f9": {
      name: "ReserveWrapper",
      version: "1.0",
      type: "policy",
    },
    "0x9f08c2603e919a46d6d98289c9ada5250b310558": {
      name: "Burner",
      version: "1.0",
      type: "policy",
    },
    "0xb4f620c39f3ba4a1e7ad264fed6239b0c618db50": {
      name: "EmissionManager",
      version: "1.2",
      type: "policy",
    },
  },
  [ChainId.Arbitrum]: {
    // tx: https://arbiscan.io/tx/0x3f55f2ce3af9f803343c6b3361ccde1cf4853c931c9410ad935586cc3c21519d
    "0xeac3eC0CC130f4826715187805d1B50e861F2DaC": {
      name: "Kernel",
      type: "kernel",
      startBlock: 85886527,
    },
    // tx: https://arbiscan.io/tx/0x87fd19b730e0fc2223b0ead36454ac21ac942abdc3162e0abb65983b6f634043
    "0xFF5F09D5efE13A9a424F30EC2e1af89D867834d6": {
      name: "ROLES",
      type: "module",
      startBlock: 85886592,
      version: "1.0",
    },
    // tx: https://arbiscan.io/tx/0x266c2c373e058c9f3c9336709f3feade66d62702d7abfc211504da3327cc1e48
    "0x69168c08AcF66f002fd02E1B169f38C022c93b70": {
      name: "RolesAdmin",
      type: "policy",
      startBlock: 85886660,
    },
    "0x56db53e9801a6EA080569261b63925E0f1f3C81A": {
      name: "TRSRY",
      version: "1.0",
      type: "module",
    },
    "0x8f6406eDbFA393e327822D4A08BcF15503570D87": {
      name: "MINTR",
      version: "1.0",
      type: "module",
    },
    "0x868C3ae18Fdea85bBb7a303e379c5B7e23b30F03": {
      name: "LENDR",
      version: "1.0",
      type: "module",
    },
    "0x012BBf0481b97170577745D2167ee14f63E2aD4C": {
      name: "DAO MS",
    },
    "0x20B3834091f038Ce04D8686FAC99CA44A0FB285c": {
      name: "CrossChainBridge",
      type: "policy",
    },
    "0xA8578c9A73C2b4F75968EC76d6689045ff68B97C": {
      name: "SiloAMO",
      type: "policy",
    },
    "0x1a5309f208f161a393e8b5a253de8ab894a67188": {
      name: "Deployer",
    },
  },
  [ChainId.Base]: {
    // tx: https://basescan.org/tx/0x005ee16349882fa0b7a31470b2c8049d40bb387c2aeef045b6baa75566d8a39c
    "0x18878Df23e2a36f81e820e4b47b4A40576D3159C": {
      name: "Kernel",
      type: "kernel",
      startBlock: 13204831,
    },
    // tx: https://basescan.org/tx/0x379915686d42077d6a0891f07113c9e4c8574fdb4aec08aa1ea43bd6d471589c
    "0xbC9eE0D911739cBc72cd094ADA26F56E0C49EeAE": {
      name: "ROLES",
      type: "module",
      startBlock: 13204839,
      version: "1.0",
    },
    // tx: https://basescan.org/tx/0xcfd3d8df0c20432e819623d9c230e61d81b321e6f83c8312e3ad949143d9ad7f
    "0xb1fA0Ac44d399b778B14af0AAF4bCF8af3437ad1": {
      name: "RolesAdmin",
      type: "policy",
      startBlock: 13204846,
    },
    // tx: https://berascan.com/tx/0x6b4e1a31a0b528ccb915aaf59e168b70d1952045b1136a510b4b7eb743fd316e
    "0x623164A9Ee2556D524b08f34F1d2389d7B4e1A1C": {
      name: "MINTR",
      version: "1.0",
      type: "module",
    },
    "0x18a390bD45bCc92652b9A91AD51Aed7f1c1358f5": {
      name: "DAO MS",
    },
    "0x22ae99d07584a2ae1af748de573c83f1b9cdb4c0": {
      name: "CrossChainBridge",
      version: "1.0",
      type: "policy",
    },
    "0x6CA1a916e883c7ce2BFBcF59dc70F2c1EF9dac6e": {
      name: "CrossChainBridge",
      version: "1.1",
      type: "policy",
    },
    "0x1a5309f208f161a393e8b5a253de8ab894a67188": {
      name: "Deployer",
    },
  },
  [ChainId.Berachain]: {
    "0x623164A9Ee2556D524b08f34F1d2389d7B4e1A1C": {
      name: "Kernel",
      type: "kernel",
      startBlock: 780016,
    },
    // tx: https://berascan.com/tx/0xb779cc9956dae7860fe1029a1990e2ed708a00ba5e86a6cbf6da524f7593d1ac
    "0x22AE99D07584A2AE1af748De573c83f1B9Cdb4c0": {
      name: "ROLES",
      type: "module",
      startBlock: 780020,
      version: "1.0",
    },
    // tx: https://berascan.com/tx/0xc08d6a98f20fab7b1d5593a7e30b456d38ad9fc1dfea796945a91581ab86f8ab
    "0xe37D9a2791707BBB858012d219960D5FBD190794": {
      name: "RolesAdmin",
      type: "policy",
      startBlock: 780026,
    },
    "0xbC9eE0D911739cBc72cd094ADA26F56E0C49EeAE": {
      name: "MINTR",
      version: "1.0",
      type: "module",
    },
    "0xb1fA0Ac44d399b778B14af0AAF4bCF8af3437ad1": {
      name: "TRSRY",
      version: "1.0",
      type: "module",
    },
    "0x91494D1BC2286343D51c55E46AE80C9356D099b5": {
      name: "DAO MS",
    },
    "0xa5ea62894027D981D34BB99A04BD36B818b2Aaf0": {
      name: "Emergency MS",
    },
    "0xBA42BE149e5260EbA4B82418A6306f55D532eA47": {
      name: "CrossChainBridge",
      version: "1.0",
      type: "policy",
    },
    "0xCA7240A7B439c9D458B47831d38c3d69C1287469": {
      name: "Emergency",
      type: "policy",
    },
    "0x0D33c811D0fcC711BcB388DFB3a152DE445bE66F": {
      name: "TreasuryCustodian",
      type: "policy",
    },
    "0x1a5309f208f161a393e8b5a253de8ab894a67188": {
      name: "Deployer",
    },
  },
  [ChainId.Optimism]: {
    // tx: https://optimistic.etherscan.io/tx/0x5a22cf89858ce51ee163fe3491129499cf692695d71d8f31a5a5b3c7bc52942c
    "0x18878Df23e2a36f81e820e4b47b4A40576D3159C": {
      name: "Kernel",
      type: "kernel",
      startBlock: 98531655,
    },
    // tx: https://optimistic.etherscan.io/tx/0xe079fa214a3da0b608ced55979292dad2b9b8a26e698baf5dac833f6c6583c1b
    "0xbC9eE0D911739cBc72cd094ADA26F56E0C49EeAE": {
      name: "ROLES",
      type: "module",
      startBlock: 98531689,
      version: "1.0",
    },
    // tx: https://optimistic.etherscan.io/tx/0x673a89088e38332f8954eb446ccf8b3c384c7d2a6ef599c2fd2469f71fac4fa8
    "0xb1fA0Ac44d399b778B14af0AAF4bCF8af3437ad1": {
      name: "RolesAdmin",
      type: "policy",
      startBlock: 98531717,
    },
    "0x623164A9Ee2556D524b08f34F1d2389d7B4e1A1C": {
      name: "MINTR",
      version: "1.0",
      type: "module",
    },
    "0x559a14a2219Ae81f9a9f857CF31407de2b07F36c": {
      name: "DAO MS",
      type: "external",
    },
    "0x22AE99D07584A2AE1af748De573c83f1B9Cdb4c0": {
      name: "CrossChainBridge",
      type: "policy",
    },
    "0x1a5309f208f161a393e8b5a253de8ab894a67188": {
      name: "Deployer",
    },
  },
  [ChainId.Sepolia]: {
    "0x1A5309F208f161a393E8b5A253de8Ab894A67188": {
      name: "Deployer",
    },
    "0x784cA0C006b8651BAB183829A99fA46BeCe50dBc": {
      name: "OHM",
      type: "external",
    },
    "0xBA05d48Fb94dC76820EB7ea1B360fd6DfDEabdc5": {
      name: "gOHM",
      type: "external",
    },
    "0x989B93efB6e9d90c2F3632D80EC7c4d1f61D4109": {
      name: "BondCallback",
      type: "policy",
    },
    "0x3024ceabec7e120647ad585bd5836eb13d247de7": {
      name: "CCIPBurnMintTokenPool",
      type: "policy",
    },
    "0x71b8f7c55C799182CC4351a20851A0214baE0ff7": {
      name: "Clearinghouse",
      type: "policy",
    },
    "0x19b787549A05f7a3f8f20ED55B827A6c49BaEE9c": {
      name: "CoolerV2",
      type: "policy",
    },
    "0x1Cb7f32fF640fC4a2A161c3d1f1a188a6670787d": {
      name: "CoolerV2LtvOracle",
      type: "policy",
    },
    "0x74FeAEde88962139f4d36A2f1998BcF56088d519": {
      name: "CoolerV2TreasuryBorrower",
      type: "policy",
    },
    "0x79A0D5eB7ceC7994A74a3Cc050945AA53B9Fc19A": {
      name: "CrossChainBridge",
      type: "policy",
    },
    "0xDB5cb2eba141d9cc4B2d35FBbC4D2b23a88eDA52": {
      name: "Emergency",
      type: "policy",
    },
    "0x9dC1920981Fcf74786C838Bf6f6c3683a8713576": {
      name: "EmissionManager",
      type: "policy",
    },
    "0x556B5fA9f8aa6E38e5E8FB0AD9Cb978bcAf33913": {
      name: "Minter",
      type: "policy",
    },
    "0xad381c116f27f56F8c0853431F4fCD9E9b142aff": {
      name: "Heart",
      type: "policy",
    },
    "0x68009f5e809C5A3438438312F8EEFB9F5C73d534": {
      name: "PriceConfig",
      type: "policy",
    },
    "0xd5405C517631b15C5814fdb7E612ba4c86fC2f75": {
      name: "Operator",
      type: "policy",
    },
    "0x8B92A1dea210B7b7516443b52fdf5Dae677e93b0": {
      name: "ReserveMigrator",
      type: "policy",
    },
    "0x46a01AE30571855FBB5988eEd9D116aa2A3f2377": {
      name: "ReserveWrapper",
      version: "1.0",
      type: "policy",
    },
    // tx: https://sepolia.etherscan.io/tx/0xa9c9f06211b1d471edcd4a0c3ccf621a2396ecc948b5577e854fa0d80cba3327
    "0xf33133E5356B9534e794468dAcD424D11007f1cF": {
      name: "RolesAdmin",
      type: "policy",
      startBlock: 8226374,
    },
    "0xD031777082DD0bFBd7027af34fb306c24e6c3D97": {
      name: "TreasuryCustodian",
      type: "policy",
    },
    "0xf8ABE1D9502BbcaD4576433490D851D03c22A6B4": {
      name: "YieldRepurchaseFacility",
      type: "policy",
    },
    "0x0db48Fa20894273cF6bB559644d63713E98FE67b": {
      name: "ZeroDistributor",
    },
    "0x2C9658b32E59cC4eb5aC90e2A3795C9E7fCaa644": {
      name: "DepositManager",
      version: "1.0",
      type: "policy",
    },
    "0x93AcaDa86ad23C85e96869D46945fA6FFb7a4036": {
      name: "DepositRedemptionVault",
      version: "1.0",
      type: "policy",
    },
    "0x247f1989aDc0F63D07b91Bf645De879b9de06fbB": {
      name: "ConvertibleDepositAuctioneer",
      version: "1.0",
      type: "policy",
    },
    "0x0bE69702E83f06A027E6841B614f6946d1265441": {
      name: "ConvertibleDepositFacility",
      version: "1.0",
      type: "policy",
    },
    "0x1dc2c4E15189a7aa61Eff2b3DD3D5EAe8fA03377": {
      name: "Heart",
      version: "1.7",
      type: "policy",
    },
    "0x84785E392BfD02F97A9b84F85d86DEc11933ef81": {
      name: "EmissionManager",
      version: "1.2",
      type: "policy",
    },
    "0x2364bf0a9aa544039bc12130d3ae167dffbb93a5": {
      name: "DepositManager",
      version: "1.0",
      type: "policy",
    },
    "0x5261fba7b50aa22b19b9edf939b771d109de991f": {
      name: "EmissionManager",
      version: "1.2",
      type: "policy",
    },
    "0x5824850d8a6e46a473445a5af214c7ebd46c5ecb": {
      name: "ConvertibleDepositAuctioneer",
      version: "1.0",
      type: "policy",
    },
    "0x69b2be653bab628116b360818be75a2d97b45c4a": {
      name: "DepositRedemptionVault",
      version: "1.0",
      type: "policy",
    },
    "0x87568265eb6ea27f37613d242d4192b6f6771269": {
      name: "ConvertibleDepositFacility",
      version: "1.0",
      type: "policy",
    },
    "0xa386b4f750f493a6c9f33fbbf8702718b785969a": {
      name: "ReserveWrapper",
      version: "1.0",
      type: "policy",
    },
    "0xa61b846d5d8b757e3d541e0e4f80390e28f0b6ff": {
      name: "Heart",
      version: "1.7",
      type: "policy",
    },
    "0xb4f620c39f3ba4a1e7ad264fed6239b0c618db50": {
      name: "ConvertibleDepositFacility",
      version: "1.0",
      type: "policy",
    },
    "0xc14156af3bf6c11b1c40c8f51f64ba5496870126": {
      name: "ConvertibleDepositAuctioneer",
      version: "1.0",
      type: "policy",
    },
    "0xebde552d851dd6dfd3d360c596d3f4af6e5f9678": {
      name: "DepositManager",
      version: "1.0",
      type: "policy",
    },
    "0xf35193da8c10e44af10853ba5a3a1a6f7529e39a": {
      name: "DepositRedemptionVault",
      version: "1.0",
      type: "policy",
    },
    "0xf6d5d06a4e8e6904e4360108749c177692f59e90": {
      name: "PriceConfig",
      type: "policy",
    },
  },
};

const getContractDetails = (
  address: `0x${string}`,
  chainId: number
): ContractDetails | null => {
  // Convert input address to lowercase for case-insensitive comparison
  const normalizedAddress = address.toLowerCase() as `0x${string}`;
  const chainContracts = contractNames[chainId];

  if (!chainContracts) {
    return null;
  }

  // Find matching contract name by comparing normalized addresses
  const match = Object.entries(chainContracts).find(
    ([addr]) => addr.toLowerCase() === normalizedAddress
  );

  return match ? match[1] : null;
};

const isLikelyModuleName = (name: string): boolean => {
  return /^[A-Z]{5}$/.test(name);
};

export const getContractName = (
  address: `0x${string}`,
  chainId: number
): string => {
  const details = getContractDetails(address, chainId);
  return details?.name ?? "UNKNOWN";
};

export const getContractVersion = (
  address: `0x${string}`,
  chainId: number
): string | null => {
  const details = getContractDetails(address, chainId);
  return details?.version || null;
};

export const getContractType = (
  address: `0x${string}`,
  chainId: number
): ContractDetails["type"] => {
  const details = getContractDetails(address, chainId);

  if (!details) {
    return undefined;
  }

  if (details.type) {
    return details.type;
  }

  if (isLikelyModuleName(details.name)) {
    return "module";
  }

  return undefined;
};

export const getContractStartBlock = (
  address: `0x${string}`,
  chainId: number
): number | undefined => {
  const details = getContractDetails(address, chainId);
  return details?.startBlock;
};
