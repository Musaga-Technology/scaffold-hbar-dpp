import { PublicFooter } from "~~/components/PublicFooter";
import { PublicHeader } from "~~/components/PublicHeader";

/**
 * Shell for pages anyone can read without a wallet.
 *
 * No wagmi provider, no RainbowKit, no WalletConnect. A consumer scanning a QR
 * code on a product downloads the page and nothing else.
 */
const PublicLayout = ({ children }: { children: React.ReactNode }) => (
  <div className="flex min-h-screen flex-col">
    <PublicHeader />
    <main className="relative flex flex-1 flex-col">{children}</main>
    <PublicFooter />
  </div>
);

export default PublicLayout;
