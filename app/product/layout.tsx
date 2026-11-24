import type { Metadata } from "next";

import { sitePageMetadata } from "@/app/site/seo";
import { LANDING_FONTS } from "@/app/fonts/landing";
import styles from "@/app/(home)/landing.module.css";

/*
 * `/product` keeps the landing's faces, for the reason `/agent-control` does:
 * it is the same surface opened further, and a public page that changes
 * typeface between the homepage and the product page reads as two sites.
 *
 * The three families load in this segment rather than in the root layout,
 * because this segment, the landing and `/agent-control` are the only places
 * that use them and the rest of the site should not carry them
 * (`app/fonts/landing.ts`).
 */

export const metadata: Metadata = sitePageMetadata({
  path: "/product",
  title: "Ryntra — available trading and portfolio tools",
  description:
    "Explore Swap and asset details, manage your portfolio and keep saved plans on Solana. Review transaction terms and confirm with your own wallet.",
});

export default function ProductLayout({ children }: { children: React.ReactNode }) {
  return (
    <div
      className={`${LANDING_FONTS.className} ${styles.root}`}
    >
      {children}
    </div>
  );
}
