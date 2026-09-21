/**
 * Shared constants for the product-passport application.
 * Centralizes magic numbers and configuration values.
 */

// Polling
export const PENDING_EXPIRY_MS = 5 * 60 * 1000; // 5 minutes
export const POLL_INTERVAL_MS = 3000; // 3 seconds

// Pagination
export const DEFAULT_PAGE_SIZE = 12;

/**
 * Gas limits for the PassportRegistry's HTS system-contract calls.
 * HTS operations routed through 0x167 cost far more gas than plain EVM storage
 * writes, so each write path gets an explicit ceiling rather than relying on
 * estimation (which under-estimates precompile calls on Hedera).
 */
export const GAS_LIMITS = {
  CREATE_COLLECTION: 2_000_000n,
  REGISTER_PRODUCT: 1_500_000n,
  TRANSFER_CUSTODY: 1_200_000n,
  AIRDROP_PASSPORT: 1_200_000n,
  SET_ISSUER: 200_000n,
  SET_EVENT_LOGGER: 200_000n,
} as const;

// Addresses
export const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

// Session storage keys
export const STORAGE_KEYS = {
  PENDING_REGISTRATION: "pendingRegistration",
  PENDING_EVENT: "pendingEvent",
} as const;

/** Verification status for a passport, as computed by the indexer's reconciliation pass. */
export enum VerificationStatus {
  Verified = "verified",
  Pending = "pending",
  Discrepancy = "discrepancy",
}

/** Per-event reconciliation outcome recorded by the indexer. */
export enum ReconciliationState {
  NotApplicable = "n/a",
  Reconciled = "reconciled",
  Discrepancy = "discrepancy",
  Pending = "pending",
}
