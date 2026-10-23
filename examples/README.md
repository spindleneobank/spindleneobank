# Spindle API examples

Runnable examples for the Spindle buyer API. Each one prints a `PASS ...` line and exits non-zero on failure.

| File                | What it shows                                                                      | Auth    |
| ------------------- | ---------------------------------------------------------------------------------- | ------- |
| `curl.sh`           | models, chat, streaming chat, embeddings                                           | API key |
| `openai-node.mjs`   | official `openai` SDK, `withResponse()` headers, streaming                         | API key |
| `openai-python.py`  | official Python SDK, raw-response headers, streaming                               | API key |
| `x402-client.ts`    | pay one call: 402 challenge, Permit2 approval, sign the witness, `X-PAYMENT` retry | wallet  |
| `x402-session.ts`   | sign one cap, make several calls with `X-Spindle-Session`, close, settle           | wallet  |
| `verify-receipt.ts` | fetch a receipt, verify the COSE signature, prove your leaf in the epoch tree      | none    |

`x402-lib.ts` and `receipt-lib.ts` hold the helpers; `examples.test.ts` checks them offline.

## Environment

| Variable                               | Used by                | Default                                                                                       |
| -------------------------------------- | ---------------------- | --------------------------------------------------------------------------------------------- |
| `SPINDLE_API_URL`                      | all                    | `http://127.0.0.1:7200` (dev). Production: `https://api.<domain>`                             |
| `SPINDLE_API_KEY`                      | curl, openai-*         | none. Create one in Dashboard > Developers (needs a deposited balance)                        |
| `SPINDLE_MODEL`, `SPINDLE_EMBED_MODEL` | all                    | first available chat / embeddings model from `/v1/models`                                     |
| `PRIVATE_KEY`                          | x402-*                 | none. A wallet holding USDG and a little ETH for the one-time approval                        |
| `RPC_URL`                              | x402-*, verify-receipt | `http://127.0.0.1:7245` (dev anvil fork)                                                      |
| `WAIT_SETTLED=1`                       | x402-session           | poll until the keeper settles the session (up to 15 min)                                      |
| `OWNER_ADDRESS`                        | verify-receipt         | the node owner whose Merkle leaf to prove                                                     |
| `CLAIMS_ADDRESS`                       | verify-receipt         | with `RPC_URL`: compare the tree root with `SpindleClaims.roots(epoch)`                       |
| `NODE_PUBKEY`                          | verify-receipt         | the node's public key; otherwise recovered from the signature and matched to the signed `kid` |

No secrets are stored in this directory; keys come from the environment.

## Run

```sh
cd app/examples
bun install                      # openai + viem
pip install -r requirements.txt  # Python example only

# Offline (no stack needed): request shaping, 402 parsing, signing, receipt + Merkle verification
bun test

# Dev stack (api http://127.0.0.1:7200, anvil fork on :7245, a connected node)
export SPINDLE_API_KEY=sk-spdl-...
export PRIVATE_KEY=0x...         # an anvil test key holding USDG
./curl.sh
node openai-node.mjs
python3 openai-python.py
bun x402-client.ts
bun x402-session.ts
bun verify-receipt.ts <jobId>    # job id from the X-Spindle-Job-Id header
./run-all.sh                     # everything above
```

Against production, set `SPINDLE_API_URL` and `RPC_URL` and use a real wallet; `x402-*` then spend real USDG.

## What needs a live stack

- Every call that creates a job needs a connected node (`503 NO_CAPACITY` otherwise).
- `x402-*` also need a healthy chain RPC (allowance read, one-time approve) and USDG in the wallet.
- `verify-receipt.ts` checks the signature immediately; the Merkle part needs the job to be in a posted epoch (epochs close hourly). It imports the verifier from `../src/shared`, so run it inside the repo checkout.
- `x402-session.ts` only reaches `settled` after the keeper's batch runs (every 10 min, or `POST /v1/admin/jobs/x402-settle/run` in dev).
