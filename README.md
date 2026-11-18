<h1 align="center">Spindle</h1>

<p align="center">
  <strong>GPU compute, signed receipts and payout choice. Built on Robinhood Chain.</strong>
</p>

<p align="center">
  <a href="https://spindleneobank.com">Website</a> ·
  <a href="https://x.com/spindleneobank">X</a> ·
  <a href="https://t.me/spindleneobank">Telegram</a> ·
  <a href="https://github.com/spindleneobank/spindleneobank">GitHub</a>
</p>

---

Spindle connects GPU supply to AI demand, records verified work, and pays providers in USDG. Buyers call an
OpenAI-compatible API. Independent nodes serve the jobs and sign a receipt for each one. Verified work is
committed on-chain each epoch, and providers claim their earnings from an owner-less contract.
- **OpenAI-compatible API**: chat completions, streaming and embeddings. Pay with an API key and a USDG balance,
  or per call with [x402](https://www.x402.org/).
- **Signed receipts**: every job carries a COSE-signed receipt that anyone can verify and prove against the epoch's
  Merkle root.
- **Node agent**: runs behind NAT, serves inference from Ollama or vLLM, and builds its image on the operator's own
  machine.
- **On-chain settlement**: buyer payments are split on arrival, epoch roots are posted under a guardian veto
  window, and providers claim USDG with a Merkle proof. No contract is upgradeable, owned or pausable.

## Links

| Channel  | URL                                                                                          |
| -------- | -------------------------------------------------------------------------------------------- |
| Website  | [spindleneobank.com](https://spindleneobank.com)                                             |
| API      | [api.spindleneobank.com](https://api.spindleneobank.com/v1/health)                           |
| X        | [@spindleneobank](https://x.com/spindleneobank)                                              |
| Telegram | [t.me/spindleneobank](https://t.me/spindleneobank)                                           |
| GitHub   | [github.com/spindleneobank/spindleneobank](https://github.com/spindleneobank/spindleneobank) |

## Deployed contracts

Robinhood Chain mainnet (chain ID `4663`), deployed at block `110759179` from commit `fb519c4`. The full record,
including constructor arguments, is in [`contracts/deployments/4663.json`](contracts/deployments/4663.json).

| Contract          | Address                                                                                                                                  | Role                                                                                     |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `SpindleRegistry` | [`0xED53E157d8d48Fd951381ebD7E664f708070cE90`](https://robinhoodchain.blockscout.com/address/0xED53E157d8d48Fd951381ebD7E664f708070cE90) | Binds each node key to its owner wallet; the node key consents with an EIP-712 signature |
| `SpindleClaims`   | [`0xbb51Cc9A45b9669329356e38a2d81B4436eA798b`](https://robinhoodchain.blockscout.com/address/0xbb51Cc9A45b9669329356e38a2d81B4436eA798b) | Cumulative Merkle payouts: epoch roots, guardian veto window, USDG claims                |
| `BuyerVault`      | [`0x0F2D643BDdD6662ddB01991e6bF97eD2904932b3`](https://robinhoodchain.blockscout.com/address/0x0F2D643BDdD6662ddB01991e6bF97eD2904932b3) | Takes buyer deposits and x402 settlements, splits them 80/20 to claims and treasury      |

`SpindleStaking` ($SPDL staking per node) is in this repository but is not deployed yet.

**Parameters**: claim delay 1 hour; maximum increase per epoch root 5,000 USDG.

**Role holders**, fixed at deploy (what each role can and can't do is in [`SECURITY.md`](SECURITY.md#privileged-roles)):

| Role                                  | Address                                                                                                                                  |
| ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Guardian (`SpindleClaims`)            | [`0x0e23B29665D94BDFc8f161B749B7AE05c47643c5`](https://robinhoodchain.blockscout.com/address/0x0e23B29665D94BDFc8f161B749B7AE05c47643c5) |
| Keeper (root poster and x402 settler) | [`0x7F34c3548447Ad3A548767CeE7877897DE440A8e`](https://robinhoodchain.blockscout.com/address/0x7F34c3548447Ad3A548767CeE7877897DE440A8e) |
| Treasury                              | [`0x147331906ee6eb2BaA0006CD6CE87fFB3eC37063`](https://robinhoodchain.blockscout.com/address/0x147331906ee6eb2BaA0006CD6CE87fFB3eC37063) |

**External contracts used**:

| Contract          | Address                                                                                                                                  |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| USDG              | [`0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168`](https://robinhoodchain.blockscout.com/address/0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168) |
| Permit2           | [`0x000000000022D473030F116dDEE9F6B43aC78BA3`](https://robinhoodchain.blockscout.com/address/0x000000000022D473030F116dDEE9F6B43aC78BA3) |
| ERC-8004 Identity | [`0x8004A169FB4a3325136EB29fA0ceB6D2e539a432`](https://robinhoodchain.blockscout.com/address/0x8004A169FB4a3325136EB29fA0ceB6D2e539a432) |

To check the deployed bytecode, roles and parameters against this repository:

```sh
(cd contracts && forge build)
bun run scripts/verify-deploy.ts --rpc https://rpc.mainnet.chain.robinhood.com
```

It exits non-zero on any difference.

## Architecture

| Component    | Stack                                                     | Path                  |
| ------------ | --------------------------------------------------------- | --------------------- |
| API          | Bun, Hono, WebSockets for node connections                | `src/`                |
| Worker       | BullMQ jobs: epochs, settlement, indexer, probes, payouts | `src/worker.ts`       |
| Database     | PostgreSQL (TimescaleDB) with Drizzle, Redis              | `src/db/`, `drizzle/` |
| Contracts    | Solidity, Foundry, OpenZeppelin, Permit2                  | `contracts/`          |
| Node agent   | Bun, Docker, Ollama or vLLM                               | `node/`               |
| Web app      | React, TanStack Router, Vite, wagmi                       | `web/`                |
| API examples | curl, OpenAI SDKs, x402 clients, receipt verification     | `examples/`           |

```
src/server.ts           API entry: Hono app, WebSocket upgrade, graceful shutdown
src/worker.ts           BullMQ processors and schedules
src/migrate.ts          Drizzle migrations
src/config.ts           zod environment schema (secrets kept apart from `config`)
src/db/                 client and schema
src/lib/                queue, redis, logger, errors, http, modules, money, ws
src/modules/<name>/     routes.ts, jobs.ts and tests, registered in src/lib/modules.ts
src/shared/             types and schemas shared with node/ and web/
contracts/              Foundry project (dependencies vendored in lib/)
node/                   node agent and installer
web/                    marketing site and dashboard
dev/                    mocks and seed scripts
```

## Development

Requirements: [Bun](https://bun.sh) 1.4, [Foundry](https://getfoundry.sh) 1.8 and Docker.

```sh
bun install --frozen-lockfile --ignore-scripts
bun run typecheck && bun run lint
bun run test:host                                    # backend unit tests, against the dev stack's Postgres and Redis
(cd node && bun test)
(cd web && bun run test)
(cd contracts && forge build && forge test --no-match-path 'test/fork/*')
RHC_RPC_URL=<archive rpc> bun run contracts:fork     # contract fork tests
bun run test:int                                     # integration tests, needs the Anvil fork
bun run contracts/script/mutate.ts                   # contract mutation testing, about 15 minutes
```

The local stack (Postgres, Redis, an Anvil fork of Robinhood Chain, the API and the worker) runs from Docker
Compose files kept in the maintainers' operations repository. It binds to 127.0.0.1 only: API 7200, Postgres 7232,
Redis 7279, Anvil 7245.

[`ci.yml`](.github/workflows/ci.yml) runs these checks on every push, plus Slither, Semgrep and gitleaks.

## Deployment

Contracts are deployed first, then the backend (API and worker, behind a Cloudflare tunnel) and the web app on
Vercel (Root Directory `web`). After a contract deploy, run the verification above before pointing the backend at
the new addresses.

## Security

Please report vulnerabilities privately; see [`SECURITY.md`](SECURITY.md). It also lists the privileged roles and
the accepted risks.

## License

[MIT](LICENSE)
