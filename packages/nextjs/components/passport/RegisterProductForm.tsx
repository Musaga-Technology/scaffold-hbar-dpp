"use client";

import { useState } from "react";
import Link from "next/link";
import { OperatorNotice, useOperatorConfigured } from "./OperatorNotice";
import { SchemaForm } from "./SchemaForm";
import { canonicalize } from "@sh/indexer/events/canonicalize";
import { METADATA_POINTER_MAX_BYTES, checkMetadataPointer } from "@sh/indexer/events/metadata";
import { decodeEventLog, toBytes, toHex } from "viem";
import { useAccount, usePublicClient } from "wagmi";
import { ArrowTopRightOnSquareIcon, CheckCircleIcon, NoSymbolIcon } from "@heroicons/react/24/outline";
import { useScaffoldReadContract, useScaffoldWriteContract } from "~~/hooks/scaffold-hbar";
import { CATEGORIES, type FieldIssue, toPayload, validateCategoryValues } from "~~/lib/categories";
import { hashscan } from "~~/lib/hashscan";
import { notification } from "~~/utils/scaffold-hbar";

/** Minimal ABI fragment for reading the serial back out of the mint receipt. */
const PRODUCT_REGISTERED_ABI = [
  {
    type: "event",
    name: "ProductRegistered",
    inputs: [
      { name: "serial", type: "int64", indexed: true },
      { name: "topicId", type: "string", indexed: false },
      { name: "productHash", type: "bytes32", indexed: false },
      { name: "issuer", type: "address", indexed: true },
    ],
  },
] as const;

interface Registered {
  serial: number;
  topicId: string;
  tokenId: string;
  transactionHash: string;
  metadataPointer: string;
}

/**
 * Registers a product: topic, mint, then the first lifecycle event.
 *
 * The order is forced by the contract. `registerProduct` takes the topic id as
 * an argument, so the topic must exist before the mint — which is also why the
 * metadata URL is keyed by topic rather than by a serial that does not exist
 * yet.
 *
 * Each step reports its own failure. A run that creates a topic and then fails
 * to mint has spent real HBAR, and saying so plainly is better than a generic
 * error that leaves an orphaned topic unexplained.
 */
/**
 * Gas for registerProduct. It mints through the HTS system contract, and wallet
 * estimation under-reports that: a MetaMask estimate of 366,248 ran out with
 * INSUFFICIENT_GAS, while the bootstrap's registrations used 392k and 408k
 * under this limit. Hedera charged those about 0.43 HBAR each — what they used,
 * not what the limit allowed — so headroom costs nothing, and running out burns
 * the fee anyway.
 */
const REGISTER_GAS = 1_500_000n;

/** Where a topic created for a registration that has not completed is kept. */
const pendingTopicKey = (tokenId: string) => `passport:pending-topic:${tokenId}`;

function readPendingTopic(tokenId: string): string | undefined {
  try {
    return sessionStorage.getItem(pendingTopicKey(tokenId)) ?? undefined;
  } catch {
    return undefined;
  }
}

function writePendingTopic(tokenId: string, topicId: string | undefined): void {
  try {
    if (topicId) sessionStorage.setItem(pendingTopicKey(tokenId), topicId);
    else sessionStorage.removeItem(pendingTopicKey(tokenId));
  } catch {
    // Storage unavailable: a retry creates a fresh topic, as before.
  }
}

export const RegisterProductForm = ({ tokenId }: { tokenId: string }) => {
  const { address } = useAccount();
  const publicClient = usePublicClient();
  const { writeContractAsync } = useScaffoldWriteContract({ contractName: "PassportRegistry" });

  // Both checked before the form can start. Registration creates the topic
  // first and mints second, so without these a wallet the registry refuses got
  // as far as paying for a topic before reverting with NotIssuer.
  const operatorConfigured = useOperatorConfigured();
  const { data: owner } = useScaffoldReadContract({ contractName: "PassportRegistry", functionName: "owner" });
  const { data: isIssuer } = useScaffoldReadContract({
    contractName: "PassportRegistry",
    functionName: "isIssuer",
    args: [address],
    query: { enabled: Boolean(address) },
  });
  const isOwner = Boolean(address && owner && owner.toLowerCase() === address.toLowerCase());
  // Undefined while either read is in flight, so nothing is refused early.
  const mayRegister = owner === undefined || isIssuer === undefined ? undefined : isOwner || isIssuer;
  const blocked = operatorConfigured === false || mayRegister === false;

  const [categoryId, setCategoryId] = useState(CATEGORIES[0]?.id ?? "generic");
  const [values, setValues] = useState<Record<string, string>>({});
  const [issues, setIssues] = useState<FieldIssue[]>([]);
  const [busy, setBusy] = useState<string | undefined>();
  const [result, setResult] = useState<Registered | undefined>();

  const category = CATEGORIES.find(candidate => candidate.id === categoryId) ?? CATEGORIES[0]!;

  const reset = () => {
    setResult(undefined);
    setValues({});
    setIssues([]);
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!address) return;

    if (blocked) return;

    const found = validateCategoryValues(category, values);
    setIssues(found);
    if (found.length > 0) return;

    const payload = toPayload(category, values);

    try {
      // 1. The topic has to exist before the mint that references it. A topic
      //    left by an attempt that failed afterwards — a rejected prompt, a
      //    reverted transaction — is offered back to the server, which reuses
      //    it only if nothing has claimed it.
      setBusy("Preparing the product's HCS topic…");
      const topicResponse = await fetch("/api/passport/topics", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ tokenId, reuse: readPendingTopic(tokenId) }),
      });
      const topicBody = await topicResponse.json();
      if (!topicResponse.ok) {
        notification.error(topicBody.message ?? "Could not create the topic.");
        return;
      }
      const topicId: string = topicBody.topicId;
      writePendingTopic(tokenId, topicId);

      // 2. Pin the HIP-412 metadata, so the token's pointer does not depend on
      //    this app staying online. Falls back to an app URL when no storage
      //    provider is configured — documented as the weaker option.
      setBusy("Pinning the passport's metadata…");
      // Canonical JSON, hashed with Web Crypto — the same serialisation the
      // indexer verifies with. Hashing JSON.stringify output instead would
      // depend on key order and produce a hash nobody could reproduce.
      const productHash = toHex(
        new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonicalize(payload)))),
      );

      // Without a storage provider this stays an app URL, which works but ties
      // the token's identity to this server staying up.
      let metadataPointer = `${window.location.origin}/api/passport/metadata/${topicId}`;
      const metadataResponse = await fetch("/api/passport/metadata", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ category: category.id, topicId, productHash, fields: payload }),
      });
      if (metadataResponse.ok) {
        const metadataBody = await metadataResponse.json();
        if (metadataBody.uri) metadataPointer = metadataBody.uri;
      }

      const pointerSize = checkMetadataPointer(metadataPointer);
      if (!pointerSize.fits) {
        notification.error(
          `The metadata pointer is ${pointerSize.bytes} bytes, over the registry's ${METADATA_POINTER_MAX_BYTES}-byte limit. ` +
            "Configure PINATA_JWT so it can be a short ipfs:// reference instead of a long URL.",
        );
        return;
      }

      // 3. Mint the serial and bind it to that topic.
      setBusy("Registering the product on-chain…");

      const hash = await writeContractAsync({
        functionName: "registerProduct",
        args: [toHex(toBytes(metadataPointer)), productHash, topicId],
        gas: REGISTER_GAS,
      });
      if (!hash) return;

      setBusy("Reading the minted serial…");
      const receipt = await publicClient?.waitForTransactionReceipt({ hash });
      if (receipt?.status === "reverted") {
        // Keep the pending topic: nothing claimed it, and the retry reuses it.
        notification.error(
          "The registration transaction was included but reverted, so no serial was minted. " +
            "Try again — the topic already created will be reused.",
        );
        return;
      }
      // Minted: this topic now belongs to that serial and must never be reused.
      writePendingTopic(tokenId, undefined);
      let serial: number | undefined;
      for (const log of receipt?.logs ?? []) {
        try {
          const decoded = decodeEventLog({ abi: PRODUCT_REGISTERED_ABI, ...log });
          if (decoded.eventName === "ProductRegistered") {
            serial = Number(decoded.args.serial);
            break;
          }
        } catch {
          // Not our event; the receipt carries HTS logs too.
        }
      }

      if (serial === undefined) {
        notification.error(
          "The product was registered but the serial could not be read from the receipt. " +
            "The indexer will pick it up — check the issuer list shortly.",
        );
        return;
      }

      // 4. Record the registration on the topic, referencing the mint.
      setBusy("Writing the first lifecycle event…");
      const eventResponse = await fetch("/api/passport/events", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          topicId,
          type: "product.registered",
          serial,
          tokenId,
          actor: address,
          payload,
          ref: hash,
        }),
      });
      if (!eventResponse.ok) {
        const body = await eventResponse.json();
        notification.error(`Serial ${serial} was minted, but its first event could not be submitted: ${body.message}`);
      }

      setResult({ serial, topicId, tokenId, transactionHash: hash, metadataPointer });
    } catch (error) {
      notification.error(error instanceof Error ? error.message : "Registration failed.");
    } finally {
      setBusy(undefined);
    }
  };

  if (result) {
    return (
      <div className="rounded-2xl border border-success bg-success/5 p-6" data-testid="register-success">
        <div className="mb-4 flex items-center gap-2 text-success">
          <CheckCircleIcon className="h-6 w-6" />
          <h2 className="m-0 text-lg font-bold">Serial {result.serial} registered</h2>
        </div>

        <dl className="mb-4 grid gap-2 text-sm">
          <div className="flex justify-between gap-4">
            <dt className="text-base-content/60">Token</dt>
            <dd className="m-0 font-mono">{result.tokenId}</dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-base-content/60">Serial</dt>
            <dd className="m-0 font-mono">{result.serial}</dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-base-content/60">Topic</dt>
            <dd className="m-0 font-mono">{result.topicId}</dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-base-content/60">Metadata</dt>
            <dd className="m-0 break-all text-right font-mono text-xs">{result.metadataPointer}</dd>
          </div>
        </dl>

        <p className="mb-4 text-sm text-base-content/70">
          The passport page will fill in once the indexer catches up — usually within a few seconds of consensus.
        </p>

        <div className="flex flex-wrap gap-2">
          <Link href={`/verify/${result.serial}`} className="btn btn-primary btn-sm">
            Open the passport
          </Link>
          <Link href={`/issuer/${result.serial}`} className="btn btn-outline btn-sm">
            Log an event
          </Link>
          <a
            href={hashscan.transaction(result.transactionHash)}
            target="_blank"
            rel="noreferrer"
            className="btn btn-ghost btn-sm gap-1"
          >
            Mint on HashScan
            <ArrowTopRightOnSquareIcon className="h-4 w-4" />
          </a>
          <button type="button" className="btn btn-ghost btn-sm" onClick={reset}>
            Register another
          </button>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="rounded-2xl border border-base-300 bg-base-100 p-6">
      {operatorConfigured === false && <OperatorNotice />}

      {mayRegister === false && (
        <div className="alert alert-error mb-5 items-start" data-testid="not-issuer-notice">
          <NoSymbolIcon className="mt-0.5 h-5 w-5 shrink-0" />
          <div className="text-sm">
            <p className="m-0 font-semibold">This wallet cannot register products in this registry.</p>
            <p className="mb-0 mt-1">
              Only the registry owner and wallets it has allow-listed can. Connect the account you ran the bootstrap
              with
              {owner ? (
                <>
                  {" "}
                  — <code className="break-all rounded bg-base-300/50 px-1">{owner}</code>
                </>
              ) : null}
              , or have the owner call <code className="rounded bg-base-300/50 px-1">setIssuer</code> for this address
              on the Debug Contracts page.
            </p>
          </div>
        </div>
      )}

      <div className="form-control mb-4 flex w-full max-w-sm flex-col">
        <label className="label pb-1" htmlFor="category">
          <span className="label-text font-semibold">Product category</span>
        </label>
        <select
          id="category"
          className="select select-bordered"
          value={categoryId}
          disabled={Boolean(busy)}
          onChange={event => {
            setCategoryId(event.target.value);
            setValues({});
            setIssues([]);
          }}
        >
          {CATEGORIES.map(option => (
            <option key={option.id} value={option.id}>
              {option.label}
            </option>
          ))}
        </select>
        {category.description && <span className="mt-1 text-xs text-base-content/60">{category.description}</span>}
      </div>

      <SchemaForm
        category={category}
        values={values}
        issues={issues}
        disabled={Boolean(busy)}
        onChange={(key, value) => setValues(current => ({ ...current, [key]: value }))}
      />

      <div className="mt-6 flex flex-wrap items-center gap-3">
        <button type="submit" className="btn btn-primary" disabled={Boolean(busy) || blocked}>
          {busy && <span className="loading loading-spinner loading-xs" />}
          {busy ? "Working…" : "Register product"}
        </button>
        {busy && <span className="text-sm text-base-content/70">{busy}</span>}
      </div>

      <p className="mt-4 mb-0 text-xs text-base-content/60">
        Registering creates an HCS topic, mints one NFT serial and writes the first lifecycle event. All three cost HBAR
        on Hedera testnet.
      </p>
    </form>
  );
};
