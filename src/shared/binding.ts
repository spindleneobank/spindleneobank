import type { Address, TypedDataDefinition } from 'viem';

export const NODE_BINDING_TYPES = {
  NodeBinding: [
    { name: 'owner', type: 'address' },
    { name: 'nodeKey', type: 'address' },
    { name: 'gpuClass', type: 'uint8' },
    { name: 'ccCapable', type: 'bool' },
    { name: 'deadline', type: 'uint256' },
  ],
} as const;

export type NodeBindingTypedData = TypedDataDefinition<typeof NODE_BINDING_TYPES, 'NodeBinding'>;

export interface NodeBindingInput {
  registry: Address;
  chainId: number;
  owner: Address;
  nodeKey: Address;
  gpuClass: number;
  ccCapable: boolean;
  deadline: bigint | number | string;
}

export type NodeBindingMessage = Omit<NodeBindingInput, 'registry' | 'chainId'>;
export interface NodeBindingDomain {
  chainId: number;
  /** registry address; `verifyingContract` is accepted too (the shape sent in `welcome`). */
  registry?: Address;
  verifyingContract?: Address;
}

/**
 * EIP-712 NodeBinding for SpindleRegistry (domain "SpindleRegistry"/"1").
 * Call as `nodeBindingTypedData({ registry, chainId, owner, ... })` or, as N1 does,
 * `nodeBindingTypedData(domain, message)`.
 */
export function nodeBindingTypedData(input: NodeBindingInput): NodeBindingTypedData;
export function nodeBindingTypedData(
  domain: NodeBindingDomain,
  message: NodeBindingMessage,
): NodeBindingTypedData;
export function nodeBindingTypedData(a: NodeBindingInput | NodeBindingDomain, b?: NodeBindingMessage) {
  const registry = (a.registry ?? (a as NodeBindingDomain).verifyingContract) as Address;
  const i: NodeBindingInput = b ? { ...b, registry, chainId: a.chainId } : (a as NodeBindingInput);
  return {
    domain: {
      name: 'SpindleRegistry',
      version: '1',
      chainId: i.chainId,
      verifyingContract: i.registry,
    },
    types: NODE_BINDING_TYPES,
    primaryType: 'NodeBinding' as const,
    message: {
      owner: i.owner,
      nodeKey: i.nodeKey,
      gpuClass: i.gpuClass,
      ccCapable: i.ccCapable,
      deadline: BigInt(i.deadline),
    },
  } satisfies NodeBindingTypedData;
}
