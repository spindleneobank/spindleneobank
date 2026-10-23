// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {ISpindleRegistry} from "./interfaces/ISpindleRegistry.sol";
import {IERC8004Identity} from "./interfaces/IERC8004Identity.sol";

/// @title SpindleRegistry
/// @notice Owner-less registry binding a node key (secp256k1 address held by the node agent) to its
/// owner wallet. The node key must consent to each binding with an EIP-712 signature, so nobody can
/// register someone else's node key. Linking an ERC-8004 identity is optional.
contract SpindleRegistry is ISpindleRegistry, EIP712 {
    bytes32 public constant NODE_BINDING_TYPEHASH =
        keccak256("NodeBinding(address owner,address nodeKey,uint8 gpuClass,bool ccCapable,uint256 deadline)");

    /// @notice ERC-8004 IdentityRegistry.
    IERC8004Identity public immutable identityRegistry;

    /// @notice Highest node id issued so far (ids start at 1).
    uint256 public nodeCount;

    mapping(uint256 => Node) private _nodes;
    mapping(address => uint256) private _nodeIdOfKey;

    constructor(address identityRegistry_) EIP712("SpindleRegistry", "1") {
        identityRegistry = IERC8004Identity(identityRegistry_);
    }

    /// @notice Register msg.sender as owner of `nodeKey`; `nodeSig` is the node key's EIP-712 consent.
    /// @param nodeKey secp256k1 address of the node agent key
    /// @param gpuClass 0..4
    /// @param ccCapable confidential-computing capable
    /// @param attestationRef hash of latest attestation bundle (0 for open lane)
    /// @param deadline signature expiry (unix seconds)
    /// @param nodeSig 65-byte signature by `nodeKey` over NodeBinding
    /// @return nodeId new node id (starts at 1)
    function registerNode(
        address nodeKey,
        uint8 gpuClass,
        bool ccCapable,
        bytes32 attestationRef,
        uint256 deadline,
        bytes calldata nodeSig
    ) external returns (uint256 nodeId) {
        if (gpuClass > 4) revert InvalidClass();
        _verify(msg.sender, nodeKey, gpuClass, ccCapable, deadline, nodeSig);
        if (_nodeIdOfKey[nodeKey] != 0) revert KeyInUse();

        nodeId = ++nodeCount;
        _nodeIdOfKey[nodeKey] = nodeId;
        _nodes[nodeId] = Node({
            owner: msg.sender,
            nodeKey: nodeKey,
            gpuClass: gpuClass,
            ccCapable: ccCapable,
            attestationRef: attestationRef,
            agentId: 0,
            registeredAt: uint64(block.timestamp),
            active: true
        });
        emit NodeRegistered(nodeId, msg.sender, nodeKey, gpuClass, ccCapable, attestationRef);
    }

    /// @notice Link an ERC-8004 identity to the node. Node owner only; caller must own `agentId`.
    /// @param nodeId node to link
    /// @param agentId ERC-8004 identity token id
    function linkIdentity(uint256 nodeId, uint256 agentId) external {
        Node storage n = _nodes[nodeId];
        if (n.owner != msg.sender) revert NotOwner();
        if (!n.active) revert NotActive();
        if (identityRegistry.ownerOf(agentId) != msg.sender) revert IdentityNotOwned();
        n.agentId = agentId;
        emit IdentityLinked(nodeId, agentId);
    }

    /// @notice Update class/cc/attestation; needs a fresh node-key signature over the new values.
    /// @param nodeId node to update
    /// @param gpuClass new class 0..4
    /// @param ccCapable new cc flag
    /// @param attestationRef new attestation hash
    /// @param deadline signature expiry
    /// @param nodeSig 65-byte signature by the node's key over NodeBinding with the new values
    function updateNode(
        uint256 nodeId,
        uint8 gpuClass,
        bool ccCapable,
        bytes32 attestationRef,
        uint256 deadline,
        bytes calldata nodeSig
    ) external {
        Node storage n = _nodes[nodeId];
        if (n.owner != msg.sender) revert NotOwner();
        if (!n.active) revert NotActive();
        if (gpuClass > 4) revert InvalidClass();
        _verify(msg.sender, n.nodeKey, gpuClass, ccCapable, deadline, nodeSig);
        n.gpuClass = gpuClass;
        n.ccCapable = ccCapable;
        n.attestationRef = attestationRef;
        emit NodeUpdated(nodeId, gpuClass, ccCapable, attestationRef);
    }

    /// @notice Deactivate the node and free its key. Node owner only. Re-registering gets a new id.
    /// @param nodeId node to deactivate
    function deactivate(uint256 nodeId) external {
        Node storage n = _nodes[nodeId];
        if (n.owner != msg.sender) revert NotOwner();
        if (!n.active) revert NotActive();
        n.active = false;
        delete _nodeIdOfKey[n.nodeKey];
        emit NodeDeactivated(nodeId);
    }

    /// @notice Full node record.
    /// @param nodeId node id
    function getNode(uint256 nodeId) external view returns (Node memory) {
        return _nodes[nodeId];
    }

    /// @notice Active node id bound to `nodeKey` (0 if none).
    /// @param nodeKey node key address
    function nodeIdOfKey(address nodeKey) external view returns (uint256) {
        return _nodeIdOfKey[nodeKey];
    }

    /// @notice Owner wallet of a node (address(0) if the id was never issued). Stays set after deactivation.
    /// @param nodeId node id
    function ownerOf(uint256 nodeId) external view returns (address) {
        return _nodes[nodeId].owner;
    }

    function _verify(
        address owner,
        address nodeKey,
        uint8 gpuClass,
        bool ccCapable,
        uint256 deadline,
        bytes calldata sig
    ) private view {
        if (deadline < block.timestamp) revert Expired();
        if (sig.length != 65) revert BadNodeSignature();
        bytes32 digest = _hashTypedDataV4(
            keccak256(abi.encode(NODE_BINDING_TYPEHASH, owner, nodeKey, gpuClass, ccCapable, deadline))
        );
        (address signer, ECDSA.RecoverError err,) = ECDSA.tryRecoverCalldata(digest, sig);
        if (err != ECDSA.RecoverError.NoError || signer != nodeKey || nodeKey == address(0)) {
            revert BadNodeSignature();
        }
    }
}
