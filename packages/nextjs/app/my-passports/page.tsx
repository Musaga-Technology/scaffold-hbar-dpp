import { HeldPassports } from "~~/components/passport/HeldPassports";
import { WalletGate } from "~~/components/passport/WalletGate";
import { listProducts } from "~~/lib/indexClient";

/**
 * Passports held by the connected wallet.
 *
 * The list comes from the index, whose holder field is read from the mirror
 * node — the network's answer about custody, not a claim from the event log.
 * Claiming pending HIP-904 airdrops arrives in increment 04.
 */
export const dynamic = "force-dynamic";

const MyPassports = async () => {
  const products = await listProducts();

  return (
    <div className="mx-auto w-full max-w-4xl px-5 py-10">
      <header className="mb-8">
        <h1 className="mb-1 mt-0 text-3xl font-bold">My passports</h1>
        <p className="m-0 text-base-content/70">Products currently held by your wallet.</p>
      </header>

      <WalletGate title="Seeing your passports needs a wallet">
        <HeldPassports products={products} />
      </WalletGate>
    </div>
  );
};

export default MyPassports;
