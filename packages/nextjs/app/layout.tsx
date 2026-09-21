import "@scaffold-hbar-ui/components/styles.css";
import { ThemeProvider } from "~~/components/ThemeProvider";
import "~~/styles/globals.css";
import { getMetadata } from "~~/utils/scaffold-hbar/getMetadata";

export const metadata = getMetadata({
  title: "Product Passport",
  description: "Digital Product Passports on Hedera",
});

/**
 * Root layout.
 *
 * Deliberately thin. The wallet providers live in the (wallet) route group's
 * layout, not here, so public pages never load RainbowKit, wagmi or
 * WalletConnect — see app/(public)/layout.tsx.
 */
const RootLayout = ({ children }: { children: React.ReactNode }) => (
  <html suppressHydrationWarning>
    <body>
      <ThemeProvider enableSystem>{children}</ThemeProvider>
    </body>
  </html>
);

export default RootLayout;
