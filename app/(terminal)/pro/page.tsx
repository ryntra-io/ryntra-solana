import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { ProScreen } from "@/terminal/pool/ProScreen";
import { shelfOn } from "@/terminal/shell/shelves";

import { buildTerminalMetadata } from "../../seo";

export const metadata: Metadata = buildTerminalMetadata({ name: "Meteora DLMM Pro", path: "/pro" });

/* Meteora DLMM Pro: every pool of it on Solana, read from the program, deepest first — «Earn» on its DLMM
   Pro tab (the same desk and places as every tab of Earn). A pool's row opens its own desk at
   `/pool/<address>`. */
export default function Page() {
  if (!shelfOn("earn")) notFound();
  return <ProScreen />;
}
