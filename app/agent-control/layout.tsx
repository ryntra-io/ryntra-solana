import type { Metadata } from "next";

import { sitePageMetadata } from "@/app/site/seo";
import { LANDING_FONTS } from "@/app/fonts/landing";
import styles from "@/app/(home)/landing.module.css";

/*
 * The flagship product page keeps the landing's faces.
 *
 * `/agent-control` is the landing scene opened all the way, so it has to read
 * as the same surface — same display face, same mono, same dark ground. The
 * three families load here for the same reason they load under `(home)`: this
 * segment and the landing are the only places that use them, and mounting them
 * in the root layout would ship five families to every page in the site
 * (`app/fonts/landing.ts`).
 */

export const metadata: Metadata = sitePageMetadata({
  path: "/agent-control",
  title: "Agent Control — verify the intent, control the action, prove the outcome",
  description:
    "Non-custodial mandate, authorization and evidence infrastructure for autonomous financial actions. Ryntra verifies an agent's economic action before authorization and proves whether execution matched what was approved.",
});

export default function AgentControlLayout({ children }: { children: React.ReactNode }) {
  return (
    <div
      className={`${LANDING_FONTS.className} ${styles.root}`}
      data-ry-theme="dark"
    >
      {children}
    </div>
  );
}
