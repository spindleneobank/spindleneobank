// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @notice Binds a node key to its owner wallet (node consent via EIP-712).
interface ISpindleRegistry {
    struct Node {
        address owner;
        address nodeKey;
        uint8 gpuClass;
        bool ccCapable;
        bytes32 attestationRef;
        uint256 agentId;
        uint64 registeredAt;
        bool active;
    }

    event NodeRegistered(
        uint256 indexed nodeId,
        address indexed owner,
        address indexed nodeKey,
        uint8 gpuClass,
        bool ccCapable,
        bytes32 attestationRef
    );
    event NodeUpdated(uint256 indexed nodeId, uint8 gpuClass, bool ccCapable, bytes32 attestationRef);
    event IdentityLinked(uint256 indexed nodeId, uint256 indexed agentId);
    event NodeDeactivated(uint256 indexed nodeId);

    error InvalidClass();
    error Expired();
    error BadNodeSignature();
    error KeyInUse();
    error NotOwner();
    error NotActive();
    error IdentityNotOwned();

    function registerNode(
        address nodeKey,
        uint8 gpuClass,
        bool ccCapable,
        bytes32 attestationRef,
        uint256 deadline,
        bytes calldata nodeSig
    ) external returns (uint256 nodeId);
    function linkIdentity(uint256 nodeId, uint256 agentId) external;
    function updateNode(
        uint256 nodeId,
        uint8 gpuClass,
        bool ccCapable,
        bytes32 attestationRef,
        uint256 deadline,
        bytes calldata nodeSig
    ) external;
    function deactivate(uint256 nodeId) external;
    function getNode(uint256 nodeId) external view returns (Node memory);
    function nodeIdOfKey(address nodeKey) external view returns (uint256);
    function ownerOf(uint256 nodeId) external view returns (address);
}
