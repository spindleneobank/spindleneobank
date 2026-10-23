import { erc20Abi } from '@spindle/shared/abi';
import { login } from '../lib/api';
import { ok, pub, wallet } from '../lib/chain';
import { assert, type Scenario } from '../lib/harness';

const swapRouterAbi = [
  {
    type: 'function',
    name: 'exactInputSingle',
    stateMutability: 'payable',
    inputs: [
      {
        name: 'params',
        type: 'tuple',
        components: [
          { name: 'tokenIn', type: 'address' },
          { name: 'tokenOut', type: 'address' },
          { name: 'fee', type: 'uint24' },
          { name: 'recipient', type: 'address' },
          { name: 'amountIn', type: 'uint256' },
          { name: 'amountOutMinimum', type: 'uint256' },
          { name: 'sqrtPriceLimitX96', type: 'uint160' },
        ],
      },
    ],
    outputs: [{ name: 'amountOut', type: 'uint256' }],
  },
] as const;

export const s08: Scenario = {
  n: 8,
  name: 'Stock swap',
  async run(c) {
    const s = await login(8);
    const stocks = await s.get('/v1/app/stocks');
    const nvda = stocks.find((x: any) => x.symbol === 'NVDA');
    assert(nvda, 'NVDA listed');
    const q = await s.post('/v1/app/stocks/quote', { token: nvda.address, amountInMicros: '20000000' });
    c.ev('quote-20', q);
    const w = wallet(8);
    const before = (await pub.readContract({ address: nvda.address, abi: erc20Abi, functionName: 'balanceOf', args: [w.account.address] })) as bigint;
    await ok(await w.writeContract({ address: q.approve.to, abi: erc20Abi, functionName: 'approve', args: [q.approve.args[0], BigInt(q.approve.args[1])] }));
    const a = q.swap.args[0];
    const h = await w.writeContract({
      address: q.swap.to,
      abi: swapRouterAbi,
      functionName: 'exactInputSingle',
      args: [{ tokenIn: a.tokenIn, tokenOut: a.tokenOut, fee: a.fee, recipient: a.recipient, amountIn: BigInt(a.amountIn), amountOutMinimum: BigInt(a.amountOutMinimum), sqrtPriceLimitX96: BigInt(a.sqrtPriceLimitX96) }],
    });
    await ok(h);
    const after = (await pub.readContract({ address: nvda.address, abi: erc20Abi, functionName: 'balanceOf', args: [w.account.address] })) as bigint;
    c.step(`swap ${h}: NVDA ${before} -> ${after}`);
    assert(after > before, 'NVDA balance increased');
    // big amount quotes show the impact warning (quote only; no funds needed)
    let warned: any;
    for (const amt of ['100000000000', '1000000000000', '10000000000000']) {
      const big = await s.post('/v1/app/stocks/quote', { token: nvda.address, amountInMicros: amt }).catch((e) => ({ error: String(e.message).slice(0, 200) }));
      c.ev(`quote-${amt}`, big);
      if (big.warnImpact) {
        warned = big;
        break;
      }
    }
    assert(warned, 'a large amount returns warnImpact=true');
    c.step(`impact warning at priceImpactBps ${warned.priceImpactBps}`);
  },
};
