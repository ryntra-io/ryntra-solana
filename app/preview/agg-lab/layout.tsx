import type { Metadata } from "next";
import { Inter } from "next/font/google";

/*
 * The AGG product lab.
 *
 * A decision surface, not a destination, in the same spirit as the palette A/B
 * that was `/preview/hero-ab` (removed with the new site, 2026-09-26): it is
 * never indexed, nothing in the product links here, and the page itself opens
 * only for a Ryntra admin session. It exists so an admin can see the
 * prediction-market aggregator's own product, their tool layer and a
 * Ryntra-styled walk of the same data side by side before anything about
 * Predictions is decided (they are kept outside the vertical).
 *
 * The aggregator's stylesheet is loaded here and nowhere else. It is a
 * compiled Tailwind sheet whose tokens live on `.agg-root`, so the rest of the
 * site never sees it. Their default face is Inter — loaded through
 * `next/font` inside this segment only, exactly as the palette A/B loaded
 * the faces its comparison needed, and mapped onto their font token in
 * `agg-lab.css`; the site's own faces are untouched. The uicons glyph font
 * their icons use is linked explicitly, because a bundled `@import` that lands
 * anywhere but the top of a sheet is ignored by the browser and every icon
 * would render as an empty box. The route's own Content-Security-Policy in
 * `next.config.ts` allows exactly those hosts.
 */
import "@agg-build/ui/styles.css";
import "./agg-lab.css";

const inter = Inter({ subsets: ["latin"], weight: ["400", "500", "600", "700"], display: "swap", variable: "--font-agg-inter" });

export const metadata: Metadata = {
  title: "AGG Lab — paper trading · AGG test environment",
  robots: { index: false, follow: false, nocache: true },
};

export default function AggLabLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className={inter.variable}>
      <link
        rel="stylesheet"
        href="https://cdn-uicons.flaticon.com/uicons-regular-rounded/css/uicons-regular-rounded.css"
      />
      {children}
    </div>
  );
}
