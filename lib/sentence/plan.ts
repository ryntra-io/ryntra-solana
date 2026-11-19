/**
 * One sentence → the agent's plan. What a model made of a
 * person's words is only a draft, and nothing of it is trusted. This module is everything between that draft and a plan
 * the terminal fills a card with:
 *
 * - **`readDraft`** keeps only what the schema names (`./model.ts` `SENTENCE_SCHEMA`): one of five actions, a coin as the
 *   person wrote it, a few choices and numbers. Any other key, a string where a number goes, a negative, a NaN, prose —
 *   dropped. A draft with no action, or a coin the engine does not know, is a question back («Уточни: …»), a code the
 *   line says in its own language: the model's own words never reach the screen.
 * - **Every number comes from the person's words** (`typedNumbers`): a number the draft carries that is not among the
 *   digits the person typed is dropped, each typed number used once. The model does not count, round, convert or invent
 *   a sum; what the person wrote in words («пів SOL», «a little») is dropped the same way and the card asks for it.
 * - **The coin too**: its ticker or a name the engine knows for it stands in the sentence as a word, and it is a coin of
 *   the book the terminal reads (the market's verified towers, SOL and USDC). A coin the person named that the book does
 *   not hold is «Уточни: яку монету?», never a near match.
 * - **Someone else's text is data.** Words inside quotes («…», "…") are a name the person pasted — a launch's name, a coin's
 *   description: no amount and no coin is read from them. Names and descriptions of coins never reach the model at all.
 * - **The engine's bounds hold**: the budget is checked by the mandate's own rules (`lib/mandate/budget.ts`
 *   `budgetIssue`), a strategy is drawn into its bounds (`lib/mandate/plans.ts` `boundedPlan`); a number the bounds do
 *   not take is dropped and named, and the card asks.
 *
 * It opens, signs and sends nothing: the terminal turns the plan into the card of the right shelf
 * (`city/lib/command/plan.ts`), the person reads it and signs there. No key is read here.
 *
 * Pure: no clock, no network, no model. Relative imports only: `node --test` imports this module directly.
 */

import { budgetIssue, defaultDays, defaultTrade, DAYS_MAX, type AgentBudget } from "../mandate/budget.ts";
import { boundedPlan, type StrategyPlan } from "../mandate/plans.ts";

/* ------------------------------------------------------------------------------------------------ the draft */

/**
 * What the agent is asked to do:
 * - `trade` — trade a coin by itself within a budget a day («торгуй JUP за мене на 2 SOL на день»);
 * - `scout` — find new coins itself and trade them («знаходь нові монети»);
 * - `care` — look after the person's pool («доглядай мій пул»);
 * - `dca` — buy a coin on a schedule («купуй SOL щодня»);
 * - `launch` — prepare a launch of a coin («запусти мені токен»).
 */
export const SENTENCE_ACTIONS = ["trade", "scout", "care", "dca", "launch"] as const;
export type SentenceAction = (typeof SENTENCE_ACTIONS)[number];

export const SENTENCE_STRATEGIES = ["steady", "dip", "grid"] as const;
export type SentenceStrategy = (typeof SENTENCE_STRATEGIES)[number];

export const SENTENCE_CADENCES = ["daily", "weekly", "monthly"] as const;
export type SentenceCadence = (typeof SENTENCE_CADENCES)[number];

/** The one question back: which action, which coin, or say it another way. */
export const SENTENCE_NEEDS = ["action", "coin", "other"] as const;
export type SentenceNeed = (typeof SENTENCE_NEEDS)[number];

/** The numbers a draft may carry — each must stand among the digits the person typed. */
export const SENTENCE_NUMBERS = ["perDaySol", "perTradeSol", "days", "weeks", "months", "takeProfitPct", "stopLossPct", "dipPct", "gridStepPct", "gridLevels", "usd"] as const;
export type SentenceNumber = (typeof SENTENCE_NUMBERS)[number];

/** The longest sentence read: the agent's line takes no more (`city/lib/command/parse.ts` `COMMAND_MAX`). */
export const SENTENCE_MAX = 140;

/** A coin of the book the terminal reads: the market's verified towers, SOL and USDC. */
export type BookCoin = Readonly<{ mint: string; symbol: string }>;

export const SOL_MINT = "So11111111111111111111111111111111111111112";
export const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

/**
 * Names people use for a coin besides its ticker, lower case — only the coins the data and routes come from (decision
 * 108: no coin is advertised), so that «солана» is the person's word for SOL. A tower's own name from the market is
 * never one of them: a coin's name is someone else's text.
 */
export const COIN_NAMES: Readonly<Record<string, readonly string[]>> = {
  SOL: ["solana", "солана", "солан", "солани", "солану", "соланы"],
  JUP: ["jupiter", "юпітер", "юпитер"],
  MET: ["meteora", "метеора", "метеори", "метеору"],
  USDC: ["usdc", "юсдс"],
};

/** The plan the engine keeps: every field the person's own, or null where they said nothing the engine could take. */
export type AgentPlan<C extends BookCoin = BookCoin> = Readonly<{
  action: SentenceAction;
  said: string;
  /** The coin named: for `trade` never SOL or USDC (the agent pays with SOL); for `dca` the coin bought. */
  coin: C | null;
  /** The day's budget in SOL, the person's digits («2», «0.5»). */
  perDaySol: string | null;
  /** A trade's limit in SOL, the person's digits. */
  perTradeSol: string | null;
  /** The agent's term in days, from the person's digits («10 днів», «2 weeks» → 14). */
  days: number | null;
  /** The strategy and its exits (`trade`, `scout`); null — none said, the steady one. */
  strategy: StrategyPlan | null;
  /** A regular purchase (`dca`): dollars each time, and how often. */
  usd: string | null;
  cadence: SentenceCadence | null;
  /** A launch (`launch`): the name and the ticker, only as they stand in the sentence. */
  name: string | null;
  symbol: string | null;
  /** What the draft carried that the engine did not keep: a number not typed, outside the bounds, a coin not named. */
  dropped: readonly string[];
}>;

export type SentenceReading<C extends BookCoin = BookCoin> =
  | Readonly<{ kind: "plan"; plan: AgentPlan<C> }>
  /** `word` — the coin as the person wrote it, when the question is which coin they meant. */
  | Readonly<{ kind: "clarify"; need: SentenceNeed; word?: string }>;

/* ------------------------------------------------------------------------------------------------ the person's words */

/** Quotes a pasted name stands in: what is inside is data, never an amount or a coin. */
const QUOTED = /«[^»]*»|"[^"]*"|“[^”]*”|„[^“”]*[“”]|'[^']*'|‘[^’]*’|`[^`]*`/gu;

/** The sentence without what stands in quotes. */
export function unquoted(sentence: string): string {
  return sentence.normalize("NFKC").replace(QUOTED, " ");
}

/** The sentence as read: one line, at most `SENTENCE_MAX` characters, control characters gone. */
export function sentenceOf(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const text = input
    .replace(/[\u0000-\u001f\u007f\u2028\u2029]+/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
  return text.length > 0 && text.length <= SENTENCE_MAX ? text : null;
}

/** One number the person typed, with every way it may be read: «1,5» is 1.5; «1,000» is 1000 to one reader and 1 to another. */
export type Typed = Readonly<{ readings: readonly Readonly<{ value: number; text: string }>[] }>;

/**
 * The numbers a person typed outside quotes: digits with one separator («2», «0,5», «1.25», «1,000»), a «k» right after
 * them is not read. Words that say a number («пів», «ten») are not numbers here.
 */
export function typedNumbers(sentence: string): readonly Typed[] {
  const out: Typed[] = [];
  for (const match of unquoted(sentence).matchAll(/(?<![\p{L}\p{N}_.,])(\d{1,12}(?:[.,]\d{1,12})?)(?![\p{N}]|[.,]\d)/gu)) {
    const raw = match[1]!;
    const texts = new Set<string>([raw.replace(",", "."), ...(/^\d{1,3},\d{3}$/u.test(raw) ? [raw.replace(",", "")] : [])]);
    const readings = [...texts].map((text) => ({ value: Number(text), text: text.replace(/^0+(?=\d)/u, "") })).filter((r) => Number.isFinite(r.value) && r.value > 0);
    if (readings.length > 0) out.push({ readings });
  }
  return out;
}

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");

/** Whether a coin stands in the person's words outside quotes: its ticker as a word (with or without `$`), or a name the engine knows for it. */
export function coinInWords(symbol: string, sentence: string): boolean {
  const text = unquoted(sentence).toLowerCase();
  const ticker = symbol.toLowerCase();
  if (!/^[\p{L}\p{N}]{1,16}$/u.test(ticker)) return false;
  if (new RegExp(`(?<![\\p{L}\\p{N}])\\$?${escape(ticker)}(?![\\p{L}\\p{N}])`, "u").test(text)) return true;
  // A name may carry its case ending: «юпітера», «солану».
  return (COIN_NAMES[symbol.toUpperCase()] ?? []).some((name) => new RegExp(`(?<![\\p{L}\\p{N}])${escape(name)}\\p{L}{0,3}(?![\\p{L}\\p{N}])`, "u").test(text));
}

/** A ticker as the book writes it: letters and digits, without a `$`. */
const bareSymbol = (symbol: string) => symbol.replace(/^\$/u, "").toUpperCase();

/** The book's coin the model's word names — by its ticker, or a name the engine knows — or null. */
export function coinOf<C extends BookCoin>(word: string, coins: readonly C[]): C | null {
  const said = word.trim().replace(/^\$/u, "").toLowerCase();
  if (!said) return null;
  const known = Object.entries(COIN_NAMES).find(([, names]) => names.includes(said))?.[0] ?? null;
  const symbol = known ?? said.toUpperCase();
  return coins.find((coin) => bareSymbol(coin.symbol) === symbol) ?? null;
}

/* ------------------------------------------------------------------------------------------------ the check */

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const oneOf = <T extends string>(list: readonly T[], v: unknown): T | undefined => (typeof v === "string" && (list as readonly string[]).includes(v) ? (v as T) : undefined);
const positive = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && v > 0 && v <= 1e12;

/** SOL as said, in lamports; null when it has more than nine decimals or is not a plain decimal. */
export function lamportsOf(sol: string): bigint | null {
  if (!/^\d{1,12}(\.\d{1,9})?$/u.test(sol)) return null;
  const [whole, fraction = ""] = sol.split(".");
  const value = BigInt(whole || "0") * 1_000_000_000n + BigInt((fraction + "000000000").slice(0, 9));
  return value > 0n ? value : null;
}

/** A dollar amount as a window's field takes it: a plain decimal, at most two places. */
const usdOf = (text: string) => (/^\d{1,9}(\.\d{1,2})?$/u.test(text) && Number(text) > 0 ? text : null);

/** A launch's name as it stands in the sentence: letters, digits and spaces, at most 32 characters; null otherwise. */
function nameOf(value: unknown, sentence: string): string | null {
  if (typeof value !== "string") return null;
  const name = value.trim().replace(/\s+/gu, " ");
  if (!name || name.length > 32 || !/^[\p{L}\p{N}][\p{L}\p{N} ]*$/u.test(name)) return null;
  return sentence.normalize("NFKC").toLowerCase().includes(name.toLowerCase()) ? name : null;
}

/** A launch's ticker as it stands in the sentence: 1–10 letters and digits, upper case; null otherwise. */
function symbolOf(value: unknown, sentence: string): string | null {
  if (typeof value !== "string") return null;
  const symbol = value.trim().replace(/^\$/u, "");
  if (!/^[A-Za-z0-9]{1,10}$/u.test(symbol)) return null;
  return new RegExp(`(?<![\\p{L}\\p{N}])\\$?${escape(symbol)}(?![\\p{L}\\p{N}])`, "iu").test(sentence.normalize("NFKC")) ? symbol.toUpperCase() : null;
}

/**
 * The draft's numbers held to what the person typed: each typed number once, the draft's order. Returns each kept
 * number's value and its text as typed (a point for decimals) — an amount is always the person's own digits.
 */
function held(typed: readonly Typed[], asked: readonly (readonly [SentenceNumber, number])[]): Map<SentenceNumber, { value: number; text: string }> {
  const free = typed.map((t) => ({ t, used: false }));
  const out = new Map<SentenceNumber, { value: number; text: string }>();
  for (const [name, value] of asked) {
    for (const slot of free) {
      if (slot.used) continue;
      const reading = slot.t.readings.find((r) => Math.abs(r.value - value) <= Math.max(r.value, value) * 1e-9);
      if (!reading) continue;
      slot.used = true;
      out.set(name, reading);
      break;
    }
  }
  return out;
}

/** The numbers of the draft, laid flat: `numbers` as a list of `{ name, value }` pairs, or the fields themselves. */
function numbersOf(raw: Record<string, unknown>): Array<readonly [SentenceNumber, number]> {
  const out: Array<readonly [SentenceNumber, number]> = [];
  const add = (name: unknown, value: unknown) => {
    const known = oneOf(SENTENCE_NUMBERS, name);
    if (known && positive(value) && !out.some(([n]) => n === known)) out.push([known, value]);
  };
  if (Array.isArray(raw.numbers)) for (const pair of raw.numbers) if (isObject(pair)) add(pair.name, pair.value);
  for (const name of SENTENCE_NUMBERS) add(name, raw[name]);
  return out;
}

/**
 * The budget the plan's numbers make, checked by the mandate's own rules: what the person said, the mandate's own
 * defaults for the rest (`budgetFrom`). A number the rules do not take is dropped and named — the trade before the term,
 * the term before the day — and the card asks for it.
 */
function checkedBudget(perDaySol: string | null, perTradeSol: string | null, days: number | null, dropped: string[]): { perDaySol: string | null; perTradeSol: string | null; days: number | null } {
  let day = perDaySol === null ? null : lamportsOf(perDaySol);
  let trade = perTradeSol === null ? null : lamportsOf(perTradeSol);
  let term = days;
  if (perDaySol !== null && day === null) dropped.push("perDaySol");
  if (perTradeSol !== null && trade === null) dropped.push("perTradeSol");
  if (term !== null && (!Number.isInteger(term) || term < 1 || term > DAYS_MAX)) {
    dropped.push("days");
    term = null;
  }
  // Without a day, a trade or a term is held against nothing yet: the card asks for the day, and checks there.
  if (day === null) return { perDaySol: null, perTradeSol: trade === null ? null : perTradeSol, days: term };
  const budget = (): AgentBudget => {
    const perTrade = trade ?? defaultTrade(day!);
    return { perDay: day!, perTrade, days: term ?? defaultDays({ perDay: day!, perTrade }, null) };
  };
  if (trade !== null && budgetIssue(budget()) !== null) {
    dropped.push("perTradeSol");
    trade = null;
  }
  if (term !== null && budgetIssue(budget()) !== null) {
    dropped.push("days");
    term = null;
  }
  if (budgetIssue(budget()) !== null) {
    dropped.push("perDaySol");
    day = null;
  }
  return { perDaySol: day === null ? null : perDaySol, perTradeSol: trade === null ? null : perTradeSol, days: term };
}

const unique = (list: readonly string[]): readonly string[] => [...new Set(list)];

const bps = (pct: number | undefined) => (pct === undefined ? null : Math.round(pct * 100));

/**
 * The draft as the engine takes it, from whatever a model answered, the sentence it answered and the book the terminal
 * reads: only the schema's own fields, every number one the person typed, the coin one the person named and the book
 * holds — or the one question back.
 */
export function readDraft<C extends BookCoin>(raw: unknown, input: string, coins: readonly C[]): SentenceReading<C> {
  const sentence = sentenceOf(input);
  if (!isObject(raw) || sentence === null) return { kind: "clarify", need: "other" };
  const asked = oneOf(SENTENCE_NEEDS, raw.ask);
  const action = oneOf(SENTENCE_ACTIONS, raw.action);
  if (raw.understood === false || !action) return { kind: "clarify", need: asked ?? (action ? "other" : "action") };

  const dropped: string[] = [];

  /* The coin: the person's word, a coin of the book, standing in the sentence outside quotes. */
  let coin: C | null = null;
  const word = typeof raw.coin === "string" ? raw.coin.trim().slice(0, 24) : "";
  if (word && action !== "launch" && action !== "care") {
    const found = coinOf(word, coins);
    if (found && coinInWords(found.symbol, sentence)) coin = found;
    else if (/^\$?[\p{L}\p{N}]{1,16}$/u.test(word) && coinInWords(word.replace(/^\$/u, ""), sentence)) return { kind: "clarify", need: "coin", word: word.replace(/^\$/u, "") };
    else dropped.push("coin");
  }
  // The agent trades for SOL: SOL and USDC are what it pays with, never the coin it trades. A schedule never buys USDC.
  if (coin && ((action === "trade" || action === "scout") && (coin.mint === SOL_MINT || coin.mint === USDC_MINT))) coin = null;
  if (coin && action === "dca" && coin.mint === USDC_MINT) coin = null;
  if (action === "scout") coin = null;

  /* The numbers: each typed, each once. */
  const offered = numbersOf(raw);
  const kept = held(typedNumbers(sentence), offered);
  for (const [name] of offered) if (!kept.has(name)) dropped.push(name);
  const num = (name: SentenceNumber) => kept.get(name)?.value;
  const text = (name: SentenceNumber) => kept.get(name)?.text ?? null;
  const takes = (names: readonly SentenceNumber[]) => {
    for (const name of SENTENCE_NUMBERS) if (kept.has(name) && !names.includes(name)) {
      kept.delete(name);
      dropped.push(name);
    }
  };

  const plain = { said: sentence, coin, perDaySol: null, perTradeSol: null, days: null, strategy: null, usd: null, cadence: null, name: null, symbol: null } as const;

  if (action === "care") {
    takes([]);
    return { kind: "plan", plan: { ...plain, action, coin: null, dropped: unique(dropped) } };
  }
  if (action === "launch") {
    takes([]);
    const name = nameOf(raw.name, sentence);
    const symbol = symbolOf(raw.symbol, sentence);
    if (typeof raw.name === "string" && raw.name.trim() && !name) dropped.push("name");
    if (typeof raw.symbol === "string" && raw.symbol.trim() && !symbol) dropped.push("symbol");
    return { kind: "plan", plan: { ...plain, action, coin: null, name, symbol, dropped: unique(dropped) } };
  }
  if (action === "dca") {
    takes(["usd"]);
    const usd = text("usd") === null ? null : usdOf(text("usd")!);
    if (text("usd") !== null && usd === null) dropped.push("usd");
    return { kind: "plan", plan: { ...plain, action, usd, cadence: oneOf(SENTENCE_CADENCES, raw.cadence) ?? null, dropped: unique(dropped) } };
  }

  /* `trade` and `scout`: a budget a day, a trade's limit, a term, a strategy with its exits. */
  takes(["perDaySol", "perTradeSol", "days", "weeks", "months", "takeProfitPct", "stopLossPct", "dipPct", "gridStepPct", "gridLevels"]);
  const spans = (["days", "weeks", "months"] as const).filter((name) => kept.has(name));
  let days: number | null = null;
  if (spans.length === 1) {
    const value = num(spans[0]!)!;
    days = spans[0] === "weeks" ? value * 7 : spans[0] === "months" ? value * 30 : value;
  } else for (const span of spans) dropped.push(span);
  const budget = checkedBudget(text("perDaySol"), text("perTradeSol"), days, dropped);

  const said = oneOf(SENTENCE_STRATEGIES, raw.strategy);
  const take = num("takeProfitPct");
  const stop = num("stopLossPct");
  const id = action === "scout" ? "early" : said === "dip" || said === "grid" ? said : take !== undefined || stop !== undefined ? "steady" : null;
  if (said !== "dip" && kept.has("dipPct")) dropped.push("dipPct");
  if (said !== "grid") for (const name of ["gridStepPct", "gridLevels"] as const) if (kept.has(name)) dropped.push(name);
  const strategy = id === null ? null : boundedPlan({ id, dropBps: id === "dip" ? bps(num("dipPct")) : null, stepBps: id === "grid" ? bps(num("gridStepPct")) : null, levels: id === "grid" ? (num("gridLevels") ?? null) : null, takeBps: bps(take), stopBps: bps(stop) });
  /* A figure the strategy's bounds do not take as said is named: the card shows the bound. */
  if (strategy) {
    if (take !== undefined && strategy.exit?.takeBps !== bps(take)) dropped.push("takeProfitPct");
    if (stop !== undefined && strategy.exit?.stopBps !== bps(stop)) dropped.push("stopLossPct");
    if (strategy.id === "dip" && num("dipPct") !== undefined && strategy.dropBps !== bps(num("dipPct"))) dropped.push("dipPct");
    if (strategy.id === "grid" && num("gridStepPct") !== undefined && strategy.stepBps !== bps(num("gridStepPct"))) dropped.push("gridStepPct");
    if (strategy.id === "grid" && num("gridLevels") !== undefined && strategy.levels !== num("gridLevels")) dropped.push("gridLevels");
  }

  return { kind: "plan", plan: { ...plain, action, ...budget, strategy, dropped: unique(dropped) } };
}
