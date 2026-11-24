import { LANDING_FONTS } from "@/app/fonts/landing";
import styles from "@/app/(home)/landing.module.css";

/*
 * The public Asset Passport keeps the landing's faces. A link somebody was
 * sent about a token should look like the same company as the page it came
 * from; its own metadata lives on the route, because the title carries the
 * mint.
 *
 * The three families load in this segment rather than in the root layout,
 * because this segment, the landing and `/agent-control` are the only places
 * that use them and the rest of the site should not carry them
 * (`app/fonts/landing.ts`).
 */

export default function PublicAssetLayout({ children }: { children: React.ReactNode }) {
  return (
    <div
      className={`${LANDING_FONTS.className} ${styles.root}`}
      data-ry-theme="dark"
    >
      {children}
    </div>
  );
}
