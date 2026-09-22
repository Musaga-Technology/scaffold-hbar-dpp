import Link from "next/link";
import { ExclamationTriangleIcon } from "@heroicons/react/24/outline";
import { IndexUnavailable } from "~~/components/passport/IndexUnavailable";
import { RegisterProductForm } from "~~/components/passport/RegisterProductForm";
import { WalletGate } from "~~/components/passport/WalletGate";
import { IndexUnavailableError, listProducts } from "~~/lib/indexClient";

/**
 * Issuer dashboard.
 *
 * The product list is server-rendered from the index; only the register form
 * needs a wallet. Without a configured registry the page explains what to run
 * rather than presenting a form that would fail on submit.
 */
export const dynamic = "force-dynamic";

const Issuer = async () => {
  let products;
  try {
    products = await listProducts();
  } catch (error) {
    if (error instanceof IndexUnavailableError) {
      return <IndexUnavailable url={error.url} detail={error.detail} />;
    }
    throw error;
  }
  const tokenId = process.env.NEXT_PUBLIC_PASSPORT_TOKEN_ID;

  return (
    <div className="mx-auto w-full max-w-5xl px-5 py-10">
      <header className="mb-6">
        <h1 className="mb-1 mt-0 text-3xl font-bold">Issue a passport</h1>
        <p className="m-0 text-base-content/70">
          Give a physical product a record anyone can check, then keep that record up to date.
        </p>
      </header>

      {/* The sequence was only ever described in the README. Someone standing in
          front of the form should be able to see where this leads. */}
      <ol className="mb-8 grid list-none gap-3 p-0 sm:grid-cols-3">
        {[
          {
            n: "1",
            title: "Register it here",
            body: "Creates the product's lifecycle log, mints one token for this exact item, and records the first entry.",
          },
          {
            n: "2",
            title: "Record what happens",
            body: "Shipped, inspected, repaired. Attach certificates — they are re-checked later, not just stored.",
          },
          {
            n: "3",
            title: "Hand it over",
            body: "Transfer it to a distributor, or send it to the person who bought the product.",
          },
        ].map(step => (
          <li key={step.n} className="rounded-xl border border-base-300 bg-base-100 p-4">
            <div className="mb-1 flex items-center gap-2">
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary/10 text-xs font-bold text-primary">
                {step.n}
              </span>
              <span className="font-semibold">{step.title}</span>
            </div>
            <p className="m-0 text-sm text-base-content/70">{step.body}</p>
          </li>
        ))}
      </ol>

      {!tokenId ? (
        <div className="rounded-2xl border border-warning bg-warning/5 p-6" data-testid="not-configured">
          <div className="mb-2 flex items-center gap-2 text-warning">
            <ExclamationTriangleIcon className="h-5 w-5" />
            <h2 className="m-0 text-lg font-bold">No registry configured</h2>
          </div>
          <p className="mb-3 text-sm text-base-content/80">
            Registering a product needs a deployed registry and an NFT collection. One command creates both:
          </p>
          <pre className="mb-3 overflow-x-auto rounded-lg bg-base-300/40 p-3 text-sm">
            <code>yarn passport:bootstrap</code>
          </pre>
          <p className="m-0 text-sm text-base-content/70">
            It writes <code className="rounded bg-base-300/50 px-1">NEXT_PUBLIC_PASSPORT_TOKEN_ID</code> into{" "}
            <code className="rounded bg-base-300/50 px-1">packages/nextjs/.env.local</code>. Verifying passports works
            without any of this — only issuing needs it.
          </p>
        </div>
      ) : (
        <section className="mb-10">
          <h2 className="mb-3 mt-0 text-lg font-bold">Register a product</h2>
          <WalletGate title="Registering needs a wallet">
            <RegisterProductForm tokenId={tokenId} />
          </WalletGate>
        </section>
      )}

      <section>
        <h2 className="mb-3 mt-0 text-lg font-bold">Registered products</h2>
        {products.length === 0 ? (
          <div className="rounded-xl border border-base-300 bg-base-100 p-6 text-center text-base-content/60">
            Nothing registered yet.
          </div>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-base-300">
            <table className="table">
              <thead>
                <tr>
                  <th>Serial</th>
                  <th>Product</th>
                  <th>Category</th>
                  <th>Status</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {products.map(product => (
                  <tr key={product.serial}>
                    <td className="font-mono">{product.serial}</td>
                    <td>{product.name ?? "—"}</td>
                    <td className="capitalize">{product.category ?? "—"}</td>
                    <td>
                      <span
                        className={`badge badge-sm ${
                          product.status === "verified"
                            ? "badge-success"
                            : product.status === "discrepancy"
                              ? "badge-error"
                              : "badge-warning"
                        }`}
                      >
                        {product.status}
                      </span>
                    </td>
                    <td className="text-right">
                      <Link href={`/issuer/${product.serial}`} className="btn btn-ghost btn-xs">
                        Manage
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
};

export default Issuer;
