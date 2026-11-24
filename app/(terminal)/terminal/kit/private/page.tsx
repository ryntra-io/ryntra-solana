import { notFound } from "next/navigation";

import { privateNetwork } from "@/lib/privacy/network";
import { kitOpen } from "@/terminal/shell/flag";
import { PrivateStand } from "@/terminal/ui/PrivateStand";

/* The private kit (the toggle «Public ⇄ Private», the band «others see», the ring's counter) in every state,
   for the eyes on a stand only, with the private mode open: `NEXT_PUBLIC_RYNTRA_TERMINAL=stand` and
   `NEXT_PUBLIC_RYNTRA_PRIVATE=devnet`. People never see it. */
export default function Page() {
  if (!kitOpen() || !privateNetwork()) notFound();
  return <PrivateStand />;
}
