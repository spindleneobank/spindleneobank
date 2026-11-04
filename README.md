# Spindle backend

Bun + Hono API, BullMQ worker, Drizzle/Postgres, and a Foundry project. Plans and specs live in the separate `docs/` repo (`docs/plan/architecture.md`, `dev-environment.md`, `api-contract.md`).

## Layout

```
package.json            bun workspaces ["node", "web"]; root = backend
src/server.ts           api entry (Hono, WS upgrade, graceful shutdown)
src/worker.ts           BullMQ processors and schedules
src/migrate.ts          drizzle migrations
src/config.ts           zod env schema (secrets split from `config`)
src/db/                 client.ts, schema.ts
src/lib/                queue, redis, logger, errors, http, modules, money, ws
src/modules/<name>/     routes.ts, jobs.ts, tests (registered in src/lib/modules.ts)
src/shared/             imported by node/ and web/
contracts/              Foundry project (OZ, permit2, forge-std vendored in lib/)
node/  web/             workspaces
dev/                    mocks and seed scripts
static/                 old frontend export (reference only)
```

## Dev stack

```sh
cp docs/deploy/backend.env.example docs/deploy/backend.env.dev   # once
sudo docker compose -f docs/deploy/compose.dev.yml up -d --build postgres redis anvil migrate api worker
curl localhost:7200/v1/health
```
Host ports (127.0.0.1 only): api 7200, postgres 7232, redis 7279, anvil 7245 (fork of Robinhood Chain, chain id 4663).

## Commands

```sh
bun install --frozen-lockfile --ignore-scripts
bun run typecheck && bun run lint
bun run test:host                                    # backend unit suite, against the dev stack's Postgres and Redis
(cd node && bun test)
(cd contracts && forge build && forge test --no-match-path 'test/fork/*')
RHC_RPC_URL=<archive rpc> bun run contracts:fork     # fork tests
bun run test:int                                     # integration, needs the anvil fork
bun run contracts/script/mutate.ts                   # contract mutation test, about 15 minutes
```

`.github/workflows/ci.yml` runs the same checks plus Slither, Semgrep and gitleaks.

## Deploy

The owner deploys. The full steps are in `docs/deploy/RUNBOOK.md`: contracts first, then the backend on this VPS (ports 3XXX), and the frontend on Vercel (Root Directory `web`). After deploying contracts, confirm they match this commit:

```sh
(cd contracts && forge build)
bun run scripts/verify-deploy.ts --rpc https://rpc.mainnet.chain.robinhood.com
```

It exits non-zero on any difference in bytecode, roles or parameters.

## Security

`SECURITY.md` lists reporting, privileged roles and accepted risks. `docs/plan/threat-model.md` covers what the system doesn't protect against.
