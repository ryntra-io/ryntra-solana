import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { privateNetwork } from "@/lib/privacy/network";
import { ClaimScreen } from "@/terminal/portfolio/private/ClaimScreen";
import { shelfOn } from "@/terminal/shell/shelves";

import { buildTerminalMetadata } from "../../../seo";

export const metadata: Metadata = buildTerminalMetadata({ name: "Money for you", path: "/private/claim", index: false });

/* A private link's page: the secret rides in the `#fragment`, which never reaches the server. With the private balance
   shut (`NEXT_PUBLIC_RYNTRA_PRIVATE`) or the Portfolio shelf off the address answers 404. */
export default function Page() {
  if (!privateNetwork() || !shelfOn("portfolio")) notFound();
  return <ClaimScreen />;
}
