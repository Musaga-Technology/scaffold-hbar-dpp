"use client";

import { useState } from "react";
import Link from "next/link";
import { SchemaForm } from "./SchemaForm";
import { METADATA_POINTER_MAX_BYTES, checkMetadataPointer } from "@sh/indexer/events/metadata";
import { canonicalize } from "@sh/indexer/events/canonicalize";
import { decodeEventLog, toBytes, toHex } from "viem";
import { useAccount, usePublicClient } from "wagmi";
import { ArrowTopRightOnSquareIcon, CheckCircleIcon } from "@heroicons/react/24/outline";
import { useScaffoldWriteContract } from "~~/hooks/scaffold-hbar";
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
export const RegisterProductForm = ({ tokenId }: { tokenId: string }) => {
  const { address } = useAccount();
  const publicClient = usePublicClient();
  const { writeContractAsync } = useScaffoldWriteContract({ contractName: "PassportRegistry" });

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

    const found = validateCategoryValues(category, values);
    setIssues(found);
    if (found.length > 0) return;

    const payload = toPayload(category, values);

    try {
      // 1. The topic has to exist before the mint that references it.
      setBusy("Creating the product's HCS topic…");
      const topicResponse = await fetch("/api/passport/topics", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ tokenId }),
      });
      const topicBody = await topicResponse.json();
      if (!topicResponse.ok) {
        notification.error(topicBody.message ?? "Could not create the topic.");
        return;
      }
      const topicId: string = topicBody.topicId;

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
      });
      if (!hash) return;

      setBusy("Reading the minted serial…");
      const receipt = await publicClient?.waitForTransactionReceipt({ hash });
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
      <div className="form-control mb-4 w-full max-w-sm">
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
        <button type="submit" className="btn btn-primary" disabled={Boolean(busy)}>
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
