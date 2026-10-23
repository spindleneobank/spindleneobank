import { parseAbi } from 'viem';

/** Hand-transcribed from contracts-spec.md; X1 replaces this with the generated ABI (same export name). */
export const spindleRegistryAbi = parseAbi([
  'struct Node { address owner; address nodeKey; uint8 gpuClass; bool ccCapable; bytes32 attestationRef; uint256 agentId; uint64 registeredAt; bool active; }',
  'function registerNode(address nodeKey, uint8 gpuClass, bool ccCapable, bytes32 attestationRef, uint256 deadline, bytes nodeSig) returns (uint256 nodeId)',
  'function linkIdentity(uint256 nodeId, uint256 agentId)',
  'function updateNode(uint256 nodeId, uint8 gpuClass, bool ccCapable, bytes32 attestationRef, uint256 deadline, bytes nodeSig)',
  'function deactivate(uint256 nodeId)',
  'function getNode(uint256 nodeId) view returns (Node)',
  'function nodeIdOfKey(address nodeKey) view returns (uint256)',
  'function ownerOf(uint256 nodeId) view returns (address)',
  'event NodeRegistered(uint256 indexed nodeId, address indexed owner, address indexed nodeKey, uint8 gpuClass, bool ccCapable, bytes32 attestationRef)',
  'event NodeUpdated(uint256 indexed nodeId, uint8 gpuClass, bool ccCapable, bytes32 attestationRef)',
  'event IdentityLinked(uint256 indexed nodeId, uint256 indexed agentId)',
  'event NodeDeactivated(uint256 indexed nodeId)',
]);
