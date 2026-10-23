import { parseAbi } from 'viem';

export const buyerVaultAbi = parseAbi([
  'struct TokenPermissions { address token; uint256 amount; }',
  'struct PermitTransferFrom { TokenPermissions permitted; uint256 nonce; uint256 deadline; }',
  'struct Settlement { PermitTransferFrom permit; address payer; bytes32 paymentId; uint256 surcharge; uint256 validAfter; uint256 used; bytes signature; }',
  'function PROVIDER_BPS() view returns (uint16)',
  'function deposit(uint256 amount)',
  'function depositFor(address buyer, uint256 amount)',
  'function settle(Settlement[] items)',
  'event Deposited(address indexed buyer, address indexed payer, uint256 amount, uint256 toClaims, uint256 toTreasury)',
  'event Settled(bytes32 indexed paymentId, address indexed payer, uint256 used, uint256 surcharge)',
  'event SettleFailed(bytes32 indexed paymentId, address indexed payer, bytes4 reason)',
]);
