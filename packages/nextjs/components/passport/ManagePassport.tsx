"use client";

import { useEffect, useState } from "react";
import { SendToConsumer } from "./SendToConsumer";
import { isAddress } from "viem";
import { useAccount } from "wagmi";
import { useScaffoldWriteContract } from "~~/hooks/scaffold-hbar";
import { getCategory } from "~~/lib/categories";
import { notification } from "~~/utils/scaffold-hbar";

/** Payload fields offered per event type. Unlisted types fall back to a note. */
const PAYLOAD_FIELDS: Record<string, Array<{ key: string; label: string; options?: string[] }>> = {
  "product.shipped": [
    { key: "from", label: "From" },
    { key: "to", label: "To" },
    { key: "carrier", label: "Carrier" },
    { key: "waybill", label: "Waybill" },
  ],
  "product.inspected": [
    { key: "result", label: "Result", options: ["pass", "fail", "conditional"] },
    { key: "inspector", label: "Inspector" },
    { key: "note", label: "Note" },
  ],
  "product.repaired": [
    { key: "component", label: "Component" },
    { key: "note", label: "Note" },
  ],
  "product.recycled": [
    { key: "facility", label: "Facility" },
    { key: "note", label: "Note" },
  ],
};

const FALLBACK_FIELDS = [{ key: "note", label: "Note" }];

/**
 * Logging events and moving custody for one passport.
 *
 * Two operations with different trust models, deliberately kept apart:
 *
 *   Logging an event is a server submission signed by the operator, which holds
 *   the topic's submit key. It changes no on-chain state.
 *
 *   Transferring custody is a wallet transaction moving the NFT. Only the
 *   current holder can do it, and the contract enforces that — this form just
 *   avoids offering it to someone who would be rejected.
 */
export const ManagePassport = ({
  serial,
  tokenId,
  topicId,
  category,
  currentHolder,
}: {
  serial: number;
  tokenId: string;
  topicId: string;
  category: string | null;
  currentHolder: string | null;
}) => {
  const { address } = useAccount();
  const { writeContractAsync } = useScaffoldWriteContract({ contractName: "PassportRegistry" });

  const schema = category ? getCategory(category) : undefined;
  const eventTypes = schema?.eventTypes.filter(type => type !== "custody.transferred") ?? [
    "product.shipped",
    "product.inspected",
    "product.repaired",
    "product.recycled",
  ];

  const [type, setType] = useState(eventTypes[0] ?? "product.shipped");
  const [payload, setPayload] = useState<Record<string, string>>({});
  const [logging, setLogging] = useState(false);

  const [document, setDocument] = useState<File | undefined>();
  const [pinned, setPinned] = useState<
    { cid: string; hash: string; name: string; type: string; bytes: number } | undefined
  >();

  // Undefined until asked, so nothing is claimed before the answer arrives.
  const [storageConfigured, setStorageConfigured] = useState<boolean | undefined>();
  const [recipient, setRecipient] = useState("");
  const [transferring, setTransferring] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/passport/attachments")
      .then(response => (response.ok ? response.json() : undefined))
      .then(body => !cancelled && setStorageConfigured(Boolean(body?.configured)))
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  const fields = PAYLOAD_FIELDS[type] ?? FALLBACK_FIELDS;

  const logEvent = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!address) return;

    const body: Record<string, unknown> = {};
    for (const field of fields) {
      const value = (payload[field.key] ?? "").trim();
      if (value !== "") body[field.key] = value;
    }
    if (Object.keys(body).length === 0 && !document) {
      notification.error("Add at least one detail before logging an event.");
      return;
    }

    setLogging(true);
    try {
      // Pin the document first. The CID and the sha256 the server computed from
      // the bytes it actually received both go into the payload, where
      // payloadHash covers them — so the reference cannot be swapped later
      // without breaking the event's own hash.
      let attachment = pinned;
      if (document && !attachment) {
        const form = new FormData();
        form.append("file", document);
        const upload = await fetch("/api/passport/attachments", { method: "POST", body: form });
        const uploaded = await upload.json();

        if (!upload.ok) {
          notification.error(uploaded.message ?? "Could not store the document.");
          return;
        }
        attachment = uploaded.attachment;
        setPinned(attachment);
      }
      if (attachment) body.attachments = [attachment];

      const response = await fetch("/api/passport/events", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ topicId, type, serial, tokenId, actor: address, payload: body }),
      });
      const result = await response.json();

      if (!response.ok) {
        notification.error(result.message ?? "Could not submit the event.");
        return;
      }

      notification.success(
        `Logged ${type} (${result.bytes} bytes). It appears on the passport once the indexer catches up.`,
      );
      setPayload({});
      setDocument(undefined);
      setPinned(undefined);
    } catch (error) {
      notification.error(error instanceof Error ? error.message : "Could not submit the event.");
    } finally {
      setLogging(false);
    }
  };

  const transfer = async (event: React.FormEvent) => {
    event.preventDefault();
    const to = recipient.trim();
    if (!isAddress(to)) {
      notification.error("Enter the recipient's EVM address (0x…).");
      return;
    }

    setTransferring(true);
    try {
      const hash = await writeContractAsync({ functionName: "transferCustody", args: [BigInt(serial), to] });
      if (!hash) return;

      // The custody claim is recorded only after the transfer actually
      // succeeded, so HCS never carries a handover the chain did not make.
      await fetch("/api/passport/events", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          topicId,
          type: "custody.transferred",
          serial,
          tokenId,
          actor: address,
          payload: { from: currentHolder ?? address, to },
          ref: hash,
        }),
      });

      notification.success(`Custody of serial ${serial} transferred.`);
      setRecipient("");
    } catch (error) {
      notification.error(error instanceof Error ? error.message : "Transfer failed.");
    } finally {
      setTransferring(false);
    }
  };

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      {/* Placed alongside custody transfer because they are the two ways a
          passport changes hands, and an issuer should see the choice. */}
      <form onSubmit={logEvent} className="rounded-2xl border border-base-300 bg-base-100 p-6">
        <h2 className="mb-1 mt-0 text-lg font-bold">Log a lifecycle event</h2>
        <p className="mb-4 mt-0 text-sm text-base-content/60">
          Appended to the product&apos;s topic, hash-anchored, capped at 1024 bytes.
        </p>

        <div className="form-control mb-4 w-full">
          <label className="label pb-1" htmlFor="event-type">
            <span className="label-text">Event type</span>
          </label>
          <select
            id="event-type"
            className="select select-bordered"
            value={type}
            disabled={logging}
            onChange={changed => {
              setType(changed.target.value);
              setPayload({});
            }}
          >
            {eventTypes.map(option => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </div>

        <div className="grid gap-3">
          {fields.map(field => (
            <div key={field.key} className="form-control w-full">
              <label className="label pb-1" htmlFor={`payload-${field.key}`}>
                <span className="label-text">{field.label}</span>
              </label>
              {field.options ? (
                <select
                  id={`payload-${field.key}`}
                  className="select select-bordered"
                  value={payload[field.key] ?? ""}
                  disabled={logging}
                  onChange={changed => setPayload(current => ({ ...current, [field.key]: changed.target.value }))}
                >
                  <option value="">Select…</option>
                  {field.options.map(option => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  id={`payload-${field.key}`}
                  className="input input-bordered"
                  value={payload[field.key] ?? ""}
                  disabled={logging}
                  onChange={changed => setPayload(current => ({ ...current, [field.key]: changed.target.value }))}
                />
              )}
            </div>
          ))}

          <div className="form-control w-full">
            <label className="label pb-1" htmlFor="document">
              <span className="label-text">Attach a document (optional)</span>
            </label>
            <input
              id="document"
              type="file"
              className="file-input file-input-bordered w-full"
              disabled={logging}
              onChange={changed => {
                setDocument(changed.target.files?.[0]);
                // A new file invalidates any CID pinned for the previous one.
                setPinned(undefined);
              }}
            />
            {storageConfigured === false && (
              <span className="mt-1 text-xs text-warning">
                No storage provider is configured, so documents cannot be attached yet. Set{" "}
                <code className="rounded bg-base-300/50 px-1">PINATA_JWT</code> in{" "}
                <code className="rounded bg-base-300/50 px-1">packages/nextjs/.env.local</code> — a free key is enough.
                Everything else on this page works without it.
              </span>
            )}
            <span className="mt-1 text-xs text-base-content/60">
              Pinned to IPFS and referenced by CID. The document never goes on HCS — the event carries its content
              address and a sha256 of the bytes, and the indexer fetches it back to confirm it is still the document
              that was attested.
            </span>
            {pinned && <span className="mt-1 break-all font-mono text-xs text-success">pinned {pinned.cid}</span>}
          </div>
        </div>

        <button type="submit" className="btn btn-primary mt-5" disabled={logging}>
          {logging && <span className="loading loading-spinner loading-xs" />}
          Log event
        </button>
      </form>

      <form onSubmit={transfer} className="rounded-2xl border border-base-300 bg-base-100 p-6">
        <h2 className="mb-1 mt-0 text-lg font-bold">Transfer custody</h2>
        <p className="mb-4 mt-0 text-sm text-base-content/60">
          Moves the NFT, then records the handover on the topic — in that order, so the log never claims a transfer that
          did not happen.
        </p>

        {currentHolder && (
          <div className="mb-4 rounded-lg bg-base-200 p-3 text-sm">
            <span className="text-base-content/60">Current holder</span>
            <div className="font-mono break-all">{currentHolder}</div>
          </div>
        )}

        <div className="form-control w-full">
          <label className="label pb-1" htmlFor="recipient">
            <span className="label-text">Recipient EVM address</span>
          </label>
          <input
            id="recipient"
            className="input input-bordered font-mono"
            placeholder="0x…"
            value={recipient}
            disabled={transferring}
            onChange={changed => setRecipient(changed.target.value)}
          />
        </div>

        <button type="submit" className="btn btn-primary mt-5" disabled={transferring}>
          {transferring && <span className="loading loading-spinner loading-xs" />}
          Transfer custody
        </button>

        <p className="mt-4 mb-0 text-xs text-base-content/60">
          Only the current holder can transfer. The contract enforces this; the wallet you connect must be the holder.
        </p>
      </form>

      <SendToConsumer serial={serial} tokenId={tokenId} />
    </div>
  );
};
