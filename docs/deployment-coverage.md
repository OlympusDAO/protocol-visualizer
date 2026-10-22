# Deployment coverage

Source comparison: Olympus V3 Robinhood `a48ec8281b51db9136fbd6a8fd24d1b65cf2a929`, CCIP `e4034d5850bd0969983e3fc46c8405a4c9bc25c2`, and primary `8462498ac39772c53120cb8159f5a356d378471f`.

## IEnabler capabilities and replay boundaries

The IEnabler subscriptions cover 69 verified implementations. Creation anchors remain in the existing core address book and additional-contract list. Capability and dialect come from verified ABI function metadata: `isEnabled()` establishes support, and `lastTransitionAt()` identifies V2. A complete verified ABI without `isEnabled()` is unsupported. An unavailable call does not prove absence.

Seven additional periphery deployments use the verified `CoolerComposites`, `CoolerV2Migrator`, and `CCIPCrossChainBridge` source ABIs. The two Cooler implementations expose IEnabler without ERC165; no interface probe is required. Their legacy `Enabled()` and `Disabled()` logs assign state. Source `EnablerV2.sol` emits a legacy log followed by `Transition(address,bool,bytes,uint48)`, so V2 subscriptions process only `Transition`. Multiple transitions in one transaction remain separate by log index. Caller, payload, and `lastTransitionAt` remain attached to the transition.

Archive checks found code at all 69 creation blocks, no code at the preceding block, and a successful hash-bound `isEnabled()` read at each chain's comparison block below. For 38 addresses, creation receipts independently matched successful status, address, and block hash. Other entries retain their earlier deployment evidence with the fresh code-boundary check. These are capability and anchor checks; they do not replace an event replay.

| Chain | Legacy | V2 | Pinned getter comparison block |
| --- | ---: | ---: | ---: |
| Ethereum (1) | 15 | 2 | 26246707 |
| Optimism (10) | 2 | 2 | 158528364 |
| Robinhood (4663) | 2 | 2 | 94951973 |
| Base (8453) | 2 | 2 | 52933079 |
| Arbitrum (42161) | 2 | 2 | 517163908 |
| Berachain (80094) | 2 | 2 | 27820285 |
| Base Sepolia (84532) | 2 | 0 | 48667686 |
| Arbitrum Sepolia (421614) | 0 | 3 | 321660483 |
| Sepolia (11155111) | 27 | 0 | 11968102 |

The additional receipt sources are `broadcast/DeployV2.sol/1/run-1746515932.json`; `broadcast/DeployV2.sol/11155111/run-1746018785.json` and `run-1757579486838.json`; and these `broadcast/DeployV3.s.sol` runs:

- Ethereum: `run-1762519979550.json`, `run-1762527193097.json`, `run-1763455275960.json`, `run-1770897446914.json`.
- Sepolia: `run-1747831755.json`, `run-1756119151300.json`, `run-1756289976118.json`, `run-1757577000241.json`, `run-1762501753186.json`, `run-1762502461771.json`.
- Base Sepolia: `run-1749035627.json`.

Explorer creation records supplied the remaining missing PriceConfig (Ethereum, block 25330340), EmissionManager (Sepolia, block 10279234), and CCIPCrossChainBridge (Base Sepolia) anchors; archive code boundaries were checked independently.

Seeds run at the end of each creation block, after constructor logs. A replay starting later seeds at its configured start, after that block's events. Existing event state wins over a seed. Completed checkpoints verify at 10,000-block intervals during historical replay, 100-block intervals while realtime indexing is active, and the exact configured end block. Hash-bound getter effects never substitute latest state. A failed comparison preserves indexed state; a mismatch preserves the indexed badge and exposes the differing getter value and comparison block. Last transition, completed coverage, and publication time remain separate.

Synthetic sample snapshots demonstrate a Kernel-active policy with IEnabler disabled. They do not assert that a production bridge or its linked contracts are operational.

Production event checks fetched all enablement logs for these 69 addresses from their creation anchors through the pinned comparison blocks above. Replaying 52 raw logs produced 50 logical transitions; duplicate delivery added no rows. Every final state matched its hash-bound getter. This helper replay complements full Envio/PostgreSQL runs for Mainnet and Robinhood: Mainnet had 17 observed implementations and 17 transitions; Robinhood had four implementations and no enablement transitions. Both runs matched every final getter at their comparison block.

A separate local Anvil run used the production event registrations. Constructor logs and contracts without logs established the correct state. Legacy and V2 calls with two transitions each produced two logical transitions per transaction. A reorg removed six orphaned transitions and restored the previous states; all three contracts matched getters at replacement block 101. This uses local transactions only.

Browser inspection verified an open, selected contract changed from enabled to disabled after a new snapshot, retaining its selection and node positions. Mutable snapshot requests revalidate the HTTP cache. Mainnet inspection found 119 unique rendered node IDs; repeated contract names refer to distinct deployment addresses, with versions retained. Inactive core contracts keep their module or policy colors.

The Robinhood and CCIP branches agree on current and previous deployments for all six existing visualizer chains. The primary checkout agrees where entries overlap, but lacks recent CCIP deployments. Successful creation receipts support those additions. Desired `config` values and zero addresses are excluded.

Core labels remain in `apps/indexer/src/ContractNames.ts`. The short `packages/protocol-config/other-contracts.json` list contains only additional contracts needed for enablement, ownership, authority, and CCIP views. It is not a mirror of the Olympus environment file. Existing historical aliases remain intact.

| Chain | New core/actor labels | Event coverage |
| --- | ---: | --- |
| Ethereum (1) | 4 | Kernel `ActionExecuted`; ROLES and RolesAdmin retain their explicit subscriptions |
| Optimism (10) | 3 | Kernel `ActionExecuted`; ROLES and RolesAdmin retain their explicit subscriptions |
| Arbitrum (42161) | 3 | Kernel `ActionExecuted`; ROLES and RolesAdmin retain their explicit subscriptions |
| Base (8453) | 3 | Kernel `ActionExecuted`; ROLES and RolesAdmin retain their explicit subscriptions |
| Berachain (80094) | 3 | Kernel `ActionExecuted`; ROLES and RolesAdmin retain their explicit subscriptions |
| Sepolia (11155111) | 14 | Kernel `ActionExecuted`; ROLES and RolesAdmin retain their explicit subscriptions |
| Robinhood (4663) | 12 | Kernel `ActionExecuted`; ROLES and RolesAdmin retain their explicit subscriptions |

All six existing Kernel, ROLES, and RolesAdmin anchors match the selected source. Sepolia needed current core labels, not replacement anchors. New modules and policies are discovered when Kernel events install or activate them. External contracts do not acquire Kernel membership from their presence in the list. Their indexed control state and display are covered by later milestones.

## Robinhood receipt evidence

Source: `broadcast/L2Deploy.s.sol/4663/run-1792574052101.json`, deployment revision `736545186f`. Every row below is a successful creation receipt. The environment entries agree with these addresses. Block timestamps for the three core anchors were read from an archive RPC at the recorded heights.

| Contract | Address | Block | Transaction |
| --- | --- | ---: | --- |
| Kernel | `0x02331a4c97a4841084df54d7c0ec04dd3f1a9f1c` | 94168504 | `0xd85c0f9ffa9910d4a94b0ef01b7de1d472ec3f33525a97b5e36450d3ced9dc99` |
| TRSRY | `0x20a3d8510f2e1176e8db4cea9883a8287a9029db` | 94168648 | `0x88ff859063a90d32fe5c268ebe732b2dc72894f46718fc12a3edb098648af93d` |
| CCIPCrossChainBridge | `0x5261fba7b50aa22b19b9edf939b771d109de991f` | 94169198 | `0x3e1b6596cadc9447ad7cf7643dd0c16c9142973ad8c3791c13c8143d12de6e20` |
| CCIPBurnMintTokenPool | `0x5824850d8a6e46a473445a5af214c7ebd46c5ecb` | 94169097 | `0xa26199f6bf4ebe583915932579867f83a0c9e04612817ffa973ad8d6ed187298` |
| CCIPTokenPoolConfig | `0x6d94b3745b0ecf908b3b467907b947b43fba5f15` | 94169625 | `0xcac0d434ce78cdfddf7489a76b1373c5f8cf486c6a762e255489ee87aed4dc79` |
| OHM | `0x9c859dc91db65bd7375660341231227336daa134` | 94168423 | `0x6a8e84cd4f77fa130cacb43fd7a292972abad5f28f2dc6b3c6fba634b9f4e219` |
| CCIPTokenPoolConfigTimelock | `0x9f08c2603e919a46d6d98289c9ada5250b310558` | 94169693 | `0x242621612198647d088694839f2935a5553e6b77bbd1e698df58bc359c1df8b3` |
| TreasuryCustodian | `0xb4f620c39f3ba4a1e7ad264fed6239b0c618db50` | 94168987 | `0x91f37d93aef0f7365900737890250694317d0c282462de617d0d1336e5c4bcea` |
| OlympusAuthority | `0xca6cd4f0a0033f8c20cf68d6df277e7001a386f9` | 94168343 | `0x503ee15bee4215532234eadecbc91a93fac17040ed7defc873dac3e9bf4eea4b` |
| ROLES | `0xcb4e21eb404d80f3e1db781aad9ad6a1217fbbf2` | 94168602 | `0x442a153c3d82fd0449e239dd2dce08e55d26e1a07d90dfd165088ec60af7db3d` |
| MINTR | `0xd98b5b2e4d5d6cd554115de19efb7a9084beddd1` | 94168555 | `0x8f0793659bd23a6292202fe79e57b529099169157243e8ccc84126adb272fab8` |
| RolesAdmin | `0xebde552d851dd6dfd3d360c596d3f4af6e5f9678` | 94168691 | `0x88b12105ca02e377d460d82667e0c624b56fe78103e88f937ee5665c6409e507` |
| Emergency | `0xf35193da8c10e44af10853ba5a3a1a6f7529e39a` | 94168742 | `0x5b3d8d7c9c375c7d3cdec955606aef39cc2aaac3e7a6df2fb5ee1fadfc510d4c` |

Kernel timestamp: `1792573917`; ROLES: `1792573927`; RolesAdmin: `1792573936`. The broadcast artifact timestamp is not used as a block timestamp.

Robinhood ABI/function metadata was generated from local Foundry artifacts. Artifact source hashes were checked against their files, and the relevant source was checked against the deployment revision. The dependency profile can change optimized bytecode without changing these ABIs. No staking or LayerZero deployment was invented.

## Existing-chain receipt evidence

| Chain | Contract | Block | Receipt file |
| --- | --- | ---: | --- |
| 1 | CCIPTokenPoolConfig | 26232434 | `broadcast/DeployV3.s.sol/1/run-1792482964496.json` |
| 1 | CCIPTokenPoolConfigTimelock | 26232436 | `broadcast/DeployV3.s.sol/1/run-1792482964496.json` |
| 10 | CCIPTokenPoolConfig | 158442676 | `broadcast/DeployV3.s.sol/10/run-1792484170718.json` |
| 10 | CCIPBurnMintTokenPool | 158442667 | `broadcast/DeployV3.s.sol/10/run-1792484170718.json` |
| 10 | CCIPTokenPoolConfigTimelock | 158442680 | `broadcast/DeployV3.s.sol/10/run-1792484170718.json` |
| 8453 | CCIPBurnMintTokenPool | 52847117 | `broadcast/DeployV3.s.sol/8453/run-1792483652975.json` |
| 8453 | CCIPTokenPoolConfigTimelock | 52847137 | `broadcast/DeployV3.s.sol/8453/run-1792483652975.json` |
| 8453 | CCIPTokenPoolConfig | 52847128 | `broadcast/DeployV3.s.sol/8453/run-1792483652975.json` |
| 42161 | CCIPTokenPoolConfigTimelock | 516537754 | `broadcast/DeployV3.s.sol/42161/run-1792483442046.json` |
| 42161 | CCIPTokenPoolConfig | 516537728 | `broadcast/DeployV3.s.sol/42161/run-1792483442046.json` |
| 42161 | CCIPBurnMintTokenPool | 516537665 | `broadcast/DeployV3.s.sol/42161/run-1792483442046.json` |
| 80094 | CCIPTokenPoolConfigTimelock | 27734771 | `broadcast/DeployV3.s.sol/80094/run-1792484297207.json` |
| 80094 | CCIPTokenPoolConfig | 27734765 | `broadcast/DeployV3.s.sol/80094/run-1792484297207.json` |
| 80094 | CCIPBurnMintTokenPool | 27734756 | `broadcast/DeployV3.s.sol/80094/run-1792484297207.json` |
| 11155111 | CCIPBurnMintTokenPool | 8375032 | `broadcast/DeployV3.s.sol/11155111/run-1747831755.json` |

## Local replay evidence

Robinhood was replayed through Envio 3.14.1, Postgres, and Hasura from block `94168504` through `94170000`. Ten named core contracts were indexed: Kernel; MINTR, ROLES, TRSRY; RolesAdmin, Emergency, TreasuryCustodian; CCIPBurnMintTokenPool, CCIPTokenPoolConfig, and its timelock. An archive-provider replay completed with zero latest-state fallbacks. The publisher generated a validated real Hasura snapshot containing those ten contracts. Its deployment-window boundary is not a claim of current chain-head coverage.

Other-contract completeness, event-derived enablement/ownership, and live getter verification belong to the later milestones. Sample snapshot generation alone does not establish chain coverage.

| Chain | Replay range | Observed result |
| --- | --- | --- |
| Ethereum | 26232434–26246474 | Kernel and both new config policies indexed; real snapshot has 3 contracts |
| Optimism | 158442667–158526532 | No Kernel actions in this deployment window; all three new CCIP policies report `isActive() == false` |
| Arbitrum | 516537665–517150404 | No Kernel actions in this deployment window; all three new CCIP policies report `isActive() == false` |
| Base | 52847117–52931253 | No Kernel actions in this deployment window; all three new CCIP policies report `isActive() == false` |
| Berachain | 27734756–27818570 | No Kernel actions in this deployment window; all three new CCIP policies report `isActive() == false` |
| Sepolia | 8226369–11967872 | Full configured core history replayed; real snapshot has 33 contracts, 19 roles, and 26 current assignments |

These runs used explicit archive RPCs and completed successfully. The four empty deployment-window snapshots were correctly not ready for publication. They do not replace full-chain snapshots or establish complete chain-head coverage. Getter checks of `isActive()` confirm Kernel membership only, independently of IEnabler state. Ethereum's new config policies both report active. No ownership or enablement value is asserted by this milestone.

## EVM chain coverage

The catalog includes all eleven EVM entries from the same Olympus source revision. `solana` and `solana-devnet` are excluded. Six production chains and three testnets have configured indexing; Goerli and Berachain Bartio have a local historical deployment view. They require no snapshot or RPC and do not participate in publisher or monitor readiness. Missing addresses, including Arbitrum Sepolia multisigs, stay unset.

Goerli is deprecated according to the [Ethereum Foundation sunset notice](https://blog.ethereum.org/2023/11/30/goerli-lts-update). Bartio is retained as historical coverage of this deployment file, with no live indexer configured. This does not substitute current Bepolia deployments for the source Bartio addresses.

| Chain | Contract | Creation block | Timestamp | Transaction |
| --- | --- | ---: | ---: | --- |
| 421614 | Kernel | 273448353 | 1780491101 | `0x9af587abb9efcfed12b24290f4cc669b55ed1b8880834e072ed52c4f4d21b978` |
| 421614 | OlympusRoles | 273448359 | 1780491103 | `0xc9bf7d155b2cf4d5385ba203fa3871a14ac251096277316c731156016db2f218` |
| 421614 | RolesAdmin | 273448362 | 1780491104 | `0xf9c4756877cbbc683eff498aec069724c3799ba41b332e496ba9907bfcefb85d` |
| 84532 | Kernel | 21445241 | 1738658770 | `0xe73b840e56891a1d605bb8714666f99993153f9564154d9a5a697e651964a7ff` |
| 84532 | OlympusRoles | 21445245 | 1738658778 | `0xaf1c59b3736caf6dbf937af7fe818d47101f5603841a955351f25ba55338159c` |
| 84532 | RolesAdmin | 21445251 | 1738658790 | `0x844988a28087920c53734a9f3416c24d75de4988fa4f8a0ff9b00a011523c270` |

Arbitrum Sepolia receipts: `broadcast/LZBridgeTestnetDeploy.s.sol/421614/run-1780491115557.json`. Base Sepolia receipts: `broadcast/L2Deploy.s.sol/84532/run-1738659035.json`. RPC verification matched receipt status, contract address, and canonical block hash. Historical code was present at each creation block and absent immediately before it.

The Arbitrum Sepolia broadcast also contains successful creations for LZBridgeGateway, LZEndpointDelegate, LZCrossChainBridge, and LZBridgeAndDelegateConfig. Kernel replay discovered the three policies, so their receipt-backed labels are included even though the older environment entries omit them. The periphery bridge is listed separately. This adds no LayerZero deployment to Robinhood.

Both new networks completed archive-RPC Envio replay with zero latest-state fallbacks. Arbitrum Sepolia blocks `273448353–273458353` produced seven named core contracts, five roles, and five assignments. Base Sepolia blocks `21445241–21455241` produced nine named core contracts, five roles, and five assignments. Real Hasura snapshots validated successfully for both. These are deployment-window checks, not complete chain-head coverage claims.

## Snapshot and control-state foundations

Schema 1.1 adds external and inactive nodes, control state, relationships, and observation metadata. Readers also accept 1.0 snapshots. Missing extensions remain empty or unknown. The active-core array keeps its previous meaning.

A full Mainnet core replay from block `15998125` through `26246707` completed successfully. It produced 43 active contracts, 35 roles, and 48 current assignments. This replaces the three-contract deployment-window fixture in the local preview. The gateway served the new snapshot, and browser inspection confirmed the restored modules and policies.

A separate local Anvil and PostgreSQL replay verified Envio rollback. The first branch seeded `true` at block 1 and applied a disable event at block 2. A replacement branch seeded `false` at the same block 1 height. Envio removed the orphaned seed and transition. The replacement state matched its block-pinned getter. The effect cache retained separate results for the old and replacement hashes, without reusing the orphaned value.

This runtime check also exposed a JSONB history-write failure with primitive boolean transition payloads. Transition values now use JSON objects. Concrete production enablement and ownership subscriptions follow in the next milestones; this foundation does not claim those fields are already observed.

Getter calls use EIP-1898 canonical block hashes, including across RPC fallbacks. The shared readiness parser uses the actual Envio 3.14.1 metric, `envio_progress_block_time_seconds`. Missing block-time metrics remain unavailable; scrape or publication time cannot replace them.

## Ownership and legacy authority

The ownership subscription uses the indexed two-address `OwnershipTransferred` event from Solmate 6.2.0 `Owned`. The Cooler composites, Cooler migrator, cross-chain bridge periphery, and proposal helpers use that source. The LimitOrders periphery uses OpenZeppelin Ownable with the same event signature. The getter is lowercase `owner()`; uppercase `OWNER` in the inspected source is a test variable. Zero ownership is unset. BLVault template `owner()` reads immutable clone arguments rather than Solmate ownership; the listed templates return zero and do not emit ownership-transfer events.

The additional-contract list corrects Mainnet's environment-labelled Authority, `0x4a8c9502a34962a2c6d73c5d181daaef3dcdc88d`, which has no deployed code. At block 26246707, both OHM and Staking reference `0x1c21f8ea7e39e2ba00bc12d2968d63f4acb38b7a`. That Authority was created at block 13674068 in transaction `0x04a8cf7a0f4c8e9d0e27b36baffe48642db6ebd48750bff76356bae4e94fffde`. Other indexed OHM consumers matched their recorded Authority addresses at the comparison blocks in the IEnabler table.

Three additional proposal helpers have successful creation receipts, matching address/block hashes, code at creation and no code in the preceding block:

| Chain | Contract | Creation block | Transaction |
| --- | --- | ---: | --- |
| Ethereum | ConvertibleDepositActivator | 23824876 | `0x43be8ba00f66b0f32d16221733cbcf49177be8bd71412d78af87662958e49a08` |
| Ethereum | MigrationProposalHelper | 24440534 | `0x8f5138d8f0fbbe47aa272920684e5ea074fc479df856ae250ca88941f9669765` |
| Sepolia | ConvertibleDepositActivator | 9578184 | `0xbf0fc46c83dbf8319e8ee1b036a2ff2fc2c701b05275c26d35052624f7291474` |

Authority push/pull events establish governor, guardian, policy and vault holders separately. An immediate push emits after changing the current holder, so its `from` argument is not previous-state evidence. Constructor pushes establish initial holders without assigning `new*`; those getters are seeded at the completed creation block. Ordinary deferred pushes change the nominee; pulls change the holder. A persistent `new*` getter equal to the current holder does not show a pending handover. Authority self-references are omitted.

Consumers follow `AuthorityUpdated`, including newly referenced Authority event sources. A newly discovered Authority has event coverage from its reference block and is seeded at the next completed checkpoint; details disclose that earlier state came from the getter. Existing deployment anchors still include constructor events.

Legacy sOHM emits `LogStakingContractUpdated`. Mainnet and Sepolia gOHM expose the separate `approved()` mint/burn controller: `migrate()` changes it without a change event. These fields use hash-bound checkpoint observations with an explicit getter-only coverage notice; no synthetic transaction or event history is invented. Optimism and Arbitrum gOHM wrappers did not expose this getter and do not receive that capability. These links do not assign ownership or the Bophades MINTR role.

At Mainnet block 26246707, the DAO MS `0x245cc372c84b3645bf0ffe6538620b04a217988b` is both governor and guardian. The graph retains both labels on one address node. Mainnet's pending governor/guardian getters are zero; persistent policy/vault nominees equal their current holders. Robinhood's four nominees equal their holders, so none is a pending handover. These getter comparisons are source/capability checks; replay evidence is recorded separately.

Production control-event history replay matched all 95 relationship fields across eight indexed chains, with each event delivered twice to check idempotence. Constructor events ran before completed creation-block seeds. Berachain's ten comparison getters succeeded, but its public RPC returned an incomplete historical log response, including no logs for a known Authority creation event. That historical response is unavailable evidence, not an empty event history.

Actual Envio/PostgreSQL replay verified all ten Robinhood relationship fields through block `94951973` and all eighteen Mainnet fields in the bounded window `26230000–26246707`. A full Mainnet replay encountered provider rate limits; the bounded runtime check and separate control-event history replay establish different parts of coverage. A local reorg restored ten matching fields, removed five orphaned transition rows and eight relationship rows discovered on the orphaned branch, and completed verification against the replacement block hash.

## CCIP administration and source-backed references (U6)

The CCIP source reviewed for this unit is Olympus V3 revision `934e3b88ad414c1e6238b0a88b53c7f362d249ee`. `ICCIPTokenAdminRegistry.sol` defines the deployed three-address `getTokenConfig(OHM)` tuple: administrator, pending administrator, and token pool. `getPool(OHM)` exposes registration separately. Registry events are scoped to the configured registry and OHM address. A nomination does not replace the current administrator. Acceptance establishes the new administrator and clears the pending field. A zero pool removes the registration relationship.

The registry's global owner and each pool's owner have separate typed relationships. The deployed Chainlink `ConfirmedOwnerWithProposal` ABI uses `OwnershipTransferRequested(from,to)` and `OwnershipTransferred(from,to)`. Its constructor assigns the owner without a transfer event. Hash-bound creation reads seed that owner. The pending owner is private and has no public getter in this version. Only a replayed request or acceptance establishes that field; missing request coverage stays unknown. An unavailable getter never erases an established event value.

The additional-contract list now includes the previously verified registry creation anchors: Ethereum `20735575`, Optimism `125790041`, Robinhood `4758`, Base `20193207`, Arbitrum `256834238`, Berachain `1023691`, and Sepolia `6577288`. Robinhood and Sepolia indexing start at their earlier registry anchors. The pool on Base Sepolia has independent ownership coverage; no registry address is inferred where the inventory has none.

`PoolSet` registers the selected nonzero pool for subsequent ownership events. Each completed checkpoint includes all configured fields and every historically selected pool recorded in canonical transitions. A newly discovered pool's earlier ownership state is seeded at that completed checkpoint and disclosed in coverage details. Pool replacement or delisting retains other control relationships. Envio rollback owns current relationships, discovery transitions, and seeds. Getter effect identities include the canonical block hash.

Immutable references are read at a pinned completed block and verified at later checkpoints. The source-backed getter list is small: `CCIPTokenPoolConfig.pool()`, `CCIPTokenPoolConfigTimelock.config()`, `CoolerV2Migrator.COOLERV2()`, `CoolerV2Composites.COOLER()`, and the bridge peripheries' `OHM()`. The inspected source contains one deployed ConfigTimelock family with a `config()` reference. Other timelock names do not establish a getter capability. A reference remains visible when its source is disabled and remains distinct from ownership when the endpoints coincide. Its observed target comes from the getter, not the deployment name or intended governance setup.

Production-handler replay covered 82 new fields across nine chains: all 64 readable fields matched their hash-pinned getters, and 18 pending-owner fields disclosed their event-only coverage (13 established by events, five unknown). Delivering each of 53 actual logs twice produced 74 transitions without duplicates or mismatches. Two historical Sepolia pools were discovered and seeded at their first registration blocks. Berachain's seven CCIP logs came from Etherscan and matched official RPC transaction receipts and canonical hashes; the incomplete public-node history described above was not used.

An actual Envio/PostgreSQL Mainnet replay over `26230000–26246707` verified 28 readable relationship fields with zero mismatches. The remaining two pending-owner verifications have no getter. It indexed the two nominations at block `26245874`: GovernanceTimelock is OHM's pending registry administrator, and CCIPTokenPoolConfig is the pool's pending owner. The DAO MS remains both current token administrator and pool owner. The registry's separate global owner is `0x44835bbba9d40deda9b64858095ecfb2693c9449`.

A local Envio/PostgreSQL replay replaced a selected pool, indexed its subsequent ownership changes, and kept token administration separate from global registry ownership. Reorg recovery removed all 15 orphaned transitions and the newly discovered pool's two fields. Five restored readable fields matched the replacement block hash; two unobserved pending owners stayed unknown. This check also verified that nullable values reloaded as `undefined` remain unset rather than becoming controller addresses.
