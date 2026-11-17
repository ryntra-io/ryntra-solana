import { notFound } from "next/navigation";

import { kitOpen } from "@/terminal/shell/flag";
import { Kit } from "@/terminal/shell/kit/Kit";

/* The kit page, for the eyes on a stand only (`NEXT_PUBLIC_RYNTRA_TERMINAL=stand`): the rail with every shelf in its
   preview state and every part of the kit, on the market's real figures. People never see it. */
export default function Page() {
  if (!kitOpen()) notFound();
  return <Kit shelf={null} />;
}
