import Link from "next/link";
import {
  ArrowTopRightOnSquareIcon,
  CheckCircleIcon,
  ClockIcon,
  DocumentTextIcon,
  ExclamationTriangleIcon,
  QuestionMarkCircleIcon,
} from "@heroicons/react/24/outline";
import type { AttachmentState, PassportAttachment } from "~~/lib/indexClient";

/**
 * The documents a passport references, and whether they still are what was
 * attested.
 *
 * This is the part of the storage integration that is worth anything. Pinning a
 * certificate is easy; what is shown here is the indexer having fetched each
 * document back from untrusted gateways, checked every block against its CID,
 * and compared the result with the sha256 committed on HCS.
 *
 * The four states are kept distinct on purpose, especially the last two:
 * `mismatch` means the attestation contradicts itself — the hash on HCS is not
 * the hash of the document the CID names. Content behind a CID cannot change,
 * so this is not "replaced later"; it was wrong when it was written. That is
 * fraud-shaped. `unreachable` usually means a gateway is having a bad day. A UI
 * that collapsed them into one red badge would be crying wolf, and would train
 * people to ignore the badge that matters.
 */
const PRESENTATION: Record<
  AttachmentState,
  { label: string; className: string; icon: typeof CheckCircleIcon; blurb: string }
> = {
  verified: {
    label: "Verified",
    className: "text-success",
    icon: CheckCircleIcon,
    blurb: "Checked against its address and the hash on HCS — this is the document that was attested.",
  },
  mismatch: {
    label: "Does not match",
    className: "text-error",
    icon: ExclamationTriangleIcon,
    blurb: "This address holds a different document from the one whose hash was attested.",
  },
  unreachable: {
    label: "Unreachable",
    className: "text-warning",
    icon: QuestionMarkCircleIcon,
    blurb: "Could not be fetched. That is not evidence it is wrong, only that it could not be checked.",
  },
  pending: {
    label: "Not yet checked",
    className: "text-base-content/50",
    icon: ClockIcon,
    blurb: "The indexer has not verified this document yet.",
  },
};

function humanBytes(bytes: number | null): string | undefined {
  if (bytes === null || bytes === undefined) return undefined;
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} kB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export const Documents = ({
  attachments,
  // inbrowser.link verifies the document against its CID in the viewer's own
  // browser. ipfs.io stopped serving files directly in September 2026.
  gateways = { ipfs: "https://inbrowser.link", arweave: "https://arweave.net" },
  demo = false,
}: {
  attachments: PassportAttachment[];
  gateways?: { ipfs: string; arweave: string };
  demo?: boolean;
}) => {
  if (attachments.length === 0) return null;

  const contradicted = attachments.filter(attachment => attachment.state === "mismatch").length;

  return (
    <section className="mt-10" data-testid="documents">
      <div className="mb-3 flex items-baseline justify-between">
        <h2 className="m-0 text-lg font-bold">Documents</h2>
        <span className="text-sm text-base-content/60">{attachments.length} referenced, content-addressed on IPFS</span>
      </div>

      {contradicted > 0 && (
        <div className="alert alert-error mb-4" data-testid="document-alert">
          <ExclamationTriangleIcon className="h-5 w-5 shrink-0" />
          <span>
            <strong>
              {contradicted === 1
                ? "A document does not match its attestation."
                : `${contradicted} documents do not match their attestations.`}
            </strong>{" "}
            The hash recorded on HCS is not the hash of the document the passport points to. Content at a CID cannot
            change afterwards, so this was wrong from the moment it was written.
          </span>
        </div>
      )}

      <ul className="flex list-none flex-col gap-3 pl-0">
        {attachments.map(attachment => {
          const { label, className, icon: Icon, blurb } = PRESENTATION[attachment.state];
          const size = humanBytes(attachment.bytes);

          return (
            <li
              key={`${attachment.topicId}-${attachment.sequenceNumber}-${attachment.cid}`}
              className={`rounded-xl border p-4 ${
                attachment.state === "mismatch" ? "border-error bg-error/5" : "border-base-300 bg-base-100"
              }`}
              data-testid="document-entry"
            >
              <div className="flex items-start gap-3">
                <DocumentTextIcon className="mt-0.5 h-5 w-5 shrink-0 text-base-content/50" />

                <div className="min-w-0 grow">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span className="font-semibold break-all">{attachment.name ?? "Untitled document"}</span>
                    <span className={`inline-flex items-center gap-1 text-xs font-semibold ${className}`}>
                      <Icon className="h-4 w-4" />
                      {label}
                    </span>
                    {size && <span className="text-xs text-base-content/50">{size}</span>}
                  </div>

                  <p className="mt-1 mb-0 text-sm text-base-content/70">{blurb}</p>

                  {/* Shown for verified documents too: "no gateway was trusted" is the
                      part a reader cannot otherwise see. */}
                  {attachment.note && (
                    <p
                      className={`mt-2 mb-0 rounded-lg p-2 text-xs ${
                        attachment.state === "verified"
                          ? "bg-success/5 text-base-content/70"
                          : "bg-base-200 text-base-content/80"
                      }`}
                    >
                      {attachment.note}
                    </p>
                  )}

                  <dl className="mt-2 grid gap-0.5 text-xs text-base-content/50">
                    <div className="flex gap-2">
                      <dt className="shrink-0">{attachment.protocol === "arweave" ? "Arweave tx" : "CID"}</dt>
                      <dd className="m-0 break-all font-mono">{attachment.cid}</dd>
                    </div>
                    <div className="flex gap-2">
                      <dt className="shrink-0">Attested sha256</dt>
                      <dd className="m-0 break-all font-mono">{attachment.declaredHash}</dd>
                    </div>
                    {attachment.observedHash && attachment.observedHash !== attachment.declaredHash && (
                      <div className="flex gap-2 text-error">
                        <dt className="shrink-0">Found</dt>
                        <dd className="m-0 break-all font-mono">{attachment.observedHash}</dd>
                      </div>
                    )}
                  </dl>

                  <Link
                    href={
                      attachment.protocol === "arweave"
                        ? `${gateways.arweave.replace(/\/+$/, "")}/${attachment.cid}`
                        : `${gateways.ipfs.replace(/\/+$/, "")}/ipfs/${attachment.cid}`
                    }
                    target="_blank"
                    rel="noreferrer"
                    title={
                      demo
                        ? "Demo data — the real CID of the demo document, but nothing pins it, so gateways will not find it"
                        : "Opens through inbrowser.link, which checks the document against its CID in your browser"
                    }
                    className={`mt-2 inline-flex items-center gap-1 text-xs ${
                      demo ? "text-base-content/40 decoration-dotted" : "link link-hover text-primary"
                    }`}
                  >
                    Open on {attachment.protocol === "arweave" ? "Arweave" : "IPFS"}
                    {demo && <span className="opacity-70">(demo cid)</span>}
                    <ArrowTopRightOnSquareIcon className="h-3 w-3" />
                  </Link>
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
};
