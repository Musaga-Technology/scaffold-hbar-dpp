"use client";

import { useEffect, useState } from "react";
import { ExclamationTriangleIcon } from "@heroicons/react/24/outline";

/**
 * Whether the server has operator credentials, asked once.
 *
 * Undefined until the answer arrives, so nothing is claimed early. The issuer
 * pages create topics and submit events server-side, and the bootstrap
 * deliberately never writes a key into the app — so this is the first thing a
 * developer who has just bootstrapped will hit on /issuer.
 */
export function useOperatorConfigured(): boolean | undefined {
  const [configured, setConfigured] = useState<boolean | undefined>();

  useEffect(() => {
    let cancelled = false;
    fetch("/api/passport/topics")
      .then(response => (response.ok ? response.json() : undefined))
      .then(body => !cancelled && setConfigured(body ? Boolean(body.configured) : undefined))
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  return configured;
}

/** Explains how to give the app an operator, shown before any form is filled in. */
export const OperatorNotice = () => (
  <div className="alert alert-warning mb-5 items-start" data-testid="operator-notice">
    <ExclamationTriangleIcon className="mt-0.5 h-5 w-5 shrink-0" />
    <div className="text-sm">
      <p className="m-0 font-semibold">This app has no operator key yet, so it cannot write to Hedera.</p>
      <p className="mb-2 mt-1">
        Registering and logging events create HCS topics and messages from the server. The bootstrap never copies a key
        into the app, so add one to <code className="rounded bg-base-300/50 px-1">packages/nextjs/.env.local</code> and
        restart <code className="rounded bg-base-300/50 px-1">yarn next:start</code>:
      </p>
      <pre className="m-0 overflow-x-auto rounded-lg bg-base-300/40 p-2 text-xs">
        <code>{"HEDERA_OPERATOR_ID=0.0.xxxx\nHEDERA_OPERATOR_PRIVATE_KEY=0x…   # ECDSA, hex"}</code>
      </pre>
      <p className="mb-0 mt-2">
        The account the bootstrap printed as <code className="rounded bg-base-300/50 px-1">operator</code> works; its
        key is your deployer key, which{" "}
        <code className="rounded bg-base-300/50 px-1">yarn hardhat:account:reveal-pk</code> prints. Keep both
        server-side: never prefix them with <code className="rounded bg-base-300/50 px-1">NEXT_PUBLIC_</code>.
      </p>
    </div>
  </div>
);
