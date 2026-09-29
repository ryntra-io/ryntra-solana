import { getSession } from "@/lib/session";
import { pickBetaLang } from "@/lib/beta/types";
import { CB_COPY } from "@/app/app/copy";
import { SwapTerminal } from "./swap-terminal";
import { VisitorNotice } from "@/app/app/visitor";

export const dynamic = "force-dynamic";

export default async function SwapPage() {
  const session = await getSession();
  if (!session?.verified) {
    return (
      <VisitorNotice
        eyebrow="Markets"
        heading="Spot Swap"
        body="Buy tokenized stocks with USDG or sell back, priced by Arcus RFQ and settled on-chain by your own wallet. Ryntra never holds funds or keys."
        reason="A swap is signed by your wallet against a trade key this account provisions, so it needs both. The market data behind it is public — the Terminal shows the same instruments with no account at all."
      />
    );
  }
  const c = CB_COPY[pickBetaLang(session.state.user.language)] ?? CB_COPY.en;
  return <SwapTerminal c={c.swap} />;
}
