import { getSession } from "@/lib/session";
import { DemoTerminal } from "@/app/demo/terminal";

export const dynamic = "force-dynamic";

/**
 * The terminal, readable without an account.
 *
 * Everything the terminal shows about the *market* comes from `/api/arcus`,
 * which is already unauthenticated and per-IP rate-limited: markets, fees,
 * candles, and any address's public Arcus account. So a visitor sees the real
 * instrument, the real chart, the real risk assessment and the real readiness
 * verdict — the whole argument of the product — and only the act of recording
 * a paper trade needs an account, because a paper trade is a row that belongs
 * to somebody.
 */
export default async function TerminalPage() {
  const session = await getSession();
  const visitor = !session?.verified;

  return (
    <DemoTerminal
      embedded
      visitor={visitor}
      name={session?.state.user.first_name ?? session?.state.user.username ?? "trader"}
      wallet={session?.state.user.wallet_address ?? null}
    />
  );
}
