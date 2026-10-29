/**
 * One pass of «Ранковий огляд» (AI-10) — what the cron runs every five
 * minutes, with every outside thing passed in, so a test runs the whole pass
 * on a memory store with fake reads, a fake model and a fake clock.
 *
 * The pass: every wallet whose brief is on and due (`schedule.ts`) gets
 * - «Сьогодні на ринку» — one summary for everyone in the hour, built once:
 *   the server's lines and the model's words over them, in both languages;
 * - «Твоє» — only what changed in its tokens, positions and plans; when
 *   nothing did, the brief is the market's alone and no model is called;
 *   what could not be read is said as not read, never as «nothing changed»;
 * - one note in the inbox, and its deliveries queued on Telegram and push as
 *   the person's Нагляд preferences say — the monitoring cron sends them and
 *   holds them through quiet hours, as it holds every note. The note's id is
 *   the wallet's and the day's, so a pass cut short is finished by the next
 *   one and never makes a second note.
 *
 * The model is asked on Flex (`service_tier: "flex"`, half the price); a
 * busy Flex answers 429 and is not charged, and the brief waits for the next
 * pass, up to `WORDS_WAIT_MS` past its time (or until the next pass would fall
 * in quiet hours) — then it goes with its lines and without words; it is never
 * asked again at Standard. A call Flex itself handed to Standard is priced as
 * Standard, as the response says. Every call is counted on the deployment's
 * ceilings and leaves a priced receipt. The brief is part of what is free
 * every day: `BRIEF_PRICE_CREDITS` is 0 and
 * nothing is charged — a person's part costs ≈ $0.00005.
 *
 * The words are held to the lines (`holdWords`): a figure only as a line
 * states it, by its unit; no cause the lines do not state; no order, no
 * advice, no link, no «Ryn», no headline repeated as its own; a block of at
 * most two lines on a phone.
 *
 * Nothing here signs, sends money or trades: the only writes are the
 * brief's own records, the note and its queued deliveries.
 */

import { createHash } from "node:crypto";

import { BLOCK_MAX_CHARS } from "../../agent/answer.ts";
import { pctText } from "../../agent/provenance.ts";
import type { MorningBriefAsk, MorningBriefResult } from "../../agent/model.ts";
import type { DigestRead } from "../news/store.ts";
import type { AgentReaders, HoldingsRead, SpotMarketRead } from "../../agent/tools/readers.ts";
import type { GuardStore } from "../../guard/store.ts";
import { enqueue, inboxKeyOf } from "../../monitoring/apply.ts";
import { inQuietHours, type QuietHours } from "../../monitoring/quiet-hours.ts";
import { inboxOf, isPositionNote, listInbox, monitorNotes, readPreferences, type InboxRecord } from "../../monitoring/store.ts";
import { CBBTC_MINT, SOL_MINT } from "../news/tagging.ts";
import { lineSentence, marketLines, personalLines, STABLE_MINTS, TOKENS_MAX, type BriefLine, type BriefLocale, type PersonalToken } from "./lines.ts";
import { dueDay, localParts } from "./schedule.ts";
import { listEnabledSettings, marketSummaryVersion, pruneBriefs, pruneMarketSummaries, readBrief, readMarketSummary, slotOf, writeBrief, writeMarketSummary, writeRun, type BriefRecord, type BriefRun, type BriefSettings, type BriefSpend, type BriefWords, type MarketSummary } from "./store.ts";
import { briefReason, briefTitle, BRIEF_CTA } from "./words.ts";

/** The brief's price in credits: free every day (AI-04 — part of «щось безплатно щодня»; measured ≈ $0.00005 a person's part). */
export const BRIEF_PRICE_CREDITS = 0;
/** How long past its time a brief waits for its words while Flex is busy. */
export const WORDS_WAIT_MS = 30 * 60_000;
/** A market summary being built by another pass longer than this is taken over. */
export const BUILD_LEASE_MS = 2 * 60_000;
/**
 * The pass starts no new person after this: a person's reads are bounded by
 * `PERSON_READS_MS` and the model's call by its own 30 s, so a person started
 * before it ends inside the function's minute. The rest wait five minutes.
 */
export const PASS_BUDGET_MS = 15_000;
export const PERSON_READS_MS = 10_000;
const READ_MS = 4_000;
const CRON_EVERY_MS = 5 * 60_000;
const CONCURRENCY = 4;

export type BriefModel = (ask: MorningBriefAsk, payer: string) => Promise<MorningBriefResult>;

export type BriefDeps = Readonly<{
  store: GuardStore;
  readers: Pick<AgentReaders, "spotMarket" | "movers" | "news" | "watchlist" | "holdings">;
  /** The model on Flex, with the reservation and the receipt around it; null when the deployment has none switched on. */
  model: BriefModel | null;
  clock: () => number;
  /** Price a call from its usage; the runtime prices with `lib/assistant/models.ts`. */
  price: (result: MorningBriefResult) => number | null;
  /** People made at once; the stand's single-connection store takes one. */
  concurrency?: number;
}>;

const MARKET_PAYER = "system_brief";

/** A read with its own deadline: past it, the fallback — a read that did not answer is a read that failed. */
async function within<T>(ms: number, work: () => Promise<T>, fallback: T): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([work().catch(() => fallback), new Promise<T>((settle) => (timer = setTimeout(() => settle(fallback), ms)))]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

const failedSpot: SpotMarketRead = { ok: false, reason: "The catalogue did not answer in time." };
const failedNews: DigestRead = { ok: false, reason: "The news did not answer in time." };

function spendOf(result: MorningBriefResult, price: (result: MorningBriefResult) => number | null): BriefSpend {
  return { model: result.model.slice(0, 64), serviceTier: result.serviceTier ?? "default", costMicroUsd: price(result), input: result.usage.input, cached: result.usage.cached, output: result.usage.output, latencyMs: Math.max(0, Math.round(result.latencyMs)) };
}

const busy = (result: MorningBriefResult) => !result.ok && (result.outcome === "rate-limited" || result.outcome === "timeout" || result.outcome === "unavailable");

/*
 * The model writes no words: it picks lines and their order (`picks`), and
 * the server says each pick from its own lines — a move with its direction
 * and size, a plan's note as Нагляд wrote it, a report as the publication's
 * («CoinDesk пише: «…»»). A block is moves or reports, never both: a move and
 * a story side by side would read as cause and effect. So no direction, size,
 * cause, mood or fact the lines do not state can reach a person.
 */
const pctOf = (value: number, locale: BriefLocale) => pctText(Math.abs(value), locale, 1).replace(/^\+/, "");

/** A fact line as the server says it in a sentence — the direction and the size from the line. */
export function sayMove(line: BriefLine, locale: BriefLocale): string | null {
  const claim = locale === "uk" ? line.uk : line.en;
  if (line.kind === "plan") return claim;
  if (line.kind === "mover") {
    const up = line.figures.moves.filter((move) => move.pct > 0).map((move) => `${move.symbol} (${pctText(move.pct, locale, 1)})`).join(", ");
    const down = line.figures.moves.filter((move) => move.pct < 0).map((move) => `${move.symbol} (${pctText(move.pct, locale, 1)})`).join(", ");
    const parts = locale === "uk" ? [up ? `найбільше зросли ${up}` : null, down ? `найбільше впали ${down}` : null] : [up ? `${up} rose most` : null, down ? `${down} fell most` : null];
    const said = parts.filter(Boolean).join(locale === "uk" ? ", а " : " and ");
    /* The movers are the verified tokens' only: the fill says so itself, so «most» is never a claim about the whole market. */
    return said ? (locale === "uk" ? `серед перевірених токенів ${said}` : `among verified tokens, ${said}`) : null;
  }
  if (line.kind !== "sol" && line.kind !== "btc" && line.kind !== "token") return null;
  const move = line.figures.moves[0];
  if (!move) return null;
  const subject = line.kind === "btc" ? "BTC (cbBTC)" : line.kind === "sol" ? "SOL" : claim.split(/\s+(?=[+−-]\d)/u)[0];
  if (Math.abs(move.pct) < 0.05) return locale === "uk" ? `${subject} майже не змінився` : `${subject} was nearly flat`;
  if (locale === "uk") return `${subject} ${move.pct > 0 ? "зріс" : "знизився"} на ${pctOf(move.pct, locale)}`;
  return `${subject} ${move.pct > 0 ? "rose" : "fell"} ${pctOf(move.pct, locale)}`;
}

/** A report as the publication's own: «CoinDesk пише: «…»» — never as a fact. */
export function sayReport(line: BriefLine, locale: BriefLocale): string {
  const claim = locale === "uk" ? line.uk : line.en;
  /* A token's story names its token first («Bonk: «…»»): said as what the publication writes about it. */
  if (line.kind === "token-news") return locale === "uk" ? `${line.source} пише про ${claim}` : `${line.source} reports on ${claim}`;
  return locale === "uk" ? `${line.source} пише: ${claim}` : `${line.source} reports: ${claim}`;
}

export type BriefPick = Readonly<{ ids: readonly string[]; join: "and" | "while" }>;

/** One pick said by the server, or null: unknown ids, a mix of moves and reports, or too long for two lines on a phone. */
export function sayPick(pick: BriefPick, lines: readonly BriefLine[], locale: BriefLocale): string | null {
  const byId = new Map(lines.map((line) => [line.id, line]));
  const chosen = [...new Set(pick.ids)].map((id) => byId.get(id));
  if (chosen.length === 0 || chosen.some((line) => line === undefined)) return null;
  const picked = chosen as BriefLine[];
  const reports = picked.filter((line) => line.mark === "unverified");
  if (reports.length > 0 && reports.length < picked.length) return null;
  const parts = picked.map((line) => (reports.length > 0 ? sayReport(line, locale) : sayMove(line, locale)));
  if (parts.some((part) => part === null)) return null;
  const finish = (text: string) => `${text.charAt(0).toUpperCase()}${text.slice(1)}${/[.!?…]$/u.test(text) ? "" : "."}`;
  const sayFirst = (count: number) => {
    const taken = (parts as string[]).slice(0, count);
    if (reports.length > 0) return finish(taken.join("; "));
    /* «тоді як» only for two moves that went opposite ways — the lines' signs decide, not the model's join. */
    const sign = (line: BriefLine) => Math.sign(line.figures.moves[0]?.pct ?? 0);
    const opposite = taken.length === 2 && picked[0].kind !== "mover" && picked[1].kind !== "mover" && sign(picked[0]) * sign(picked[1]) < 0;
    const join = pick.join === "while" && opposite ? (locale === "uk" ? ", тоді як " : ", while ") : "; ";
    /* A plan's note leads with its own label («SOL: …»): no «За добу:» before it. */
    const lead = picked[0].kind === "plan" ? "" : locale === "uk" ? "За добу: " : "Over the day: ";
    return finish(`${lead}${taken.join(join)}`);
  };
  /* As many of the picked lines, in their order, as two lines on a phone hold. */
  for (let count = parts.length; count > 0; count -= 1) {
    const said = sayFirst(count);
    if (said.length <= BLOCK_MAX_CHARS) return said;
  }
  return null;
}

/** A language's picks said; none holds → null, and the part is its lines alone. */
export function holdWords(picks: readonly BriefPick[], lines: readonly BriefLine[], locale: BriefLocale): string[] | null {
  const kept = picks.map((pick) => sayPick(pick, lines, locale)).filter((block): block is string => block !== null).slice(0, 2);
  return kept.length > 0 ? kept : null;
}

type Pass = { calls: number; cost: number; marketCall: boolean };

/* The lines as the model reads them, with the ids it picks from. */
const asked = (lines: readonly BriefLine[]) => lines.map((line) => ({ id: line.id, kind: line.kind, mark: line.mark, en: lineSentence(line, "en"), uk: lineSentence(line, "uk") }));

/**
 * «Сьогодні на ринку» for this hour: read, or built once — the lines first,
 * then the words over them. Null while another pass is building it, or while
 * Flex is busy within the wait: the people of this pass wait five minutes
 * rather than get a brief without the market's words.
 */
async function marketSummary(deps: BriefDeps, nowMs: number, pass: Pass, canWait: boolean): Promise<MarketSummary | null> {
  const slot = slotOf(nowMs);
  const at = new Date(nowMs).toISOString();
  const found = await readMarketSummary(deps.store, slot);
  if (found?.state === "ready") return found;
  if (found && nowMs - Date.parse(found.builtAt) < BUILD_LEASE_MS) return null;
  /* Claim the slot: one pass builds, another reads what it built. */
  const stored = found?.version ?? (await marketSummaryVersion(deps.store, slot));
  const claim: MarketSummary = { schema: "ryntra.assistant.market-summary", version: (stored ?? 0) + 1, slot, state: "building", builtAt: at, lines: [], words: null, spend: null };
  if (!(await writeMarketSummary(deps.store, claim, stored))) {
    const now = await readMarketSummary(deps.store, slot);
    return now?.state === "ready" ? now : null;
  }
  /* Every read bounded and caught: a read that fails is a line that is not there, never a pass that fails for everyone. */
  const sol = await within(READ_MS, () => deps.readers.spotMarket(SOL_MINT), failedSpot);
  const btc = await within(READ_MS, () => deps.readers.spotMarket(CBBTC_MINT), failedSpot);
  const movers = await within(READ_MS * 2, () => deps.readers.movers("h24"), { ok: false as const, reason: "Pulse did not answer in time." });
  const news = await within(READ_MS, () => deps.readers.news(null), failedNews);
  const lines = marketLines({ sol, btc, movers, news }, nowMs);
  let words: BriefWords | null = null;
  let spend: BriefSpend | null = null;
  if (deps.model && lines.length > 0) {
    const result = await deps.model({ scope: "market", day: localParts(nowMs, "Europe/Kyiv").day, locales: ["uk", "en"], lines: asked(lines) }, MARKET_PAYER);
    pass.marketCall = true;
    spend = result.usage.total > 0 || result.ok ? spendOf(result, deps.price) : null;
    if (spend?.costMicroUsd) pass.cost += spend.costMicroUsd;
    if (busy(result) && canWait && nowMs - Date.parse(`${slot}:00:00.000Z`) < WORDS_WAIT_MS) {
      /* Flex busy: the slot is let go at once, and the next pass asks again. */
      await writeMarketSummary(deps.store, { ...claim, version: claim.version + 1, builtAt: new Date(nowMs - BUILD_LEASE_MS).toISOString() }, claim.version);
      return null;
    }
    if (result.ok) {
      const uk = holdWords(result.picks.blocks, lines, "uk");
      const en = holdWords(result.picks.blocks, lines, "en");
      words = uk || en ? { uk: uk ?? [], en: en ?? [] } : null;
    }
  }
  const ready: MarketSummary = { ...claim, version: claim.version + 1, state: "ready", builtAt: new Date(deps.clock()).toISOString(), lines, words, spend };
  await writeMarketSummary(deps.store, ready, claim.version);
  return ready;
}

type Own = { mint: string; held: boolean; watched: boolean };

/** The mints of a wallet's own: what it holds (less stablecoins) and its watchlist, the held first. */
function ownMints(holdings: HoldingsRead, watchlist: readonly string[]): Own[] {
  const held = holdings.ok ? holdings.holdings.filter((row) => row.kind === "TOKEN" && row.amountRaw !== "0").map((row) => row.mint) : [];
  const out = new Map<string, Own>();
  /* SOL itself is the market's line; a wallet's SOL is no change of its own. */
  for (const mint of held) if (mint !== SOL_MINT && !STABLE_MINTS.has(mint)) out.set(mint, { mint, held: true, watched: false });
  for (const mint of watchlist) {
    if (mint === SOL_MINT || STABLE_MINTS.has(mint)) continue;
    const prior = out.get(mint);
    out.set(mint, { mint, held: prior?.held ?? false, watched: true });
  }
  return [...out.values()];
}

async function mapLimited<T, R>(items: readonly T[], limit: number, work: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const index = next++;
        out[index] = await work(items[index]);
      }
    }),
  );
  return out;
}

type PersonalPart = Readonly<{ lines: BriefLine[]; state: BriefRecord["personalState"]; gap: BriefRecord["personalGap"] }>;

/**
 * «Твоє»: the person's tokens read one by one (a stand's store answers one
 * query at a time) under one deadline, the notes of their plans and
 * positions. Anything that did not answer — the wallet, a partial wallet,
 * the watchlist, a token's price, the tokens past the cap or the deadline,
 * the notes — is counted, so the brief never says «nothing changed» of what
 * it did not read.
 */
async function personalPart(deps: BriefDeps, owner: string, nowMs: number): Promise<PersonalPart> {
  const deadline = deps.clock() + PERSON_READS_MS;
  const left = () => Math.max(0, deadline - deps.clock());
  const listFailed = Symbol("list");
  const watchlist = await within<readonly string[] | typeof listFailed>(READ_MS, () => deps.readers.watchlist(owner), listFailed);
  const holdings = await within<HoldingsRead>(READ_MS * 2, () => deps.readers.holdings(owner), { ok: false, reason: "The wallet did not answer in time." });
  const own = ownMints(holdings, watchlist === listFailed ? [] : watchlist);
  const tokens: PersonalToken[] = [];
  let unreadTokens = 0;
  for (const [index, entry] of own.entries()) {
    if (index >= TOKENS_MAX || left() === 0) {
      unreadTokens += 1;
      continue;
    }
    const market = await within(Math.min(READ_MS, left()), () => deps.readers.spotMarket(entry.mint), failedSpot);
    const news = await within(Math.min(READ_MS, left()), () => deps.readers.news(entry.mint), failedNews);
    /* A token the catalogue does not price is a token whose change nobody read. */
    if (!market.ok || !market.market || market.market.change24hPct === null) unreadTokens += 1;
    tokens.push({ ...entry, market, news });
  }
  let notesFailed = false;
  const inbox = await listInbox(deps.store, owner).catch(() => {
    notesFailed = true;
    return [] as readonly InboxRecord[];
  });
  const notes = [...monitorNotes(inbox), ...inbox.filter(isPositionNote)];
  const shown = personalLines({ tokens, notes }, nowMs);
  const more = shown.more ?? 0;
  const hidden = shown.hidden ?? 0;
  const lines = [...shown];
  const list = watchlist === listFailed;
  /* The wallet not read at all, or read in part — some of its tokens not seen: either is said, beside any change. */
  const wallet: "unread" | "partial" | null = !holdings.ok ? "unread" : holdings.tokenRead !== "COMPLETE" ? "partial" : null;
  const gap = unreadTokens > 0 || notesFailed || list || wallet || more > 0 || hidden > 0 ? { tokens: unreadTokens, of: own.length, notes: notesFailed, list, wallet, more, hidden } : null;
  /* An unverified token that moved is a change, though it has no line: never «nothing changed». */
  if (lines.length > 0 || hidden > 0) return { lines, state: "changed", gap };
  /* «More» is no gap in what was read; anything else is. */
  return { lines, state: gap && (gap.tokens > 0 || gap.notes || gap.list || gap.wallet) ? "unread" : "unchanged", gap };
}

/** The brief's note stands under no monitor; the contract's note carries one, so it is the wallet's brief's own, derived and stable. */
export function briefMonitorId(owner: string): string {
  return `mon_${createHash("sha256").update(`assistant-brief:${owner}`).digest("hex").slice(0, 24)}`;
}

/** The note of a wallet's day: one id, whatever pass writes it — a pass cut short is finished by the next one, never doubled. */
export function briefInboxId(owner: string, day: string): string {
  return `inb_${createHash("sha256").update(`assistant-brief:${owner}:${day}`).digest("hex").slice(0, 24)}`;
}

/** The note and its deliveries — each written if absent, so a retry finishes what a failure left and repeats nothing. */
async function deliver(deps: BriefDeps, record: BriefRecord, nowMs: number): Promise<string> {
  const identity = `assistant-brief:${record.owner}:${record.day}`;
  const at = new Date(nowMs).toISOString();
  const inboxId = briefInboxId(record.owner, record.day);
  const locale = record.locale;
  const note: InboxRecord = {
    id: inboxId,
    owner: record.owner,
    monitorId: briefMonitorId(record.owner),
    triggerId: identity,
    title: briefTitle(record.day, locale),
    /* One block in the inbox; the whole brief — on the assistant's page and in Telegram. */
    reason: briefReason(record, locale),
    context: "Ryntra",
    href: `/app/alerts/open?n=${inboxId}`,
    cta: BRIEF_CTA[locale],
    paper: false,
    unread: true,
    createdAt: at,
    locale,
    subject: { kind: "assistant-brief", id: record.day },
  };
  await inboxOf(deps.store).insertIfAbsent(inboxKeyOf(record.owner, inboxId), note);
  const prefs = await readPreferences(deps.store, record.owner);
  if (prefs.telegram) await enqueue(deps.store, record.owner, identity, inboxId, "telegram", at);
  if (prefs.push) await enqueue(deps.store, record.owner, identity, inboxId, "push", at);
  return inboxId;
}

type Outcome = "delivered" | "waiting" | "skipped";

/** One wallet's brief of a due day: made, or waiting for its words, or already done. */
async function briefFor(deps: BriefDeps, settings: BriefSettings, due: Readonly<{ day: string; at: number }>, quiet: QuietHours | null, market: MarketSummary, pass: Pass): Promise<Outcome> {
  const nowMs = deps.clock();
  const at = new Date(nowMs).toISOString();
  const found = await readBrief(deps.store, settings.owner, due.day);
  if (found?.state === "delivered") return "skipped";
  let record: BriefRecord =
    found ??
    {
      schema: "ryntra.assistant.brief",
      version: 1,
      owner: settings.owner,
      day: due.day,
      locale: settings.locale,
      state: "waiting",
      attempts: 0,
      dueAt: new Date(due.at).toISOString(),
      market: { slot: market.slot, lines: market.lines, words: market.words },
      personal: null,
      personalState: "unchanged",
      personalGap: null,
      zone: settings.zone,
      priceCredits: 0,
      charged: false,
      spend: null,
      inboxId: null,
      createdAt: at,
      updatedAt: at,
    };
  if (!found) {
    const part = await personalPart(deps, settings.owner, nowMs);
    record = { ...record, personal: part.lines.length > 0 ? { lines: part.lines, words: null } : null, personalState: part.state, personalGap: part.gap };
    /* The claim: one pass makes the day's brief; a second finds it. */
    if (!(await writeBrief(deps.store, record, null))) return "skipped";
  }
  const expected = record.version;
  /* Words for the person's own part, on Flex; the market's part already has its words. */
  if (record.personal && record.personal.words === null && deps.model) {
    /* Late: past the wait, or the next pass would be in quiet hours and could not deliver — then it goes now, with its lines. */
    const late = nowMs - due.at > WORDS_WAIT_MS || inQuietHours(nowMs + CRON_EVERY_MS, quiet);
    const result = await deps.model({ scope: "personal", day: record.day, locales: [record.locale], lines: asked(record.personal.lines) }, record.owner);
    pass.calls += 1;
    const spend = result.usage.total > 0 || result.ok ? spendOf(result, deps.price) : null;
    if (spend?.costMicroUsd) pass.cost += spend.costMicroUsd;
    if (result.ok) {
      /* Asked once: picks that held nothing are stored as none (an empty list), so a pass cut short never asks again. */
      const words = holdWords(result.picks.blocks, record.personal.lines, record.locale) ?? [];
      record = { ...record, personal: { ...record.personal, words }, spend, priceCredits: words.length > 0 ? BRIEF_PRICE_CREDITS : 0 };
    } else if (busy(result) && !late) {
      /* Flex busy or slow: the brief waits for the next pass. */
      await writeBrief(deps.store, { ...record, version: expected + 1, attempts: Math.min(20, record.attempts + 1), spend: spend ?? record.spend, updatedAt: at }, expected);
      return "waiting";
    } else {
      record = { ...record, spend: spend ?? record.spend };
    }
  }
  /* The words go into the record before any delivery is queued: Telegram reads the brief from it. */
  const settled: BriefRecord = { ...record, version: expected + 1, inboxId: briefInboxId(record.owner, record.day), updatedAt: at };
  if (!(await writeBrief(deps.store, settled, expected))) return "skipped";
  const inboxId = await deliver(deps, settled, nowMs);
  await writeBrief(deps.store, { ...settled, version: settled.version + 1, state: "delivered", inboxId }, settled.version);
  return "delivered";
}

/** One pass over every wallet whose brief is on. */
export async function runBriefPass(deps: BriefDeps): Promise<BriefRun> {
  const startedAt = deps.clock();
  const subscribers = await listEnabledSettings(deps.store);
  const due: Array<{ settings: BriefSettings; day: { day: string; at: number }; quiet: QuietHours | null }> = [];
  for (const settings of subscribers) {
    /* Quiet hours unread are no quiet hours known: the person waits for the next pass rather than be woken. */
    const prefs = await readPreferences(deps.store, settings.owner).catch(() => null);
    if (!prefs) continue;
    const quiet = prefs.quietHours;
    const day = dueDay(startedAt, { time: settings.time, zone: settings.zone }, quiet);
    if (!day) continue;
    const found = await readBrief(deps.store, settings.owner, day.day);
    if (found?.state === "delivered") continue;
    due.push({ settings, day, quiet });
  }
  const pass: Pass = { calls: 0, cost: 0, marketCall: false };
  let delivered = 0;
  let waiting = 0;
  let deferred = 0;
  if (due.length > 0) {
    /* Someone whose next pass is quiet cannot wait for the market's words: then the summary goes without them. */
    const canWait = due.every((entry) => !inQuietHours(startedAt + CRON_EVERY_MS, entry.quiet));
    const market = await marketSummary(deps, startedAt, pass, canWait);
    const outcomes = await mapLimited(due, deps.concurrency ?? CONCURRENCY, async (entry) => {
      if (market === null || deps.clock() - startedAt > PASS_BUDGET_MS) return "deferred" as const;
      try {
        return await briefFor(deps, entry.settings, entry.day, entry.quiet, market, pass);
      } catch (error) {
        /* The brief stays undone and the next pass takes it again; the line says what failed, never whose. */
        console.warn(`[assistant.brief] a brief failed and waits for the next pass: ${error instanceof Error ? error.message.slice(0, 160) : "unknown"}`);
        return "waiting" as const;
      }
    });
    for (const outcome of outcomes) {
      if (outcome === "delivered") delivered += 1;
      else if (outcome === "waiting") waiting += 1;
      else if (outcome === "deferred") deferred += 1;
    }
    for (const entry of due) await pruneBriefs(deps.store, entry.settings.owner, entry.day.day).catch(() => 0);
  }
  await pruneMarketSummaries(deps.store, startedAt).catch(() => 0);
  const run: BriefRun = { at: new Date(startedAt).toISOString(), subscribers: subscribers.length, due: due.length, delivered, waiting, personalCalls: pass.calls, marketCall: pass.marketCall, costMicroUsd: pass.cost, deferred };
  await writeRun(deps.store, run).catch(() => undefined);
  return run;
}

export type { BriefLocale };
