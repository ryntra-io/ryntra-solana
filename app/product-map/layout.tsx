import type { Metadata } from "next";
import { IBM_Plex_Mono, Onest, Unbounded } from "next/font/google";

import { sitePageMetadata } from "@/app/site/seo";
import styles from "@/app/(home)/landing.module.css";

/*
 * `/product-map` keeps the landing's faces, for the reason `/product` does:
 * it is the same surface opened further, and a public page that changes
 * typeface between the homepage and the map reads as two sites.
 *
 * The three families load in this segment rather than in the root layout,
 * because this segment, the landing and `/agent-control` are the only places
 * that use them and the rest of the site should not carry them.
 */
const display = Unbounded({ subsets: ["latin"], weight: ["400", "600", "700"], display: "swap", variable: "--font-sora" });
const sans = Onest({ subsets: ["latin"], display: "swap", variable: "--font-geist" });
const mono = IBM_Plex_Mono({ subsets: ["latin"], weight: ["400", "500", "600"], display: "swap", variable: "--font-geist-mono" });

export const metadata: Metadata = sitePageMetadata({
  path: "/product-map",
  title: "Ryntra — capabilities and availability",
  description:
    "Explore Ryntra capabilities and their availability. Available, limited and planned features remain clearly distinguished; support depends on each asset and route.",
});

export default function ProductMapLayout({ children }: { children: React.ReactNode }) {
  return (
    <div
      className={`${display.variable} ${sans.variable} ${mono.variable} ${styles.root}`}
    >
      {children}
    </div>
  );
}
