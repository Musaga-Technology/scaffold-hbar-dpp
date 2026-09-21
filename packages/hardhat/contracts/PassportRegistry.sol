// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import { Ownable } from "@openzeppelin/contracts/access/Ownable.sol";
import { IERC721 } from "@openzeppelin/contracts/token/ERC721/IERC721.sol";

import { IHederaTokenService } from "./interfaces/IHederaTokenService.sol";

/// @title PassportRegistry
/// @notice Digital Product Passport registry. Each physical product gets one HTS
///         non-fungible serial minted through the system contract at 0x167, bound
///         to the HCS topic that carries its ordered lifecycle log.
/// @dev Two truth sources meet here. The NFT answers "who holds this product now";
///      HCS answers "what was claimed to have happened, in what order". This
///      contract only ever writes the first, and records the topic id that carries
///      the second. Reconciling the two is the indexer's job — see
///      packages/indexer/src/reconcile.ts. Nothing in this contract trusts HCS.
contract PassportRegistry is Ownable {
    /// @notice Default Hedera Token Service system contract address.
    address public constant DEFAULT_HTS = 0x0000000000000000000000000000000000000167;
    /// @notice Configured HTS address (allows mock injection for testing).
    address public immutable HTS;
    /// @notice Hedera success response code.
    int64 public constant SUCCESS = 22;
    /// @notice Bitmask for the supply key in HTS token key definitions.
    uint256 public constant SUPPLY_KEY = 16;
    /// @notice Auto-renew period for the collection, in seconds (about 91 days).
    int64 public constant AUTO_RENEW_PERIOD = 7_890_000;
    /// @notice Token memo persisted on the HTS collection.
    string public constant COLLECTION_MEMO = "product-passport";
    /// @notice Maximum on-chain metadata size accepted per serial.
    /// @dev HIP-412 metadata is stored off-chain; these bytes hold the URL or a
    ///      compact data URI pointing at it, never the document itself.
    uint256 public constant METADATA_MAX_BYTES = 100;
    /// @notice Maximum accepted length of an HCS topic id string (`0.0.x`).
    uint256 public constant TOPIC_ID_MAX_BYTES = 32;

    /// @notice Registry record for one product passport.
    struct Product {
        /// @notice HCS topic id (`0.0.x`) carrying this product's lifecycle log.
        string topicId;
        /// @notice sha256 of the product's canonical registration payload.
        bytes32 productHash;
        /// @notice Account that registered the product.
        address issuer;
        /// @notice True once the serial has been registered.
        bool exists;
    }

    /// @notice HTS NFT collection address created via the system contract.
    address public collection;
    /// @notice Number of products registered so far.
    uint256 public productCount;

    mapping(int64 serial => Product product) private _products;
    mapping(int64 serial => mapping(address account => bool allowed)) private _eventLoggers;

    /// @notice Accounts allowed to register products, in addition to the owner.
    mapping(address account => bool allowed) public isIssuer;

    /// @notice Emitted when the HTS collection is created.
    /// @param collection Address of the newly created HTS NFT collection.
    /// @param name Token name used for collection creation.
    /// @param symbol Token symbol used for collection creation.
    event CollectionCreated(address indexed collection, string name, string symbol);
    /// @notice Emitted when a product is registered and its serial minted.
    /// @dev The indexer discovers which topics to follow by reading these logs
    ///      from the mirror node, so `topicId` must stay in the event body.
    /// @param serial HTS serial number minted for the product.
    /// @param topicId HCS topic id carrying the product's lifecycle log.
    /// @param productHash sha256 of the product's canonical registration payload.
    /// @param issuer Account that registered the product.
    event ProductRegistered(int64 indexed serial, string topicId, bytes32 productHash, address indexed issuer);
    /// @notice Emitted when custody of a serial moves between accounts.
    /// @param serial HTS serial number transferred.
    /// @param from Previous holder.
    /// @param to New holder.
    event CustodyTransferred(int64 indexed serial, address indexed from, address indexed to);
    /// @notice Emitted when a treasury-held passport is sent to a consumer.
    /// @param serial HTS serial number sent.
    /// @param to Receiving account.
    event PassportAirdropped(int64 indexed serial, address indexed to);
    /// @notice Emitted when an account's issuer permission changes.
    /// @param account Account whose permission changed.
    /// @param allowed True when the account may register products.
    event IssuerSet(address indexed account, bool allowed);
    /// @notice Emitted when an account's event-logging permission changes for a serial.
    /// @param serial Serial the permission applies to.
    /// @param account Account whose permission changed.
    /// @param allowed True when the account may log events for the serial.
    event EventLoggerSet(int64 indexed serial, address indexed account, bool allowed);

    /// @notice Thrown when collection creation is attempted more than once.
    error CollectionAlreadyCreated();
    /// @notice Thrown when an operation requires a collection before it is created.
    error CollectionNotCreated();
    /// @notice Thrown when a required string input is empty.
    error EmptyField();
    /// @notice Thrown when supplied metadata exceeds the configured byte limit.
    error MetadataTooLong();
    /// @notice Thrown when the topic id is empty or exceeds the configured length.
    error InvalidTopicId();
    /// @notice Thrown when the product hash is zero.
    error InvalidProductHash();
    /// @notice Thrown when a zero address is supplied as a transfer recipient.
    error InvalidRecipient();
    /// @notice Thrown when a serial has no registry record.
    /// @param serial Missing serial identifier.
    error ProductNotFound(int64 serial);
    /// @notice Thrown when the caller may not register products.
    /// @param account Rejected caller.
    error NotIssuer(address account);
    /// @notice Thrown when the caller is not the current holder of a serial.
    /// @param serial Serial being transferred.
    /// @param holder Account that actually holds the serial.
    error NotHolder(int64 serial, address holder);
    /// @notice Thrown when airdropping a serial the registry no longer holds.
    /// @param serial Serial being airdropped.
    /// @param holder Account that actually holds the serial.
    error NotTreasuryHeld(int64 serial, address holder);
    /// @notice Thrown when a transfer names the account that already holds the serial.
    error AlreadyHolder();
    /// @notice Thrown when HTS mint returns an unexpected number of serials.
    /// @param count Number of serials returned by HTS.
    error UnexpectedSerialCount(uint256 count);
    /// @notice Thrown when HTS collection creation fails.
    /// @param responseCode HTS response code.
    error HtsCreateFailed(int64 responseCode);
    /// @notice Thrown when HTS mint fails.
    /// @param responseCode HTS response code.
    error HtsMintFailed(int64 responseCode);
    /// @notice Thrown when HTS NFT transfer fails.
    /// @param responseCode HTS response code.
    error HtsTransferFailed(int64 responseCode);

    /// @notice Restricts a call to the owner or an allow-listed issuer.
    modifier onlyIssuer() {
        if (msg.sender != owner() && !isIssuer[msg.sender]) revert NotIssuer(msg.sender);
        _;
    }

    /// @notice Initializes the contract owner and HTS address.
    /// @param initialOwner Account that receives Ownable privileges.
    /// @param htsAddress HTS system contract address (use address(0) for default).
    constructor(address initialOwner, address htsAddress) Ownable(initialOwner) {
        HTS = htsAddress == address(0) ? DEFAULT_HTS : htsAddress;
    }

    /// @notice Creates the HTS NFT collection once.
    /// @dev `msg.value` is forwarded to the system contract to cover the token
    ///      creation fee. Budget roughly 20 HBAR on testnet; too little reverts.
    ///      Freeze and pause keys are deliberately not set — a passport must stay
    ///      transferable for the life of the product. Regulated categories that
    ///      need them should add the keys here and document the consequence.
    /// @param name Name for the HTS NFT collection.
    /// @param symbol Symbol for the HTS NFT collection.
    /// @return createdAddress Address of the created HTS token.
    function createCollection(
        string calldata name,
        string calldata symbol
    ) external payable onlyOwner returns (address createdAddress) {
        if (collection != address(0)) revert CollectionAlreadyCreated();
        if (bytes(name).length == 0 || bytes(symbol).length == 0) revert EmptyField();

        IHederaTokenService.HederaToken memory token = IHederaTokenService.HederaToken({
            name: name,
            symbol: symbol,
            treasury: address(this),
            memo: COLLECTION_MEMO,
            tokenSupplyType: false,
            maxSupply: 0,
            freezeDefault: false,
            tokenKeys: _defaultTokenKeys(),
            expiry: _defaultExpiry()
        });

        (int64 responseCode, address created) = IHederaTokenService(HTS).createNonFungibleToken{ value: msg.value }(
            token
        );
        if (responseCode != SUCCESS) revert HtsCreateFailed(responseCode);

        collection = created;
        emit CollectionCreated(created, name, symbol);
        return created;
    }

    /// @notice Registers a product: mints one serial and binds it to an HCS topic.
    /// @dev The serial stays in the registry treasury until it is transferred or
    ///      airdropped, so the issuer can log events before handing over custody.
    /// @param metadata HIP-412 metadata bytes — a URL or compact data URI, never
    ///        the document itself. Capped at METADATA_MAX_BYTES.
    /// @param productHash sha256 of the product's canonical registration payload.
    /// @param topicId HCS topic id (`0.0.x`) created for this product.
    /// @return serial Newly minted HTS serial number.
    function registerProduct(
        bytes calldata metadata,
        bytes32 productHash,
        string calldata topicId
    ) external onlyIssuer returns (int64 serial) {
        if (collection == address(0)) revert CollectionNotCreated();
        if (metadata.length == 0) revert EmptyField();
        if (metadata.length > METADATA_MAX_BYTES) revert MetadataTooLong();
        if (productHash == bytes32(0)) revert InvalidProductHash();

        uint256 topicIdLength = bytes(topicId).length;
        if (topicIdLength == 0 || topicIdLength > TOPIC_ID_MAX_BYTES) revert InvalidTopicId();

        bytes[] memory metadataList = new bytes[](1);
        metadataList[0] = metadata;

        (int64 responseCode, , int64[] memory serialNumbers) = IHederaTokenService(HTS).mintToken(
            collection,
            0,
            metadataList
        );
        if (responseCode != SUCCESS) revert HtsMintFailed(responseCode);
        if (serialNumbers.length != 1) revert UnexpectedSerialCount(serialNumbers.length);

        serial = serialNumbers[0];
        _products[serial] = Product({ topicId: topicId, productHash: productHash, issuer: msg.sender, exists: true });
        productCount += 1;

        emit ProductRegistered(serial, topicId, productHash, msg.sender);
        return serial;
    }

    /// @notice Transfers custody of a passport from its current holder to another account.
    /// @dev Callable only by the account that currently holds the serial, read
    ///      from the collection's ERC-721 facade rather than from local state, so
    ///      transfers made outside this contract cannot desynchronise custody.
    ///
    ///      On Hedera the holder's signature on the calling transaction authorises
    ///      the underlying `transferNFT`. A contract moving a serial it does not
    ///      hold would instead need an allowance; template users who want that flow
    ///      should call `transferFrom` on the collection's ERC-721 facade directly.
    ///
    ///      This writes custody only. The matching `custody.transferred` event is
    ///      submitted to the product's HCS topic by the app, and the indexer
    ///      reconciles the two — a claim with no matching transfer here surfaces
    ///      as a discrepancy rather than being silently accepted.
    /// @param serial Serial to transfer.
    /// @param to Receiving account.
    function transferCustody(int64 serial, address to) external {
        Product storage product = _products[serial];
        if (!product.exists) revert ProductNotFound(serial);
        if (to == address(0)) revert InvalidRecipient();

        address holder = _holderOf(serial);
        if (msg.sender != holder) revert NotHolder(serial, holder);
        if (to == holder) revert AlreadyHolder();

        int64 responseCode = IHederaTokenService(HTS).transferNFT(collection, holder, to, serial);
        if (responseCode != SUCCESS) revert HtsTransferFailed(responseCode);

        emit CustodyTransferred(serial, holder, to);
    }

    /// @notice Sends a treasury-held passport to a consumer.
    /// @dev HIP-904 `airdropTokens` is not exposed on the HTS system contract
    ///      interface, so this performs a direct `transferNFT` from the registry
    ///      treasury. That requires the receiver to be associated with the token
    ///      (or to have unlimited automatic associations). For a true HIP-904
    ///      airdrop, which stays pending until the receiver claims it, use the
    ///      `TokenAirdropTransaction` server route instead — see
    ///      packages/nextjs/app/api/passport/airdrop.
    /// @param serial Serial to send.
    /// @param to Receiving account.
    function airdropPassport(int64 serial, address to) external {
        Product storage product = _products[serial];
        if (!product.exists) revert ProductNotFound(serial);
        if (to == address(0)) revert InvalidRecipient();
        if (msg.sender != owner() && msg.sender != product.issuer) revert NotIssuer(msg.sender);

        address holder = _holderOf(serial);
        if (holder != address(this)) revert NotTreasuryHeld(serial, holder);

        int64 responseCode = IHederaTokenService(HTS).transferNFT(collection, address(this), to, serial);
        if (responseCode != SUCCESS) revert HtsTransferFailed(responseCode);

        emit PassportAirdropped(serial, to);
        emit CustodyTransferred(serial, address(this), to);
    }

    /// @notice Grants or revokes permission to register products.
    /// @param account Account to update.
    /// @param allowed True to allow the account to register products.
    function setIssuer(address account, bool allowed) external onlyOwner {
        if (account == address(0)) revert InvalidRecipient();
        isIssuer[account] = allowed;
        emit IssuerSet(account, allowed);
    }

    /// @notice Grants or revokes permission to log lifecycle events for a serial.
    /// @dev HCS topics are append-only and this contract cannot police them. The
    ///      allow-list is enforced by the server route that holds the topic's
    ///      submit key: it refuses to submit for an account that is not listed
    ///      here. Treat it as authorisation for the app, not for the ledger — any
    ///      holder of the submit key can always write to the topic directly.
    /// @param serial Serial the permission applies to.
    /// @param account Account to update.
    /// @param allowed True to allow the account to log events for the serial.
    function setEventLogger(int64 serial, address account, bool allowed) external {
        Product storage product = _products[serial];
        if (!product.exists) revert ProductNotFound(serial);
        if (account == address(0)) revert InvalidRecipient();
        if (msg.sender != owner() && msg.sender != product.issuer) revert NotIssuer(msg.sender);

        _eventLoggers[serial][account] = allowed;
        emit EventLoggerSet(serial, account, allowed);
    }

    /// @notice Reports whether an account may log lifecycle events for a serial.
    /// @dev The product's issuer and the registry owner are always permitted.
    /// @param serial Serial to check.
    /// @param account Account to check.
    /// @return allowed True when the account may log events for the serial.
    function isEventLogger(int64 serial, address account) external view returns (bool allowed) {
        Product storage product = _products[serial];
        if (!product.exists) return false;
        return account == owner() || account == product.issuer || _eventLoggers[serial][account];
    }

    /// @notice Returns the registry record for a serial.
    /// @param serial Serial to look up.
    /// @return product Stored registry record.
    function getProduct(int64 serial) external view returns (Product memory product) {
        product = _products[serial];
        if (!product.exists) revert ProductNotFound(serial);
        return product;
    }

    /// @notice Returns the current holder of a serial according to HTS.
    /// @dev Reads the collection's ERC-721 facade, which is the network's own
    ///      answer, not a cached copy kept by this contract.
    /// @param serial Serial to look up.
    /// @return holder Account currently holding the serial.
    function currentHolder(int64 serial) external view returns (address holder) {
        if (!_products[serial].exists) revert ProductNotFound(serial);
        return _holderOf(serial);
    }

    /// @notice Reads the current holder of a serial from the collection facade.
    /// @param serial Serial to look up.
    /// @return holder Account currently holding the serial.
    function _holderOf(int64 serial) internal view returns (address holder) {
        if (collection == address(0)) revert CollectionNotCreated();
        return IERC721(collection).ownerOf(uint256(uint64(serial)));
    }

    /// @notice Builds the token key configuration for collection creation.
    /// @dev Only a supply key is set, held by this contract, so the registry is
    ///      the sole minter. No admin key means the collection is immutable; no
    ///      freeze, pause or wipe keys means a passport cannot be frozen or
    ///      clawed back, which is the property a passport needs.
    /// @return keys One-element key list containing the supply key.
    function _defaultTokenKeys() internal view returns (IHederaTokenService.TokenKey[] memory keys) {
        keys = new IHederaTokenService.TokenKey[](1);
        keys[0] = IHederaTokenService.TokenKey({
            keyType: SUPPLY_KEY,
            key: IHederaTokenService.KeyValue({
                inheritAccountKey: false,
                contractId: address(0),
                ed25519: "",
                ECDSA_secp256k1: "",
                delegatableContractId: address(this)
            })
        });
        return keys;
    }

    /// @notice Builds the token expiry configuration for collection creation.
    /// @dev Uses the contract as autoRenewAccount so the delegatable supply key
    ///      authorisation covers renewal too.
    /// @return expiry Expiry object passed to the HTS create token call.
    function _defaultExpiry() internal view returns (IHederaTokenService.Expiry memory expiry) {
        return
            IHederaTokenService.Expiry({
                second: 0,
                autoRenewAccount: address(this),
                autoRenewPeriod: AUTO_RENEW_PERIOD
            });
    }
}
