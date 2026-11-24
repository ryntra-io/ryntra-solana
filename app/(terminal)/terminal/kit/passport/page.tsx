import { notFound } from "next/navigation";

import { PassportStand } from "@/terminal/coin/passport/PassportStand";
import { kitOpen } from "@/terminal/shell/flag";

/* The coin's passport as the coin's page will show it, for the eyes on a stand only
   (`NEXT_PUBLIC_RYNTRA_TERMINAL=stand`). People never see it. */
export default function Page() {
  if (!kitOpen()) notFound();
  return <PassportStand />;
}
