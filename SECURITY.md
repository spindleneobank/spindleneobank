# Security

## Reporting a vulnerability

Report privately with GitHub's private vulnerability reporting: on the repository's **Security** tab, choose **Report a vulnerability**. Don't open a public issue. This channel opens when the repository is published on GitHub; until then the code isn't public.

## Privileged roles

Contract roles are immutable and set at deploy. The post-deploy check (`scripts/verify-deploy.ts`) confirms each one on-chain.

| Role                        | Held by           | Can do                                                                                                                           | Can't do               |
| --------------------------- | ----------------- | -------------------------------------------------------------------------------------------------------------------------------- | ---------------------- |
| `SpindleClaims.poster`      | Keeper hot wallet | Post Merkle roots, within `maxEpochIncrease` and the solvency check                                                              | Move funds directly    |
| `BuyerVault.settler`        | Keeper hot wallet | Settle x402 payments up to each signed cap, choosing the used amount                                                             | Exceed a signed cap    |
| `SpindleClaims.guardian`    | Owner's Safe      | Veto a root during `claimDelay`                                                                                                  | Post roots, move funds |
| `SpindleStaking.slasher`    | Owner's Safe      | Slash a node's stake, to `slashRecipient`                                                                                        | Take funds elsewhere   |
| `ADMIN_ADDRESSES` (backend) | Owner's wallets   | Rate card, catalog, node suspension and bans, stock tokens. Every change needs a recent wallet signature and goes to `audit_log` | Touch contracts        |
| Treasury                    | Owner's address   | Receives the 20% share and surcharges                                                                                            |                        |

Nothing is upgradeable, and the contracts have no owner and no pause. Users can always claim a posted root after its delay.

## Accepted risks

| Risk                                                                                                                                                                                                                                                                                | Why it's accepted                                                                                                                                                                                                                                  | Limit                                                                                                                                          |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| **A provider can serve a cheaper model than it claims.** Canaries on models the house node doesn't serve can only check known answers, and shadow re-execution can't judge those models. On models it does serve, the similarity threshold may not catch a close cheaper model.     | Owner decision, 2026-11-04: providers are trusted to serve the model they claim. There is no GPU reference node or peer re-execution. Cheaters are banned and not paid when reported.                                                              | Buyer reports, admin bans, withheld earnings, and shadow checks where the house can judge                                                      |
| **x402 work is served before it is paid for.** A wallet that makes its settle fail gets its credit for free, then is barred, and the serving nodes bear the loss. Setting up a wallet costs about $0.01 in gas, less than the $0.05 credit, so this is capped but not unprofitable. | Owner decision, 2026-11-05: the loss is capped per wallet and per IP and comes out of node earnings, not buyer deposits. Taking payment before serving would close it, at the cost of a block of delay on a new wallet's first job and keeper gas. | $0.05 for a new wallet, 5 new wallets per IP or IPv6 /64 per day, at most 10% of what a wallet has paid, and $500 unsettled across all wallets |

See the threat model in `docs/plan/threat-model.md` for what the system doesn't protect against, and `docs/plan/contracts-spec.md` for the invariants and the tests that check them.
