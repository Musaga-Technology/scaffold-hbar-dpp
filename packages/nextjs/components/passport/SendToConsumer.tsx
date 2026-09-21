"use client";

import { useState } from "react";
import { ArrowTopRightOnSquareIcon, CheckCircleIcon, ClockIcon } from "@heroicons/react/24/outline";
import { hashscan } from "~~/lib/hashscan";
import { notification } from "~~/utils/scaffold-hbar";

interface AirdropResult {
  delivered: boolean;
  transactionId: string;
  receiver: string;
  note: string;
}

/**
 * Hands a passport to the person who bought the product.
 *
 * Uses HIP-904, which is the reason this is possible at all without asking a
 * consumer to do anything first. On Hedera a receiver normally has to associate
 * a token before they can hold it; an airdrop either delivers straight away, if
 * they have an automatic-association slot free, or parks a pending transfer for
 * them to claim.
 *
 * The two outcomes are reported differently on purpose. "Delivered" means they
 * hold it. "Pending" means they hold nothing yet. Collapsing both into a tick
 * would tell an issuer their customer has something when they do not.
 */
export const SendToConsumer = ({ serial, tokenId }: { serial: number; tokenId: string }) => {
  const [receiver, setReceiver] = useState("");
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<AirdropResult | undefined>();

  const send = async (event: React.FormEvent) => {
    event.preventDefault();
    const trimmed = receiver.trim();
    if (trimmed === "") return;

    setSending(true);
    try {
      const response = await fetch("/api/passport/airdrop", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ tokenId, serial, receiver: trimmed }),
      });
      const body = await response.json();

      if (!response.ok) {
        notification.error(body.message ?? "Could not send the passport.");
        return;
      }

      setResult(body);
      setReceiver("");
    } catch (error) {
      notification.error(error instanceof Error ? error.message : "Could not send the passport.");
    } finally {
      setSending(false);
    }
  };

  return (
    <form onSubmit={send} className="rounded-2xl border border-base-300 bg-base-100 p-6">
      <h2 className="mb-1 mt-0 text-lg font-bold">Send to a consumer</h2>
      <p className="mb-4 mt-0 text-sm text-base-content/60">
        Airdrops this passport to a buyer. They do not need to associate the token first — that is what HIP-904 is for.
        Sends from the operator account, so it only works while the operator still holds the serial.
      </p>

      {result && (
        <div
          className={`mb-4 rounded-xl border p-3 text-sm ${
            result.delivered ? "border-success bg-success/5" : "border-warning bg-warning/5"
          }`}
          data-testid="airdrop-result"
        >
          <div className="flex items-center gap-2 font-semibold">
            {result.delivered ? (
              <CheckCircleIcon className="h-5 w-5 text-success" />
            ) : (
              <ClockIcon className="h-5 w-5 text-warning" />
            )}
            {result.delivered ? "Delivered" : "Pending claim"}
          </div>
          <p className="mb-2 mt-1">{result.note}</p>
          <a
            href={hashscan.transaction(result.transactionId)}
            target="_blank"
            rel="noreferrer"
            className="link link-hover inline-flex items-center gap-1 text-xs text-primary"
          >
            Transaction on HashScan
            <ArrowTopRightOnSquareIcon className="h-3 w-3" />
          </a>
        </div>
      )}

      <div className="form-control w-full">
        <label className="label pb-1" htmlFor="receiver">
          <span className="label-text">Recipient</span>
        </label>
        <input
          id="receiver"
          className="input input-bordered font-mono"
          placeholder="0.0.12345 or 0x…"
          value={receiver}
          disabled={sending}
          onChange={changed => setReceiver(changed.target.value)}
        />
        <span className="mt-1 text-xs text-base-content/60">
          A Hedera account id, or an EVM address that already has an account.
        </span>
      </div>

      <button type="submit" className="btn btn-primary mt-5" disabled={sending || receiver.trim() === ""}>
        {sending && <span className="loading loading-spinner loading-xs" />}
        Send passport
      </button>
    </form>
  );
};
