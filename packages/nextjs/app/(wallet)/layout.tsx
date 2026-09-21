import "@rainbow-me/rainbowkit/styles.css";
import { ScaffoldHbarAppWithProviders } from "~~/components/ScaffoldHbarAppWithProviders";

/**
 * Shell for pages that transact.
 *
 * This is where RainbowKit, wagmi and WalletConnect are mounted. Keeping them
 * scoped to this route group is what keeps them off the public pages; moving
 * these providers up into the root layout would silently undo that.
 */
const WalletLayout = ({ children }: { children: React.ReactNode }) => (
  <ScaffoldHbarAppWithProviders>{children}</ScaffoldHbarAppWithProviders>
);

export default WalletLayout;
