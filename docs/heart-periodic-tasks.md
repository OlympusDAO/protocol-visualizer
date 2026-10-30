# Heart periodic tasks

`HeartTasks` stores the ordered addresses and custom selectors returned by
`getPeriodicTasks()`. Zero selectors mean `execute()`. `PeriodicTaskAdded` inserts
at the emitted index and shifts later entries right; `PeriodicTaskRemoved` shifts
later entries left. Duplicate logs are ignored by transaction/log identity.

Completed canonical checkpoints seed unknown lists and verify replayed lists.
A getter mismatch retains indexed order and reports the discrepancy. Failed
reads retain the last known configuration; an unknown list differs from an empty
list. Entity rollback tests model store restoration, not an Envio runtime reorg.

The optional `periodicTasks` extension lets readers accept older 1.0/1.1 snapshots
without task data.
Task status reuses `contractStates`; Kernel membership remains independent.

| Task interface | Status tracking |
| --- | --- |
| `isEnabled()` | Existing IEnabler event replay and getter verification |
| ReserveMigrator `locallyActive()` | `Activated` / `Deactivated` replay and getter verification |
| Operator `active()` | Checkpoint observations; no status events |
| Older YieldRepurchaseFacility `isShutdown()` | Inverted getter observations plus `Shutdown` replay; initialization can re-enable without a unique event |

The legacy getter is selected only when the deployed ABI lacks `isEnabled()` and
contains that getter. Newer Sepolia YieldRepurchaseFacility therefore retains
IEnabler tracking.

The visualiser labels Heart connections with task order and the configured
invocation, including disabled tasks. Selecting Heart includes source-confirmed
downstream targets. Call edges describe conditional paths in verified source,
not transaction traces. The initial call map covers the six Mainnet tasks
and the nine distinct tasks configured on the three Sepolia managers. It does
not infer an exhaustive call graph, internal module calls, or call paths for
unverified versions. Targets are read from getters at canonical checkpoints.
Call paths are shown only for the configured selector they were verified for.

Verified deployed sources: [Heart](https://etherscan.io/address/0x5824850d8a6e46a473445a5af214c7ebd46c5ecb#code),
[ConvertibleDepositFacility](https://etherscan.io/address/0xebde552d851dd6dfd3d360c596d3f4af6e5f9678#code),
[ReserveMigrator](https://etherscan.io/address/0x986b99579bec7b990331474b66ccdb94fa2419f5#code),
[ReserveWrapper](https://etherscan.io/address/0xca6cd4f0a0033f8c20cf68d6df277e7001a386f9#code),
[Operator](https://etherscan.io/address/0x6417f206a0a6628da136c0faa39026d0134d2b52#code),
[YieldRepurchaseFacility](https://etherscan.io/address/0x271e35a8555a62f6ba76508e85dfd76d580b0692#code),
and [EmissionManager](https://etherscan.io/address/0xa61b846d5d8b757e3d541e0e4f80390e28f0b6ff#code).

Baseline checks matched all four known managers: Mainnet block 26252671 and
Sepolia block 11974025. Mainnet configured six tasks; Operator was locally
disabled and the other five enabled. This is an observation, not a live-state
guarantee. The sUSDS and sDAI labels were checked with `name`, `symbol`, and `asset`
at the same Mainnet block.
