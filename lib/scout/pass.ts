/**
 * One pass of the Scout: mark what it holds on paper, read every new coin, screen them for free, read the chain for the
 * few that pass, ask the model for a thesis on the fewer that pass that, let the risk engine size what the thesis takes,
 * open it on paper and issue its plan — and journal every decision on the way, the refusals with their reasons.
 *
 * Each stage costs more than the one before and is bounded on its own: the chain reads per pass (`SCOUT_READS`), the model
 * calls per pass and per day (`SCOUT_THESIS`, the meter). A coin paid for within `REASK_MS` is not paid for again. A
 * source that does not answer leaves its stage out of the pass, said in the pass's stats; nothing is guessed in its place.
 *
 * Pure but for what it is handed (`PassDeps`): the tests hand in recorded answers.
 */

import { chainFactsOf, chainRefusals, type ChainInput } from "./chain.ts";
import { REASK_MS, riskStateOf, PLANS_KEPT, type PassStats, type ScoutDesk } from "./desk.ts";
import { candidatesOf, type ScoutCandidate } from "./feed.ts";
import { recordPass, type JournalEntry } from "./journal.ts";
import { markPosition, openPosition, resultOf, type PaperMark, type PaperPosition } from "./paper.ts";
import { planOf } from "./plan.ts";
import { riskSize, type ScoutBudget } from "./risk.ts";
import { SCOUT_JOURNAL, SCOUT_READS, SCOUT_THESIS } from "./rules.ts";
import { screenFiguresOf, screenOf, type ScreenFigures } from "./screen.ts";
import { thesisFacts, type ScoutThesis, type ThesisWriter } from "./thesis.ts";

/** The day's model calls, shared by every instance: one taken, or why not. `give` returns it when the call never reached the model. */
export interface ThesisMeter {
  take(nowMs: number): Promise<Readonly<{ ok: true; give: () => Promise<void> }> | Readonly<{ ok: false; reason: "limit" | "down" }>>;
}

export type PassDeps = Readonly<{
  now: number;
  /** The feed's lists, as Jupiter answered them; null — the feed did not answer. */
  lists(): Promise<readonly (readonly unknown[])[] | null>;
  /** The chain's facts of one coin: the gateway's reading, the coin's trades and, where the gateway gave no holders, the coin page's; null — the reads are off or failed. */
  chain(candidate: ScoutCandidate): Promise<Omit<ChainInput, "candidate"> | null>;
  /** The chain reads left today, shared by every instance. */
  chainBudget(): Promise<number>;
  writer: ThesisWriter | null;
  meter: ThesisMeter | null;
  /** The price and the volumes of the coins held; a coin missing from the map was not read. */
  marks(mints: readonly string[]): Promise<ReadonlyMap<string, Omit<PaperMark, "at" | "solUsd">> | null>;
  solUsd: number | null;
  /** Ryntra's fee on a trade, basis points. */
  feeBps: number;
  budget: ScoutBudget;
}>;

export type PassResult = Readonly<{ desk: ScoutDesk; news: readonly JournalEntry[]; stats: PassStats }>;

const short = (candidate: ScoutCandidate) => ({ mint: candidate.mint, symbol: candidate.symbol });

function thesisCodes(thesis: ScoutThesis): string[] {
  return thesis.verdict === "skip" ? [...thesis.against, ...thesis.for] : [...thesis.for, ...thesis.against];
}

export async function scoutPass(desk: ScoutDesk, deps: PassDeps): Promise<PassResult> {
  const now = deps.now;
  const entries: JournalEntry[] = [];
  const missing = new Set<PassStats["missing"][number]>();

  /* 1 — what is held: each open position marked, its exits taken. */
  let open: PaperPosition[] = [...desk.open];
  let closed: PaperPosition[] = [...desk.closed];
  let closedNow = 0;
  if (open.length) {
    const read = await deps.marks(open.map((position) => position.mint)).catch(() => null);
    if (!read || deps.solUsd === null) missing.add("prices");
    const still: PaperPosition[] = [];
    for (const position of open) {
      const figures = read?.get(position.mint);
      const mark: PaperMark = { at: now, price: figures?.price ?? null, volumeH1Usd: figures?.volumeH1Usd ?? null, volumeH6Usd: figures?.volumeH6Usd ?? null, solUsd: deps.solUsd };
      const next = markPosition(position, mark);
      const newSales = next.sales.slice(position.sales.length);
      for (const sale of newSales) {
        const done = next.closedAt !== null && sale === next.sales.at(-1);
        entries.push({
          at: now,
          mint: next.mint,
          symbol: next.symbol,
          stage: "paper",
          outcome: done ? "closed" : "half",
          codes: [sale.reason],
          lamports: sale.receivedLamports,
          ...(done ? { resultPct: resultOf(next).resultPct } : {}),
        });
      }
      if (next.closedAt !== null) {
        closed.unshift(next);
        closedNow += 1;
      } else still.push(next);
    }
    open = still;
    closed = closed.slice(0, SCOUT_JOURNAL.closedKept);
  }

  /* 2 — the feed. */
  const lists = await deps.lists().catch(() => null);
  if (!lists) missing.add("feed");
  const candidates = lists ? candidatesOf(lists) : [];

  /* 3 — the free screen. A coin the Scout holds is the desk's: its line is the position, not a screen it no longer needs. */
  const held = new Set(open.map((position) => position.mint));
  const passing: ScoutCandidate[] = [];
  for (const candidate of candidates) {
    if (held.has(candidate.mint)) continue;
    const codes = screenOf(candidate, now);
    if (codes.length) entries.push({ at: now, ...short(candidate), stage: "screen", outcome: "refused", codes, figures: screenFiguresOf(candidate, now) });
    else passing.push(candidate);
  }
  passing.sort((a, b) => (b.windows.h1.volumeUsd ?? 0) - (a.windows.h1.volumeUsd ?? 0) || a.mint.localeCompare(b.mint));

  /* A coin paid for a moment ago waits: its last decision stands. */
  const paid: Record<string, number> = {};
  for (const [mint, at] of Object.entries(desk.paid)) if (now - at < 6 * 60 * 60_000) paid[mint] = at;
  const fresh = passing.filter((candidate) => !(now - (paid[candidate.mint] ?? Number.NEGATIVE_INFINITY) < REASK_MS));

  /* 4 — the chain, for the few, read together: a pass stays well inside its minute. */
  const chainLeft = await deps.chainBudget().catch(() => 0);
  const toRead = fresh.slice(0, Math.max(0, Math.min(SCOUT_READS.perPass, chainLeft)));
  if (fresh.length && !toRead.length) missing.add("chain");
  const reads = await Promise.all(toRead.map((candidate) => deps.chain(candidate).catch(() => null)));
  const survivors: { candidate: ScoutCandidate; input: ChainInput }[] = [];
  toRead.forEach((candidate, index) => {
    const read = reads[index] ?? null;
    paid[candidate.mint] = now;
    const input: ChainInput = { candidate, risk: read?.risk ?? null, trades: read?.trades ?? null, holders: read?.holders ?? null };
    if (!read) missing.add("chain");
    const codes = chainRefusals(chainFactsOf(input));
    if (codes.length) entries.push({ at: now, ...short(candidate), stage: "chain", outcome: "refused", codes, figures: screenFiguresOf(candidate, now) });
    else survivors.push({ candidate, input });
  });
  const chained = toRead.length;

  /* 5 — the thesis, for the fewer: each call counted first, the calls made together. */
  type Asked = Readonly<{ candidate: ScoutCandidate; figures: ScreenFigures; thesis: ScoutThesis | null; code: string | null }>;
  const writer = deps.writer;
  const meter = deps.meter;
  let asked = 0;
  const theses: Asked[] = await Promise.all(
    survivors.slice(0, SCOUT_THESIS.perPass).map(async ({ candidate, input }): Promise<Asked> => {
      const figures = screenFiguresOf(candidate, now);
      if (!writer || !meter) return { candidate, figures, thesis: null, code: "thesis_off" };
      const taken = await meter.take(now).catch(() => ({ ok: false, reason: "down" }) as const);
      if (!taken.ok) return { candidate, figures, thesis: null, code: taken.reason === "limit" ? "thesis_day_limit" : "thesis_off" };
      asked += 1;
      try {
        const thesis = await writer.write(thesisFacts(candidate, figures, chainFactsOf(input)));
        return { candidate, figures, thesis, code: thesis ? null : "thesis_unread" };
      } catch (error) {
        /* An error status means nothing was made: the call goes back. A timeout stays counted. */
        if (typeof (error as { status?: unknown } | null)?.status === "number") await taken.give().catch(() => undefined);
        return { candidate, figures, thesis: null, code: "thesis_failed" };
      }
    }),
  );

  /* 6 — the risk engine and the paper buy for what the thesis takes, one after another: each buy counts for the next. */
  let took = 0;
  const plans = [...desk.plans];
  for (const { candidate, figures, thesis, code } of theses) {
    if (!thesis) {
      if (code !== "thesis_unread") missing.add("model");
      entries.push({ at: now, ...short(candidate), stage: "thesis", outcome: "watch", codes: [code ?? "thesis_unread"], figures });
      continue;
    }
    if (thesis.verdict !== "take") {
      entries.push({ at: now, ...short(candidate), stage: "thesis", outcome: thesis.verdict, codes: thesisCodes(thesis), figures, thesis });
      continue;
    }
    const sized = riskSize(deps.budget, riskStateOf({ open, closed }, now), { mint: candidate.mint, liquidityUsd: candidate.liquidityUsd, solUsd: deps.solUsd, now });
    if (!sized.ok) {
      entries.push({ at: now, ...short(candidate), stage: "risk", outcome: "refused", codes: [sized.code], figures, thesis });
      continue;
    }
    if (candidate.price === null || !(candidate.price > 0) || deps.solUsd === null || candidate.liquidityUsd === null) {
      entries.push({ at: now, ...short(candidate), stage: "risk", outcome: "refused", codes: ["price_unread"], figures, thesis });
      continue;
    }
    const position = openPosition({
      mint: candidate.mint,
      symbol: candidate.symbol,
      icon: candidate.icon,
      at: now,
      price: candidate.price,
      solUsd: deps.solUsd,
      lamports: sized.lamports,
      liquidityUsd: candidate.liquidityUsd,
      feeBps: deps.feeBps,
      why: thesis.for,
      shape: thesis.shape,
      invalidation: thesis.invalidation,
    });
    open = [...open, position];
    took += 1;
    plans.unshift(planOf({ candidate, lamports: sized.lamports, bound: sized.bound, thesis, now }));
    entries.push({ at: now, ...short(candidate), stage: "paper", outcome: "took", codes: [...thesis.for], figures, thesis, lamports: sized.lamports.toString() });
  }

  const { checks, news } = recordPass(desk.checks, entries, now);
  const stats: PassStats = { at: now, seen: candidates.length, screened: passing.length, chained, asked, took, closed: closedNow, missing: [...missing] };
  return {
    desk: { ...desk, version: desk.version + 1, open, closed, plans: plans.slice(0, PLANS_KEPT), checks, paid, pass: stats },
    news,
    stats,
  };
}
