"use client";

import { useEffect, useState } from "react";
import { ExclamationTriangleIcon } from "@heroicons/react/24/outline";

/** One reason the operator cannot be used, as the server reports it. */
interface OperatorProblem {
  variable: string;
  problem: string;
}

interface OperatorStatus {
  /** Undefined until the server answers, so nothing is claimed early. */
  configured: boolean | undefined;
  problems: OperatorProblem[];
}

/**
 * Whether the server has usable operator credentials, asked once.
 *
 * The issuer pages create topics and submit events server-side. The bootstrap
 * writes the operator's account id into the app but deliberately never its key
 * — so the key is the first thing a developer who has just bootstrapped will
 * be asked for on /issuer.
 */
export function useOperatorStatus(): OperatorStatus {
  const [status, setStatus] = useState<OperatorStatus>({ configured: undefined, problems: [] });

  useEffect(() => {
    let cancelled = false;
    fetch("/api/passport/topics")
      .then(response => (response.ok ? response.json() : undefined))
      .then(body => {
        if (cancelled || !body) return;
        setStatus({
          configured: Boolean(body.configured),
          problems: Array.isArray(body.problems) ? body.problems : [],
        });
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  return status;
}

/** Whether the server has usable operator credentials; undefined until known. */
export function useOperatorConfigured(): boolean | undefined {
  return useOperatorStatus().configured;
}

const EXAMPLE_LINES: Record<string, string> = {
  HEDERA_OPERATOR_ID: "HEDERA_OPERATOR_ID=0.0.xxxx          # the account id, not the 0x address",
  HEDERA_OPERATOR_PRIVATE_KEY: "HEDERA_OPERATOR_PRIVATE_KEY=0x…      # ECDSA private key, hex",
};

/**
 * Explains exactly what to fix so the app can write to Hedera, shown before any
 * form is filled in. Names the variables at fault rather than saying "no key",
 * which read as the key being ignored when it was the id that was missing.
 */
export const OperatorNotice = () => {
  const { problems } = useOperatorStatus();
  // Until the server answers, show both lines so the instructions are complete.
  const shown: OperatorProblem[] =
    problems.length > 0 ? problems : Object.keys(EXAMPLE_LINES).map(variable => ({ variable, problem: "is not set" }));
  const variables = [...new Set(shown.map(entry => entry.variable))];

  return (
    <div className="alert alert-warning mb-5 items-start" data-testid="operator-notice">
      <ExclamationTriangleIcon className="mt-0.5 h-5 w-5 shrink-0" />
      <div className="text-sm">
        <p className="m-0 font-semibold">This app cannot write to Hedera yet.</p>
        <p className="mb-2 mt-1">
          Registering and logging events create HCS topics and messages from the server, which needs an operator account
          id <em>and</em> its key. The bootstrap writes the id; it never writes the key.
        </p>
        <ul className="mb-2 mt-0 pl-5">
          {shown.map(entry => (
            <li key={`${entry.variable}-${entry.problem}`}>
              <code className="rounded bg-base-300/50 px-1">{entry.variable}</code> {entry.problem}.
            </li>
          ))}
        </ul>
        <p className="mb-2 mt-0">
          Set {variables.length === 1 ? "it" : "them"} in{" "}
          <code className="rounded bg-base-300/50 px-1">packages/nextjs/.env.local</code>, then reload this page:
        </p>
        <pre className="m-0 overflow-x-auto rounded-lg bg-base-300/40 p-2 text-xs">
          <code>{variables.map(variable => EXAMPLE_LINES[variable] ?? `${variable}=…`).join("\n")}</code>
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
};
