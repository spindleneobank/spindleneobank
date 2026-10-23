// Fetch a receipt, verify the node's COSE signature, then verify your leaf in the epoch Merkle tree
// against the root posted on-chain.
//   bun verify-receipt.ts <jobId>
//   OWNER_ADDRESS=0x...  node owner whose leaf to prove (the earning address)
//   NODE_PUBKEY=0x...    optional, the node's registered public key (otherwise recovered from the signature)
//   RPC_URL + CLAIMS_ADDRESS  optional, compare the tree root with SpindleClaims.roots(epoch)
import { createPublicClient, http, parseAbi } from 'viem';
import { checkEpochTree, checkReceipt, type ReceiptView, type TreeDump } from './receipt-lib.ts';

const API = process.env.SPINDLE_API_URL ?? 'http://127.0.0.1:7200';
const jobId = process.argv[2] ?? process.env.JOB_ID;

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${API}${path}`);
  if (!res.ok) throw new Error(`GET ${path} -> ${res.status} ${await res.text()}`);
  return (await res.json()) as T;
}

try {
  if (!jobId)
    throw new Error('usage: bun verify-receipt.ts <jobId>  (the X-Spindle-Job-Id of a finished job)');
  const view = await get<ReceiptView>(`/v1/receipts/${jobId}`);
  const r = checkReceipt(view, process.env.NODE_PUBKEY);
  console.log(
    `receipt ${view.jobId} model=${view.model} lane=${view.lane} usage=${view.usage.p}/${view.usage.c} server-verified=${view.verified}`,
  );
  console.log('inputDigest ', r.payload.inputDigest);
  console.log('outputDigest', r.payload.outputDigest);
  if (!r.signatureValid) throw new Error('COSE signature does NOT verify against the node key');
  if (!r.payloadMatchesView) throw new Error('signed payload differs from the API view');
  console.log('COSE_Sign1 ES256K signature valid for node', view.nodeKey);

  if (view.epoch == null) {
    console.log(
      'PASS verify-receipt.ts (signature only: the job is not in an epoch yet, epochs close hourly)',
    );
  } else {
    const tree = checkEpochTree(
      await get<TreeDump>(`/v1/epochs/${view.epoch}/tree`),
      process.env.OWNER_ADDRESS,
    );
    console.log(`epoch ${view.epoch}: ${tree.leaves} leaves, root ${tree.root}`);
    if (tree.ownerProofValid === false)
      throw new Error('owner leaf/proof does not verify (is OWNER_ADDRESS in this epoch?)');
    if (tree.ownerProofValid)
      console.log(`owner leaf proven, cumulative earned ${tree.cumulativeMicros} micros`);

    if (process.env.RPC_URL && process.env.CLAIMS_ADDRESS) {
      const client = createPublicClient({ transport: http(process.env.RPC_URL) });
      const onchain = await client.readContract({
        address: process.env.CLAIMS_ADDRESS as `0x${string}`,
        abi: parseAbi(['function roots(uint256 epoch) view returns (bytes32)']),
        functionName: 'roots',
        args: [BigInt(view.epoch)],
      });
      if (onchain.toLowerCase() !== tree.root.toLowerCase())
        throw new Error(`on-chain root ${onchain} != tree root ${tree.root}`);
      console.log('tree root matches SpindleClaims.roots(epoch)');
    } else {
      console.log('(set RPC_URL and CLAIMS_ADDRESS to also compare the root with the chain)');
    }
    console.log('PASS verify-receipt.ts');
  }
} catch (err) {
  console.error('FAIL verify-receipt.ts:', err instanceof Error ? err.message : err);
  process.exit(1);
}
