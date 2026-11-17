import type { Metadata } from "next";
import { EarnScreen } from "@/terminal/earn/EarnScreen";

import { buildTerminalMetadata } from "../../seo";

export const metadata: Metadata = buildTerminalMetadata({ name: "Earn", path: "/earn" });

/* The Earn shelf: pools, staking and lending, and what the wallet has at work. The frame around it — the switch, the
   faces, the language and the market — is `app/(terminal)/layout.tsx`. */
export default function Page() {
  return <EarnScreen />;
}
