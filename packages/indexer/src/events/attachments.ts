/**
 * Attachment references carried inside a passport event.
 *
 * A Digital Product Passport is mostly documents: conformity certificates,
 * battery test reports, inspection records. None of them can go on HCS — a
 * topic is a log, capped here at 1024 bytes — so an event carries a *reference*
 * instead.
 *
 * The reference is content-addressed. That is the whole point: with a CID, the
 * address and the integrity proof are the same value, so "where the certificate
 * lives" and "proof it is the certificate that was attested" stop being two
 * separate claims that can drift apart. A plain URL cannot do this; it is a
 * promise that some server will still be there and still be honest.
 *
 * A declared sha256 of the raw bytes is carried alongside the CID, because the
 * CID is a multihash over an IPFS DAG rather than a hash of the file, and for
 * chunked files the two differ. Keeping both means the content can be checked
 * by anyone with a hash function, without needing to speak IPFS.
 *
 * Because attachments live inside `payload`, they are covered by `payloadHash`.
 * Swapping a CID after the fact breaks the event's own hash and the indexer
 * reports it, exactly as it does for a forged custody claim.
 */

/**
 * Where a document lives.
 *
 * IPFS content persists only while somebody keeps paying to pin it, which is a
 * poor fit for a record that must outlive the product and, often, the company
 * that made it. Arweave is paid once and stored by endowment, so it is the
 * right primitive for a passport that has to still resolve in 2045.
 *
 * Both are content-addressed, so verification is identical either way: fetch it
 * back and compare the hash.
 */
export type AttachmentProtocol = "ipfs" | "arweave";

/** One content-addressed document referenced by an event. */
export interface EventAttachment {
  /**
   * Where the content lives. Absent means `ipfs`, so events written before
   * Arweave support keep decoding unchanged.
   */
  protocol?: AttachmentProtocol;
  /** IPFS CID, or Arweave transaction id. */
  cid: string;
  /** sha256 of the raw bytes, lowercase hex. */
  hash: string;
  /** Original filename, for display. */
  name?: string;
  /** Media type, for display and for choosing how to render a link. */
  type?: string;
  /** Size in bytes, as declared at upload time. */
  bytes?: number;
}

/** What the indexer concluded about an attachment after checking it. */
export type AttachmentState = "pending" | "verified" | "mismatch" | "unreachable";

/**
 * Loose CIDv0/CIDv1 shape check.
 *
 * Deliberately a shape check rather than a full multibase decode: the indexer
 * fetches the id and hashes what comes back, so a malformed one fails honestly
 * at that point. This only rejects obvious nonsense before anything is stored.
 */
export function isLikelyCid(value: unknown): value is string {
  if (typeof value !== "string") return false;
  // CIDv0: base58btc, always starts Qm, 46 chars.
  if (/^Qm[1-9A-HJ-NP-Za-km-z]{44}$/.test(value)) return true;
  // CIDv1: base32 lowercase, starts with 'b', typically 59+ chars.
  return /^b[a-z2-7]{50,}$/.test(value);
}

/** Arweave transaction ids are exactly 43 base64url characters. */
export function isLikelyArweaveId(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_-]{43}$/.test(value);
}

/** True when a value is a plausible content id for the given protocol. */
export function isLikelyContentId(value: unknown, protocol: AttachmentProtocol = "ipfs"): value is string {
  return protocol === "arweave" ? isLikelyArweaveId(value) : isLikelyCid(value);
}

/** Reads a declared protocol, defaulting to IPFS. */
function readProtocol(value: unknown): AttachmentProtocol | undefined {
  if (value === "arweave") return "arweave";
  if (value === "ipfs" || value === undefined) return undefined;
  // An unrecognised protocol is not silently treated as IPFS — the entry is
  // dropped by the caller rather than verified against the wrong network.
  return "unsupported" as AttachmentProtocol;
}

/** True when a value is a lowercase hex sha256. */
export function isSha256Hex(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{64}$/.test(value);
}

/**
 * Reads the attachments an event payload declares.
 *
 * Never throws and never guesses. An entry that is not a well-formed reference
 * is dropped rather than stored as an unverifiable half-record — the event
 * itself is still indexed, so nothing is lost from the log.
 *
 * @param payload Event payload.
 * @returns Well-formed attachment references, in declared order.
 */
export function readAttachments(payload: unknown): EventAttachment[] {
  if (typeof payload !== "object" || payload === null) return [];

  const raw = (payload as Record<string, unknown>).attachments;
  if (!Array.isArray(raw)) return [];

  const attachments: EventAttachment[] = [];
  for (const entry of raw) {
    if (typeof entry !== "object" || entry === null) continue;
    const candidate = entry as Record<string, unknown>;

    const protocol = readProtocol(candidate.protocol);
    if (protocol !== undefined && protocol !== "arweave") continue;
    if (!isLikelyContentId(candidate.cid, protocol ?? "ipfs") || !isSha256Hex(candidate.hash)) continue;

    attachments.push({
      ...(protocol ? { protocol } : {}),
      cid: candidate.cid,
      hash: candidate.hash,
      ...(typeof candidate.name === "string" ? { name: candidate.name.slice(0, 120) } : {}),
      ...(typeof candidate.type === "string" ? { type: candidate.type.slice(0, 80) } : {}),
      ...(typeof candidate.bytes === "number" && Number.isFinite(candidate.bytes) ? { bytes: candidate.bytes } : {}),
    });
  }

  return attachments;
}

/** Default public gateway used to read IPFS content back. */
export const DEFAULT_IPFS_GATEWAY = "https://ipfs.io";

/** Default public gateway used to read Arweave content back. */
export const DEFAULT_ARWEAVE_GATEWAY = "https://arweave.net";

/**
 * Builds an HTTP URL for a content id through the right kind of gateway.
 *
 * The path shapes differ — IPFS serves under `/ipfs/<cid>`, Arweave serves the
 * transaction id at the root — so the protocol has to be known, not guessed.
 *
 * @param cid Content identifier.
 * @param gateway Gateway base URL, without a trailing slash.
 * @param protocol Which network the id belongs to.
 * @returns A fetchable URL.
 */
export function gatewayUrl(
  cid: string,
  gateway: string = DEFAULT_IPFS_GATEWAY,
  protocol: AttachmentProtocol = "ipfs",
): string {
  const base = gateway.replace(/\/+$/, "");
  return protocol === "arweave" ? `${base}/${cid}` : `${base}/ipfs/${cid}`;
}

/** The canonical, gateway-independent form of an attachment reference. */
export function contentUri(cid: string, protocol: AttachmentProtocol = "ipfs"): string {
  return protocol === "arweave" ? `ar://${cid}` : `ipfs://${cid}`;
}

/** Back-compatible alias for the IPFS form. */
export function ipfsUri(cid: string): string {
  return contentUri(cid, "ipfs");
}
