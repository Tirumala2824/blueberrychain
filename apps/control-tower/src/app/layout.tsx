import "@fontsource/barlow/400.css";
import "@fontsource/barlow/500.css";
import "@fontsource/barlow/600.css";
import "@fontsource/barlow-semi-condensed/500.css";
import "@fontsource/barlow-semi-condensed/600.css";
import "@fontsource/barlow-semi-condensed/700.css";
import "./globals.css";
import type { Metadata } from "next";
import type { ReactNode } from "react";
import { SessionProvider } from "@/client/session";

export const metadata: Metadata = {
  title: "BlueberryChain control tower",
  description: "Excursion value recovery: decide, approve and prove every cold-chain recovery.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <SessionProvider>{children}</SessionProvider>
      </body>
    </html>
  );
}
