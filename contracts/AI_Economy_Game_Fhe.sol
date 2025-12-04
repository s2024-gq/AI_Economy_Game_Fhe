pragma solidity ^0.8.24;

import { FHE, euint32, ebool } from "@fhevm/solidity/lib/FHE.sol";
import { SepoliaConfig } from "@fhevm/solidity/config/ZamaConfig.sol";

contract AIEconomyGameFHE is SepoliaConfig {
    using FHE for euint32;
    using FHE for ebool;

    address public owner;
    mapping(address => bool) public isProvider;
    mapping(address => uint256) public lastSubmissionTime;
    mapping(address => uint256) public lastDecryptionRequestTime;
    uint256 public cooldownSeconds = 60;
    bool public paused;
    uint256 public currentBatchId = 1;
    bool public batchOpen = false;

    struct PlayerState {
        euint32 funds;
        euint32 shares;
        euint32 lastTradePrice;
    }
    mapping(address => PlayerState) public playerStates;

    struct DecryptionContext {
        uint256 batchId;
        bytes32 stateHash;
        bool processed;
    }
    mapping(uint256 => DecryptionContext) public decryptionContexts;

    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);
    event ProviderAdded(address indexed provider);
    event ProviderRemoved(address indexed provider);
    event CooldownSecondsSet(uint256 oldCooldown, uint256 newCooldown);
    event Paused(address account);
    event Unpaused(address account);
    event BatchOpened(uint256 batchId);
    event BatchClosed(uint256 batchId);
    event PlayerStateSubmitted(address indexed player, uint256 batchId);
    event DecryptionRequested(uint256 indexed requestId, uint256 batchId);
    event DecryptionCompleted(uint256 indexed requestId, uint256 batchId, uint256 totalValue);

    error NotOwner();
    error NotProvider();
    error PausedError();
    error CooldownActive();
    error BatchClosedError();
    error ReplayError();
    error StateMismatchError();
    error InvalidBatchState();

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    modifier onlyProvider() {
        if (!isProvider[msg.sender]) revert NotProvider();
        _;
    }

    modifier whenNotPaused() {
        if (paused) revert PausedError();
        _;
    }

    modifier checkSubmissionCooldown() {
        if (block.timestamp < lastSubmissionTime[msg.sender] + cooldownSeconds) {
            revert CooldownActive();
        }
        _;
    }

    modifier checkDecryptionCooldown() {
        if (block.timestamp < lastDecryptionRequestTime[msg.sender] + cooldownSeconds) {
            revert CooldownActive();
        }
        _;
    }

    constructor() {
        owner = msg.sender;
        emit OwnershipTransferred(address(0), msg.sender);
    }

    function transferOwnership(address newOwner) external onlyOwner {
        address oldOwner = owner;
        owner = newOwner;
        emit OwnershipTransferred(oldOwner, newOwner);
    }

    function addProvider(address provider) external onlyOwner {
        isProvider[provider] = true;
        emit ProviderAdded(provider);
    }

    function removeProvider(address provider) external onlyOwner {
        isProvider[provider] = false;
        emit ProviderRemoved(provider);
    }

    function setCooldownSeconds(uint256 newCooldown) external onlyOwner {
        uint256 oldCooldown = cooldownSeconds;
        cooldownSeconds = newCooldown;
        emit CooldownSecondsSet(oldCooldown, newCooldown);
    }

    function pause() external onlyOwner whenNotPaused {
        paused = true;
        emit Paused(msg.sender);
    }

    function unpause() external onlyOwner {
        paused = false;
        emit Unpaused(msg.sender);
    }

    function openBatch() external onlyOwner {
        if (batchOpen) revert InvalidBatchState();
        batchOpen = true;
        currentBatchId++;
        emit BatchOpened(currentBatchId);
    }

    function closeBatch() external onlyOwner {
        if (!batchOpen) revert InvalidBatchState();
        batchOpen = false;
        emit BatchClosed(currentBatchId);
    }

    function submitPlayerState(
        euint32 encryptedFunds,
        euint32 encryptedShares,
        euint32 encryptedLastTradePrice
    ) external onlyProvider whenNotPaused checkSubmissionCooldown {
        if (!batchOpen) revert BatchClosedError();
        lastSubmissionTime[msg.sender] = block.timestamp;

        PlayerState storage state = playerStates[msg.sender];
        state.funds = encryptedFunds;
        state.shares = encryptedShares;
        state.lastTradePrice = encryptedLastTradePrice;

        emit PlayerStateSubmitted(msg.sender, currentBatchId);
    }

    function requestTotalValueDecryption() external onlyProvider whenNotPaused checkDecryptionCooldown {
        if (batchOpen) revert InvalidBatchState();
        lastDecryptionRequestTime[msg.sender] = block.timestamp;

        euint32 totalEncryptedValue = FHE.asEuint32(0);
        address[] memory players = new address[](1);
        players[0] = msg.sender;

        for (uint256 i = 0; i < players.length; i++) {
            PlayerState storage state = playerStates[players[i]];
            euint32 assetValue = state.shares.fheMul(state.lastTradePrice);
            totalEncryptedValue = totalEncryptedValue.fheAdd(assetValue);
            totalEncryptedValue = totalEncryptedValue.fheAdd(state.funds);
        }

        bytes32[] memory cts = new bytes32[](1);
        cts[0] = FHE.toBytes32(totalEncryptedValue);

        bytes32 stateHash = _hashCiphertexts(cts);
        uint256 requestId = FHE.requestDecryption(cts, this.myCallback.selector);

        decryptionContexts[requestId] = DecryptionContext({
            batchId: currentBatchId,
            stateHash: stateHash,
            processed: false
        });

        emit DecryptionRequested(requestId, currentBatchId);
    }

    function myCallback(
        uint256 requestId,
        bytes memory cleartexts,
        bytes memory proof
    ) public {
        if (decryptionContexts[requestId].processed) revert ReplayError();

        bytes32[] memory cts = new bytes32[](1);
        cts[0] = FHE.toBytes32(playerStates[msg.sender].funds); // Simplified for example
        bytes32 currentHash = _hashCiphertexts(cts);

        if (currentHash != decryptionContexts[requestId].stateHash) {
            revert StateMismatchError();
        }

        FHE.checkSignatures(requestId, cleartexts, proof);

        uint256 totalValue = abi.decode(cleartexts, (uint256));
        decryptionContexts[requestId].processed = true;

        emit DecryptionCompleted(requestId, decryptionContexts[requestId].batchId, totalValue);
    }

    function _hashCiphertexts(bytes32[] memory cts) internal pure returns (bytes32) {
        return keccak256(abi.encode(cts, address(this)));
    }
}