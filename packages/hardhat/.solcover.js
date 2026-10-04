// Coverage of the contracts that ship. MockHTS is the local stand-in for the
// HTS system contract, and the interface has no code of its own.
module.exports = {
  skipFiles: ["test/MockHTS.sol", "interfaces/IHederaTokenService.sol"],
};
