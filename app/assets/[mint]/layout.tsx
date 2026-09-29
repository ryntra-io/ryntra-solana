import { IBM_Plex_Mono, Onest, Unbounded } from "next/font/google";

import styles from "@/app/(home)/landing.module.css";

/*
 * The public Asset Passport keeps the landing's faces. A link somebody was
 * sent about a token should look like the same company as the page it came
 * from; its own metadata lives on the route, because the title carries the
 * mint.
 *
 * The three families load in this segment rather than in the root layout,
 * because this segment, the landing and `/agent-control` are the only places
 * that use them and the rest of the site should not carry them.
 */
const display = Unbounded({ subsets: ["latin"], weight: ["400", "600", "700"], display: "swap", variable: "--font-sora" });
const sans = Onest({ subsets: ["latin"], display: "swap", variable: "--font-geist" });
const mono = IBM_Plex_Mono({ subsets: ["latin"], weight: ["400", "500", "600"], display: "swap", variable: "--font-geist-mono" });

export default function PublicAssetLayout({ children }: { children: React.ReactNode }) {
  return (
    <div
      className={`${display.variable} ${sans.variable} ${mono.variable} ${styles.root}`}
      data-ry-theme="dark"
    >
      {children}
    </div>
  );
}
