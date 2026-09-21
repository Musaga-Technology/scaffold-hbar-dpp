"use client";

import { useEffect, useState } from "react";
import { QRCodeCanvas } from "qrcode.react";
import { CheckIcon, ClipboardDocumentIcon } from "@heroicons/react/24/outline";

/**
 * The scannable code that puts this passport in a stranger's hand.
 *
 * The encoded URL is also shown as text: a QR nobody can read is unverifiable,
 * and acceptance assertion C4 checks that the adjacent text resolves to the
 * same passport.
 *
 * The absolute URL is built on the client because the correct origin is
 * whatever host is actually serving the page — a fixed value baked at build
 * time would be wrong on every deployment but one.
 */
export const QrPanel = ({ path, serial }: { path: string; serial: number }) => {
  const [origin, setOrigin] = useState("");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    setOrigin(window.location.origin);
  }, []);

  const absolute = origin ? `${origin}${path}` : path;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(absolute);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard access can be denied; the URL is on screen to copy by hand.
      setCopied(false);
    }
  };

  return (
    <div className="rounded-2xl border border-base-300 bg-base-100 p-5" data-testid="qr-panel">
      <h2 className="mb-3 mt-0 text-sm font-semibold uppercase tracking-wider text-base-content/60">
        Scan this passport
      </h2>

      <div className="flex flex-col items-center gap-3">
        <div className="rounded-xl bg-white p-3">
          <QRCodeCanvas
            value={absolute}
            size={160}
            level="M"
            aria-label={`QR code linking to the passport for serial ${serial}`}
          />
        </div>

        <code className="break-all text-center text-xs text-base-content/70" data-testid="qr-url">
          {absolute}
        </code>

        <button type="button" className="btn btn-sm btn-outline gap-1" onClick={copy}>
          {copied ? <CheckIcon className="h-4 w-4" /> : <ClipboardDocumentIcon className="h-4 w-4" />}
          {copied ? "Copied" : "Copy link"}
        </button>
      </div>
    </div>
  );
};
