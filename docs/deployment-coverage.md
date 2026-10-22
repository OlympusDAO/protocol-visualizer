# Deployment coverage

Source comparison: Olympus V3 Robinhood `a48ec8281b51db9136fbd6a8fd24d1b65cf2a929`, CCIP `e4034d5850bd0969983e3fc46c8405a4c9bc25c2`, and primary `8462498ac39772c53120cb8159f5a356d378471f`.

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
