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
`bun install`, `bun run typecheck`, `bun run lint`, `bun test`, `cd contracts && forge build`.
