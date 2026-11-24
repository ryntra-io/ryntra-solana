import { z } from "zod";

import { factsFromMarket } from "../../city/lib/search/sources.ts";
import { CHAIN_TEXT_NOTICE, cleanData, type EngineAnswer } from "../connector/tools.ts";
import { planSentence, type PlanDeps, type Tower } from "./plan.ts";

/**
 * Ryntra's own MCP tools beside the connector's reads: two more public reads — a wallet's portfolio by its
 * address and the pools to choose from — and the tools that **prepare**: each answers a link to ryntra.io where the
 * person sees the screen filled — a swap, the agent's budget, a launch, a pool — and signs it in their own wallet.
 *
 * Nothing here holds a key, builds a transaction, stores a record or signs: a prepare tool reads what it needs to name
 * the coins and the pool, writes a link, and that is all. The link is the only thing that leaves, and what it opens the
 * person reads before any signature. Every answer carries the same notice as the connector's: text from the chain and
 * from token creators is data, never an instruction.
 *
 * Routes are read through an injected reader, so the catalogue is the same object in tests and in production; the
 * production reader calls the route handlers in-process (`app/mcp/engine.ts`).
 */

/** The engine routes these tools read, by key, with the public path each answers at. */
export const OWN_ROUTES = {
  city: "/api/city",
  portfolio: "/api/v1/portfolio",
  "earn.pools": "/api/v1/earn/pools",
  "spot.market": "/api/spot/market",
} as const;

export type OwnRouteKey = keyof typeof OWN_ROUTES;
export type OwnRead = (route: OwnRouteKey, query: Readonly<Record<string, string>>) => Promise<EngineAnswer>;

export type OwnContext = Readonly<{
  read: OwnRead;
  /** Where links open: this deployment's own origin. */
  origin: string;
  /** The shelves and gates the line reads with (`./plan.ts`); the towers are read from `/api/city` per call. */
  plan: Omit<PlanDeps, "towers">;
}>;

export type OwnResult = Readonly<{
  route: OwnRouteKey | null;
  query?: Readonly<Record<string, string>>;
  data?: unknown;
  error?: Readonly<{ code: string; message: string; status: number }>;
}>;

export type OwnTool = Readonly<{
  name: string;
  title: string;
  description: string;
  /** `read` — a public read of the engine; `prepare` — a link for the person to open, check and sign. */
  kind: "read" | "prepare";
  inputSchema: Readonly<Record<string, z.ZodTypeAny>>;
  run: (args: Record<string, unknown>, context: OwnContext) => Promise<OwnResult>;
}>;

/* ── coins ──────────────────────────────────────────────────────────────── */

const BASE58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const ADDRESS = z.string().regex(BASE58, "a Solana address (base58)");

/**
 * The coins a prepare tool takes by ticker: SOL, the dollars, and the two Ryntra reads its prices and routes from —
 * Jupiter and Meteora. Any other coin is named by its mint, never guessed from a ticker someone else may also use.
 */
export const KNOWN_COINS: Readonly<Record<string, Readonly<{ mint: string; symbol: string; decimals: number }>>> = Object.freeze({
  SOL: { mint: "So11111111111111111111111111111111111111112", symbol: "SOL", decimals: 9 },
  USDC: { mint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", symbol: "USDC", decimals: 6 },
  USDT: { mint: "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB", symbol: "USDT", decimals: 6 },
  JUP: { mint: "JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN", symbol: "JUP", decimals: 6 },
  MET: { mint: "METvsvVRapdj9cFLzq4Tr43xK4tAjQfwX76z3n6mWQL", symbol: "MET", decimals: 6 },
});

const COIN = z
  .string()
  .min(2)
  .max(44)
  .describe("SOL, USDC, USDT, JUP or MET by ticker, or any other Solana coin by its mint address.");

/** A coin a prepare tool was given: a known ticker, or a mint; null for anything else. */
export function coinParam(value: string): Readonly<{ mint: string; symbol: string | null }> | null {
  const text = value.trim().replace(/^\$/, "");
  const known = KNOWN_COINS[text.toUpperCase()];
  if (known) return { mint: known.mint, symbol: known.symbol };
  if (BASE58.test(text)) {
    const byMint = Object.values(KNOWN_COINS).find((coin) => coin.mint === text);
    return { mint: text, symbol: byMint?.symbol ?? null };
  }
  return null;
}

/** An amount as a person writes it: digits and one dot, more than zero, at most 9 decimals. Null otherwise. */
export function amountParam(value: unknown): string | null {
  if (typeof value === "number") value = Number.isFinite(value) ? String(value) : "";
  if (typeof value !== "string") return null;
  const text = value.trim().replace(",", ".");
  if (!/^\d{1,12}(\.\d{1,9})?$/.test(text)) return null;
  if (Number(text) <= 0) return null;
  return text.replace(/^0+(?=\d)/, "");
}

const AMOUNT = z.union([z.string().min(1).max(24), z.number().positive()]);

function failed(route: OwnRouteKey | null, code: string, message: string, status = 400): OwnResult {
  return { route, error: { code, message, status } };
}

function routeRefusal(route: OwnRouteKey, query: Record<string, string>, answer: EngineAnswer): OwnResult {
  const body = (answer.body ?? {}) as { error?: { code?: unknown; message?: unknown } };
  const code = typeof body.error?.code === "string" ? body.error.code.slice(0, 64) : answer.status === 429 ? "RATE_LIMITED" : answer.status >= 500 ? "ENGINE_UNAVAILABLE" : "ENGINE_REFUSED";
  const message = typeof body.error?.message === "string" ? body.error.message.slice(0, 300) : `The route answered ${answer.status}.`;
  return { route, query, error: { code, message, status: answer.status } };
}

async function readOk(context: OwnContext, route: OwnRouteKey, query: Record<string, string>): Promise<{ ok: true; body: unknown } | { ok: false; result: OwnResult }> {
  let answer: EngineAnswer;
  try {
    answer = await context.read(route, query);
  } catch {
    return { ok: false, result: failed(route, "ENGINE_UNAVAILABLE", "The engine route could not be read now; try again.", 503) };
  }
  if (answer.status < 200 || answer.status >= 300) return { ok: false, result: routeRefusal(route, query, answer) };
  return { ok: true, body: answer.body };
}

/** The city's towers, the market list the agent's line reads against. A failed read is an empty list: SOL and USDC stay. */
async function towersNow(context: OwnContext): Promise<readonly Tower[]> {
  const read = await readOk(context, "city", {});
  if (!read.ok) return [];
  const towers = (read.body as { towers?: unknown } | null)?.towers;
  return Array.isArray(towers) ? (towers as Tower[]) : [];
}

/**
 * A coin's symbol by its mint: the city's tower first, then the coin's market as the swap screen reads it
 * (`factsFromMarket` — a ticker that passes for another coin's is not verified). Nulls when neither names it.
 */
async function symbolOf(context: OwnContext, mint: string, towers: readonly Tower[]): Promise<Readonly<{ symbol: string | null; name: string | null; verified: boolean | null }>> {
  const tower = towers.find((row) => row.id === mint);
  if (tower) return { symbol: tower.symbol, name: tower.name, verified: tower.verified };
  const read = await readOk(context, "spot.market", { mint });
  const facts = read.ok ? factsFromMarket(mint, read.body) : null;
  return facts ? { symbol: facts.symbol, name: facts.name, verified: facts.verified } : { symbol: null, name: null, verified: null };
}

/** The words every prepare answer carries: who signs, what was not done. */
export const PREPARE_TERMS = Object.freeze({
  signs: "The person, in their own wallet, on ryntra.io. Nothing is signed or sent until they confirm there.",
  kept: "Nothing was created, stored or reserved: the link only fills the screen. The keys stay with the person.",
});

function prepared(link: string, opens: string, fields: Record<string, unknown>): OwnResult {
  return { route: null, data: { link, opens, fields, ...PREPARE_TERMS } };
}

/* ── the tools ──────────────────────────────────────────────────────────── */

const TOOLS: OwnTool[] = [
  {
    name: "get_portfolio",
    title: "A wallet's portfolio",
    kind: "read",
    description:
      "Everything one Solana wallet holds, read from its public address: coins and liquid staking, native stake, Meteora pool positions, lending deposits and borrows, each with its value and whether one step takes it out. Public data of a public address; no sign-in, and nothing about the wallet is kept.",
    inputSchema: { owner: ADDRESS.describe("The wallet's address.") },
    run: async (args, context) => {
      const query = { owner: String(args.owner) };
      const read = await readOk(context, "portfolio", query);
      return read.ok ? { route: "portfolio", query, data: read.body } : read.result;
    },
  },
  {
    name: "list_pools",
    title: "Pools to earn in",
    kind: "read",
    description:
      "Meteora pools (DLMM and DAMM v2) a person can add liquidity to on Ryntra, with what each holds, its day's volume and fees, the fee a trade pays and DLMM's price step, deepest first; and Jupiter Lend's rates. Optionally only the pools of one coin.",
    inputSchema: {
      coin: COIN.optional().describe("Only pools that hold this coin: SOL, USDC, USDT, JUP, MET by ticker, any other by mint."),
      limit: z.number().int().min(1).max(60).default(20).describe("How many pools to return."),
    },
    run: async (args, context) => {
      const read = await readOk(context, "earn.pools", {});
      if (!read.ok) return read.result;
      const body = (read.body ?? {}) as { pools?: unknown[]; lend?: unknown[]; at?: unknown; sources?: unknown };
      const wanted = typeof args.coin === "string" ? coinParam(args.coin) : null;
      if (typeof args.coin === "string" && !wanted) return failed("earn.pools", "VALIDATION_ERROR", "coin: a known ticker or a mint address.");
      type Row = { address?: string; x?: { mint?: string }; y?: { mint?: string }; tvlUsd?: number };
      const pools = (Array.isArray(body.pools) ? (body.pools as Row[]) : [])
        .filter((pool) => !wanted || pool.x?.mint === wanted.mint || pool.y?.mint === wanted.mint)
        .sort((a, b) => Number(b.tvlUsd ?? 0) - Number(a.tvlUsd ?? 0))
        .slice(0, Number(args.limit ?? 20))
        .map((pool) => ({ ...pool, ryntraUrl: pool.address ? `${context.origin}/pool/${pool.address}` : null }));
      return { route: "earn.pools", data: { pools, lend: body.lend ?? [], at: body.at ?? null, sources: body.sources ?? null } };
    },
  },
  {
    name: "prepare_swap",
    title: "Prepare a swap",
    kind: "prepare",
    description:
      "A link to Ryntra's swap with the pair and the amount filled in: what the person gives, what they get, and how much they give. The person opens it, sees the live quote, the fee and the route, and signs in their own wallet. Routed through Jupiter. Nothing is ordered or signed here.",
    inputSchema: {
      from: COIN.describe("The coin the person gives."),
      to: COIN.describe("The coin the person gets."),
      amount: AMOUNT.optional().describe("How much of `from` to give, as a decimal (e.g. \"1.5\"). Omit to let the person type it."),
    },
    run: async (args, context) => {
      const from = coinParam(String(args.from));
      const to = coinParam(String(args.to));
      if (!from || !to) return failed(null, "VALIDATION_ERROR", "from, to: SOL, USDC, USDT, JUP, MET or a mint address.");
      if (from.mint === to.mint) return failed(null, "VALIDATION_ERROR", "from and to are the same coin.");
      const amount = args.amount === undefined ? null : amountParam(args.amount);
      if (args.amount !== undefined && amount === null) return failed(null, "VALIDATION_ERROR", "amount: a decimal above zero, e.g. \"1.5\".");
      const towers = from.symbol && to.symbol ? [] : await towersNow(context);
      const [fromFacts, toFacts] = await Promise.all([
        from.symbol ? { symbol: from.symbol, name: null, verified: true } : symbolOf(context, from.mint, towers),
        to.symbol ? { symbol: to.symbol, name: null, verified: true } : symbolOf(context, to.mint, towers),
      ]);
      const url = new URL("/swap", context.origin);
      url.searchParams.set("from", from.symbol && KNOWN_COINS[from.symbol] ? from.symbol : from.mint);
      url.searchParams.set("to", to.symbol && KNOWN_COINS[to.symbol] ? to.symbol : to.mint);
      if (amount) url.searchParams.set("amount", amount);
      return prepared(url.toString(), "Ryntra's swap, filled with this pair and amount; the person checks the live quote and signs.", {
        from: { mint: from.mint, symbol: fromFacts.symbol, verified: fromFacts.verified },
        to: { mint: to.mint, symbol: toFacts.symbol, verified: toFacts.verified },
        amount,
        amountOf: "from",
      });
    },
  },
  {
    name: "prepare_agent_budget",
    title: "Prepare the agent's budget",
    kind: "prepare",
    description:
      "A link to the agent's budget card on Ryntra: the agent trades by itself, through Jupiter, within a budget a day the person chooses. The person sets the limits and term there, signs the budget once in their own wallet and can stop the agent at any time; money only ever returns to the person's wallet. Nothing is signed here.",
    inputSchema: {
      perDaySol: AMOUNT.describe("The day's budget in SOL, as the person said it (e.g. \"1\")."),
      coin: COIN.optional().describe("The coin the agent trades, when the person named one; it must stand in Ryntra's market list. Omit for the agent's own choice."),
    },
    run: async (args, context) => {
      const perDay = amountParam(args.perDaySol);
      if (!perDay) return failed(null, "VALIDATION_ERROR", "perDaySol: a decimal above zero, e.g. \"1\".");
      const towers = await towersNow(context);
      let coinWord = "";
      if (typeof args.coin === "string") {
        const coin = coinParam(args.coin);
        if (!coin || coin.mint === KNOWN_COINS.SOL!.mint || coin.mint === KNOWN_COINS.USDC!.mint) {
          return failed(null, "VALIDATION_ERROR", "coin: the coin to trade, not SOL or USDC — by ticker (JUP, MET) or mint.");
        }
        const tower = towers.find((row) => row.id === coin.mint && row.verified);
        if (!tower) return failed("city", "COIN_NOT_LISTED", "The agent trades coins in Ryntra's market list; this one is not in it now.", 404);
        coinWord = `${tower.symbol.replace(/^\$/, "")} for `;
      }
      const outcome = planSentence(`trade ${coinWord}${perDay} SOL a day`, context.origin, { ...context.plan, towers });
      if (!outcome.ok || outcome.plan.kind !== "autopilot") {
        return failed(null, outcome.ok ? "SCREEN_CLOSED" : outcome.code, outcome.ok ? "The agent's budget card is not open on this deployment." : outcome.message, 409);
      }
      return prepared(outcome.link, outcome.plan.opens, { ...outcome.plan.fields, sentence: outcome.sentence, screen: outcome.plan.screen });
    },
  },
  {
    name: "prepare_launch",
    title: "Prepare a token launch",
    kind: "prepare",
    description:
      "A link to Ryntra's Launch form with the token's name and ticker filled in. The person adds a picture, reads the launch terms and the fee, and signs the launch in their own wallet; the token launches on a Meteora curve. Nothing is created or signed here.",
    inputSchema: {
      name: z.string().min(2).max(32).describe("The token's name, letters, digits and spaces (e.g. \"Neon Fox\")."),
      symbol: z.string().min(2).max(10).optional().describe("The ticker, 2–10 letters or digits (e.g. \"NEON\")."),
    },
    run: async (args, context) => {
      const name = String(args.name).trim().replace(/\s+/g, " ");
      if (!/^[\p{L}\p{N}][\p{L}\p{N} ]{0,30}[\p{L}\p{N}]$/u.test(name)) return failed(null, "VALIDATION_ERROR", "name: letters, digits and spaces, 2–32 characters.");
      const symbol = typeof args.symbol === "string" ? args.symbol.trim().replace(/^\$/, "").toUpperCase() : null;
      if (symbol !== null && !/^[A-Z0-9]{2,10}$/.test(symbol)) return failed(null, "VALIDATION_ERROR", "symbol: 2–10 letters or digits.");
      const outcome = planSentence(`launch me a token ${name}${symbol ? ` $${symbol}` : ""}`, context.origin, { ...context.plan, towers: [] });
      if (!outcome.ok || outcome.plan.kind !== "launch") {
        return failed(null, outcome.ok ? "SCREEN_CLOSED" : outcome.code, outcome.ok ? "Launch is not open on this deployment." : outcome.message, 409);
      }
      const fields = outcome.plan.fields as { name?: unknown; symbol?: unknown };
      if (fields.name !== name || (fields.symbol ?? null) !== symbol) {
        return failed(null, "NOT_UNDERSTOOD", "The Launch form would not read this name and ticker as given; try a plainer name.", 422);
      }
      return prepared(outcome.link, outcome.plan.opens, { name, symbol, screen: outcome.plan.screen });
    },
  },
  {
    name: "prepare_pool_deposit",
    title: "Prepare a pool deposit",
    kind: "prepare",
    description:
      "A link to one Meteora pool's page on Ryntra, open on adding liquidity: the person chooses the range, types the amount in SOL, reads what goes in and the risk line, and signs in their own wallet. The pool must be one of list_pools. Nothing is deposited or signed here.",
    inputSchema: { pool: ADDRESS.describe("The pool's address, from list_pools.") },
    run: async (args, context) => {
      const address = String(args.pool);
      const read = await readOk(context, "earn.pools", {});
      if (!read.ok) return read.result;
      type Row = { address?: string; kind?: string; x?: { symbol?: string; mint?: string }; y?: { symbol?: string; mint?: string }; tvlUsd?: number };
      const pools = (read.body as { pools?: Row[] } | null)?.pools ?? [];
      const pool = pools.find((row) => row.address === address);
      if (!pool) return failed("earn.pools", "POOL_NOT_LISTED", "This pool is not among the pools Ryntra offers now; pick one from list_pools.", 404);
      const url = new URL(`/pool/${address}`, context.origin);
      url.searchParams.set("tab", "position");
      return prepared(url.toString(), "The pool's page on Ryntra, open on adding liquidity; the person types the amount, checks the range and signs.", {
        pool: { address, kind: pool.kind ?? null, pair: `${pool.x?.symbol ?? "?"}/${pool.y?.symbol ?? "?"}`, tvlUsd: pool.tvlUsd ?? null },
      });
    },
  },
  {
    name: "hire_agent",
    title: "Hire an agent with a sentence",
    kind: "prepare",
    description:
      "One sentence the person said — «trade 1 SOL a day», «find new coins and trade for me», «launch me a token Neon Fox $NEON», «work with my 2 SOL: some into savings, trade some» — read by Ryntra's own agent line into a plan, and a link that opens that plan's card filled. The person reads the card and signs there in their own wallet. A sentence that sends money to an address is never turned into a link. Nothing is signed here.",
    inputSchema: { sentence: z.string().min(2).max(280).describe("The person's sentence, as they said it, in English or Ukrainian; up to 140 characters.") },
    run: async (args, context) => {
      const towers = await towersNow(context);
      const outcome = planSentence(args.sentence, context.origin, { ...context.plan, towers });
      if (!outcome.ok) return failed(null, outcome.code, outcome.message, outcome.code === "NOT_FROM_A_LINK" ? 403 : 422);
      return prepared(outcome.link, outcome.plan.opens, { ...outcome.plan.fields, kind: outcome.plan.kind, sentence: outcome.sentence, screen: outcome.plan.screen });
    },
  },
];

export const OWN_TOOLS: readonly OwnTool[] = Object.freeze(TOOLS);

export function ownTool(name: string): OwnTool | null {
  return OWN_TOOLS.find((tool) => tool.name === name) ?? null;
}

/* ── running one tool ───────────────────────────────────────────────────── */

export type OwnEnvelope = Readonly<{
  tool: string;
  asOf: string;
  observedAt: string | null;
  source: Readonly<{ name: "Ryntra"; route: string | null; url: string | null }>;
  notice: string;
  truncated?: true;
  data?: unknown;
  error?: Readonly<{ code: string; message: string; status: number }>;
}>;

function observedAtOf(body: unknown): string | null {
  if (!body || typeof body !== "object") return null;
  const record = body as Record<string, unknown>;
  for (const key of ["observedAt", "fetchedAt", "readAt", "asOf", "at", "generatedAt"]) {
    if (typeof record[key] === "string" && !Number.isNaN(Date.parse(record[key] as string))) return record[key] as string;
  }
  return null;
}

/** Run one of Ryntra's own tools: validate, run, clean every string, wrap. Never throws for a route's own refusal. */
export async function runOwnTool(tool: OwnTool, rawArgs: unknown, context: OwnContext, nowMs: () => number = Date.now): Promise<Readonly<{ envelope: OwnEnvelope; isError: boolean; reasonCode: string | null }>> {
  const parsed = z.object(tool.inputSchema).strict().safeParse(rawArgs ?? {});
  let result: OwnResult;
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    result = failed(null, "VALIDATION_ERROR", `${issue?.path?.join(".") || "input"}: ${issue?.message ?? "did not match the tool's schema"}`);
  } else {
    try {
      result = await tool.run(parsed.data as Record<string, unknown>, context);
    } catch {
      result = failed(null, "TOOL_FAILED", "The tool could not finish now; try again.", 500);
    }
  }
  const asOf = new Date(nowMs()).toISOString();
  const route = result.route ? `GET ${OWN_ROUTES[result.route]}` : null;
  const query = new URLSearchParams(Object.entries(result.query ?? {})).toString();
  const url = result.route ? `${context.origin}${OWN_ROUTES[result.route]}${query ? `?${query}` : ""}` : null;
  const base = { tool: tool.name, asOf, source: { name: "Ryntra" as const, route, url }, notice: CHAIN_TEXT_NOTICE };
  if (result.error) return { envelope: { ...base, observedAt: null, error: result.error }, isError: true, reasonCode: result.error.code };
  const { data, truncated } = cleanData(result.data);
  return { envelope: { ...base, observedAt: observedAtOf(result.data), ...(truncated ? { truncated: true as const } : {}), data }, isError: false, reasonCode: null };
}
