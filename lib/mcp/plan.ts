import { bookOf, type Book, type Coin, type Command, type Gates } from "../../city/lib/command/parse.ts";
import { askHref, askRows, modelWanted, type AskRow } from "../../terminal/shell/ask-route.ts";
import type { ShelfId } from "../../terminal/shell/shelves.ts";
import { cleanSentence, opensFromLink, sayUrl } from "./say.ts";

/**
 * A sentence to the agent, read on the server the way the terminal's line reads it: «trade 1 SOL a day»,
 * «launch me a token Neon Fox $NEON», «swap 1 SOL to JUP», «доглядай мій пул». The same reader — the line's
 * `askRows` (`terminal/shell/ask-route.ts`) over the city's own words — against the same market list the page starts
 * with (`/api/city`), so the plan another AI shows the person is the screen the link opens.
 *
 * The answer is a plan and a link, never an action: the link hands the sentence to the line (`./say.ts`), the line
 * opens the screen filled, and the person signs there with their own wallet. A reading a link may not open — a transfer
 * to an address, a question — is refused here with its reason, so no link is written for it.
 *
 * Pure: the market's towers, the shelves that are on and the engine's gates are handed in.
 */

export type Tower = Readonly<{ id: string; symbol: string; name: string; icon: string | null; verified: boolean; mcap: number; liquidity: number }>;

export type PlanDeps = Readonly<{
  towers: readonly Tower[];
  /** Whether a shelf of the terminal is on (`shelfOn` of `terminal/shell/shelves.ts`). */
  on: (shelf: ShelfId) => boolean;
  /** The engine's gates behind the line (`engineGates` of `terminal/shell/engine.ts`). */
  gates: Gates;
}>;

export type PlannedCoin = Readonly<{ mint: string; symbol: string }>;

export type Plan = Readonly<{
  /** What the person will see, one line for the AI to repeat in its own words. */
  opens: string;
  /** The kind of reading, the line's own name for it. */
  kind: string;
  /** The terminal screen it lands on. */
  screen: string;
  /** The figures written on that screen — every one from the sentence; nothing the person did not say. */
  fields: Readonly<Record<string, unknown>>;
}>;

export type PlanOutcome =
  | Readonly<{ ok: true; sentence: string; link: string; plan: Plan }>
  | Readonly<{ ok: false; code: "SENTENCE_INVALID" | "NOT_UNDERSTOOD" | "NOT_FROM_A_LINK"; message: string }>;

/** Sentences the line reads at once; the AI may offer them as the shape to follow. */
export const SENTENCE_EXAMPLES = [
  "trade 1 SOL a day",
  "trade JUP for 0.5 SOL a day",
  "find new coins and trade for me",
  "launch me a token Neon Fox $NEON",
  "swap 1 SOL to JUP",
  "buy JUP cheaper",
  "work with my 2 SOL: some into savings, trade some",
  "trade for me",
] as const;

function coinOf(coin: Coin | null | undefined): PlannedCoin | null {
  return coin ? { mint: coin.mint, symbol: coin.symbol } : null;
}

/** The plan of one reading: what opens and with which of the sentence's figures. */
export function planOfRow(row: AskRow): Plan {
  const screen = askHref(row.target, "live");
  const command: Command = row.command;
  const plan = (opens: string, fields: Record<string, unknown>): Plan => ({ opens, kind: command.kind, screen, fields });
  switch (command.kind) {
    case "buy":
      return plan("A swap ticket that buys the coin, filled with the amount said; the person checks the quote and signs.", {
        coin: coinOf(command.coin),
        amount: command.amount,
        pay: command.pay,
        share: command.share,
      });
    case "sell":
      return plan("A swap ticket that sells the coin, filled with the amount said; the person checks the quote and signs.", {
        coin: coinOf(command.coin),
        amount: command.amount,
        into: command.into,
        share: command.share,
      });
    case "order":
      return plan(`A ${command.mode} order on the coin's page, filled as said; the person signs it.`, {
        coin: coinOf(command.coin),
        side: command.side,
        price: command.price,
        amount: command.amount ?? null,
      });
    case "ladder":
      return plan("A ladder of limit orders on the coin's page, filled as said; the person signs it.", {
        coin: coinOf(command.ask.coin),
        action: command.ask.action,
        farBps: command.ask.farBps,
      });
    case "autopilot":
      if (command.ask.kind === "launch") {
        return plan("A launch the agent prepares — name and ticker as said; the person signs the launch.", { name: command.ask.name, symbol: command.ask.symbol });
      }
      if (command.ask.plan?.id === "early") {
        return plan("The market's new coins, as the agent reads them; the person picks and signs.", { perDaySol: command.ask.perDaySol });
      }
      return plan("The agent's budget card: the agent trades by itself within this budget a day; the person signs the budget once and can stop it at any time.", {
        perDaySol: command.ask.perDaySol,
        coin: coinOf(command.ask.coin),
        strategy: command.ask.plan?.id ?? null,
      });
    case "pilot":
      return plan("One plan for the money — savings, trading, pools — in the money autopilot's card; the person signs it.", {
        solRaw: command.ask.solRaw,
        usdcRaw: command.ask.usdcRaw,
        parts: command.ask.named,
        coins: command.ask.coins.map(coinOf),
      });
    case "hire":
      return plan("The card of the agent for this job; the person sets it up and signs there.", { role: command.ask.role });
    case "launch":
      return plan("The Launch form, filled with the name and ticker said; the person adds a picture and signs the launch.", {
        name: command.name,
        symbol: command.symbol,
      });
    case "earn":
      return plan("Earn — pools, staking and lending to choose from.", {});
    case "dollar":
      return plan("The Dollar Saver's card with the coin and amount said; the person signs it.", { asset: command.ask.asset, amount: command.ask.amount });
    case "coin":
    case "chart":
      return plan("The coin's own page.", { coin: coinOf(command.coin) });
    case "mint":
      return plan("The coin's own page.", { mint: command.mint });
    case "instruct":
    case "instructions":
      return plan("The agent's instructions.", {});
    case "learn":
      return plan("The guide.", { chapter: command.chapter });
    default:
      return plan("A screen of the terminal.", {});
  }
}

/** A market list the line reads against: the city's verified towers, SOL and USDC always. */
export function bookFor(towers: readonly Tower[]): Book {
  return bookOf(towers);
}

/**
 * The plan and link for a sentence, or why there is none. `origin` is where the link opens (this deployment's own).
 */
export function planSentence(raw: unknown, origin: string, deps: PlanDeps): PlanOutcome {
  const sentence = cleanSentence(raw);
  if (!sentence) return { ok: false, code: "SENTENCE_INVALID", message: "Give one sentence, up to 140 characters, as a person would say it to their agent." };
  const rows = askRows(sentence, bookFor(deps.towers), { subject: null }, deps.on, deps.gates);
  const first = rows[0] ?? null;
  // The page opens a link's sentence only where the line's own rules read it in full (`terminal/shell/LinkSay.tsx`):
  // a sentence only the model could place would stand in the line, so no link is written for it.
  if (!first || first.command.kind === "ask" || modelWanted(sentence, first)) {
    return { ok: false, code: "NOT_UNDERSTOOD", message: `The agent's line does not read this as something to do. Say it like: ${SENTENCE_EXAMPLES.slice(0, 4).map((s) => `«${s}»`).join(", ")}.` };
  }
  if (!opensFromLink(first.command.kind)) {
    return {
      ok: false,
      code: "NOT_FROM_A_LINK",
      message: "A transfer to an address never opens from a link: the person says it to their agent on ryntra.io themselves.",
    };
  }
  const link = sayUrl(origin, sentence);
  if (!link) return { ok: false, code: "SENTENCE_INVALID", message: "This sentence cannot travel in a link." };
  return { ok: true, sentence, link, plan: planOfRow(first) };
}
