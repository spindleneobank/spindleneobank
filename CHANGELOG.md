# Changelog

Pre-launch, so entries follow audits rather than releases. Reports are in the separate `docs/` repository under `testing/audit/`.

## audit-fixes-2 (2026-11-05)

**Security**
- x402 credit counts real use, so idle sessions can't lock buyers out. New wallets start at $0.05 and grow by 10% of what they settle, one IP or IPv6 /64 can bring 5 a day, and they settle within about a minute.
- A deeper stock pool raises an alert and no longer disables the token.
- Live Relay quotes are checked before users sign them. Swaps carry a five-minute on-chain deadline.
- Every admin change needs a recent wallet signature, and rate-card values are range-checked.
- Proxy headers are believed only from private peers. Mock mode can't reach izipay or use a live key.
- The availability floor needs stake and shown work. Node agents pin their first binding's owner, chain and registry.
- A charge is taken back if its receipt can't be recorded, and a reversal after settlement has claimed a payment becomes a refund.
- Canary withholds are dated at the earliest earning they cancel, and speed probes no longer send canary prompts.
- x402 credit defaults are an accepted risk, with their limits in `SECURITY.md` (owner decision, 2026-11-05).

**Operations**
- Push alerts through `ALERT_WEBHOOK_URL`, including a watch for on-chain roots the database didn't build.
- `scripts/verify-deploy.ts` checks bytecode and configuration after a deploy.
- CI workflow, `SECURITY.md`, MIT `LICENSE`, pinned toolchain and a three-day release cooldown.

**Tests**
- Route-wide auth sweep, property tests on the money maths, and contract mutation testing.

## audit-fixes (2026-11-04)

- Private canary corpus and shadow re-execution, stake-backed class pricing, gateway-measured speed, pool pinning with a TWAP bound, stepped epoch posting, and per-job output and request size limits.
- Buyer reports and an admin ban that withholds unposted earnings.
