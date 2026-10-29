/**
 * The creator's notes (SOL-L2) — in the app's inbox and, where the wallet
 * connected it, in Telegram: the token launched, it reached a number of
 * holders, it moved to the DEX, its creator fees are there to take.
 *
 * A scheduled pass reads each launch from the chain — its creator fees as the
 * cabinet reads them, its holders from the mint's accounts — a few launches a
 * pass, where the last pass stopped. A note is written only on a change the
 * chain shows, and claimed once per launch and event (`launch:<event>:…`), so
 * a second pass never sends a second one:
 * - **launched** — once, only for a launch younger than two days (an older one
 *   was news before these notes existed);
 * - **holders** — when the people holding the token pass the next of 10, 25,
 *   50, 100, 250, 500, 1 000, 2 500, 5 000, 10 000; the first read only sets
 *   where the count stands;
 * - **graduated** — once, when the curve finished less than two days ago;
 * - **fees** — to each wallet with a part of the creator's fees, when what it
 *   can take reaches $1; again only after it took them (what waits fell under
 *   half of that);
 * - **quote** — once per change, when the launch's pair currency changed what
 *   its issuer can do to holders (SOL-L12, `./quote-watch.server.ts`): new
 *   launches on it wait, and the creator hears it from Ryntra first.
 *
 * The words stand on a lock screen: the token's symbol and what happened —
 * never an amount. Nothing here moves money or signs. A note's inbox row is
 * named by its event and written before its claim, so a pass that stopped
 * half-way writes the rest next time and never a second row.
 */

import { createHash } from "node:crypto";

import { creatorEarnings } from "../core/launch/creator-earnings.ts";
import type { CreatorFeesObservation } from "../core/venues/meteora-dbc/claim.server.ts";
import type { GuardStore } from "../guard/store.ts";
import { enqueue, inboxKeyOf } from "../monitoring/apply.ts";
import { claimTrigger, inboxOf, readPreferences, triggersOf, type InboxRecord } from "../monitoring/store.ts";
import { noteLocaleOf } from "../solana/limits/notes.server.ts";
import { launchPair } from "./config.server.ts";
import { creatorFeesOf } from "./creator.server.ts";
import type { LaunchRecord } from "./flow.server.ts";
import type { MarketDeps } from "./market.server.ts";
import { launchMarketReader } from "./trade-index.server.ts";

export type CreatorNoteEvent = "launched" | "holders" | "graduated" | "fees" | "quote";

export const HOLDER_MARKS = [10, 25, 50, 100, 250, 500, 1_000, 2_500, 5_000, 10_000] as const;
/** A launch or a graduation older than this was news before the notes: it gets none. */
export const FRESH_SECONDS = 2 * 24 * 60 * 60;
/** What waits to be taken before a note says so: $1 in a dollar pair. */
export const FEES_NOTE_UNITS = 1;
/** A delivery missed by a pass that stopped is written by the next one only this soon after its claim. */
const LATE_DELIVERY_MS = 30 * 60 * 1000;
/** Launches read in one pass, the young ones first and as many again of the rest in turn. */
const PASS_LAUNCHES = 8;
/** A launch this young is read in every pass: its launch, its first holders and a graduation are news now. */
const YOUNG_MS = 3 * 24 * 60 * 60 * 1000;

/** Where the notes of one launch stand. */
export type CreatorNotesState = Readonly<{
  cluster: string;
  token: string;
  /** The highest holder mark the notes have passed (or found already passed on the first read); null before the first read. */
  holdersMark: number | null;
  /** Per wallet: whether a fees note may be written — false after one was, until what waits falls under half the threshold. */
  feesArmed: Readonly<Record<string, boolean>>;
  /** How many fees notes each wallet got: the next one's claim. */
  feesNotes: Readonly<Record<string, number>>;
  updatedAt: string;
}>;

const STATE = "launchCreatorNotes";
const CURSOR = "launchCreatorNotesCursor";
const stateKey = (cluster: string, token: string) => `${cluster}:${token}`;

/** The highest mark a count has passed; 0 under the first. */
export function holderMark(count: number): number {
  let mark = 0;
  for (const value of HOLDER_MARKS) if (count >= value) mark = value;
  return mark;
}

type Words = Readonly<{ title: string; reason: string }>;
export type CreatorNoteWords = Readonly<{ en: Words; uk: Words; cta: Readonly<{ en: string; uk: string }> }>;

/** A symbol made safe for one line on a lock screen. */
function cleanSymbol(symbol: string): string {
  const clean = symbol.replace(/[^\p{L}\p{N}._-]/gu, "").slice(0, 12);
  return clean.length ? `$${clean}` : "—";
}

export function creatorNoteWords(event: CreatorNoteEvent, symbol: string, holders = 0, pairSymbol = ""): CreatorNoteWords {
  const token = cleanSymbol(symbol);
  const cta = { en: "My launches", uk: "Мої лаунчі" };
  const many = new Intl.NumberFormat("en-US").format(holders);
  const manyUk = new Intl.NumberFormat("uk-UA").format(holders);
  switch (event) {
    case "launched":
      return { en: { title: "Token launched", reason: `${token} is trading on its curve` }, uk: { title: "Токен запущено", reason: `${token} торгується на кривій` }, cta };
    case "holders":
      return { en: { title: `${many} holders`, reason: `${token} has ${many} holders` }, uk: { title: `${manyUk} власників`, reason: `У ${token} уже ${manyUk} власників` }, cta };
    case "graduated":
      return { en: { title: "Moved to the DEX", reason: `${token} left its curve for its pool` }, uk: { title: "Вийшов на DEX", reason: `${token} перейшов з кривої в пул` }, cta };
    case "fees":
      return { en: { title: "Fees to claim", reason: `Your fees from ${token} are ready to claim` }, uk: { title: "Комісії можна забрати", reason: `Твої комісії з ${token} чекають на «Забрати»` }, cta };
    case "quote": {
      /* The pair's own symbol, without the `$` a launched token carries. */
      const pair = cleanSymbol(pairSymbol).replace(/^\$/, "");
      return {
        en: { title: "Pair token changed", reason: `${pair}, the pair of ${token}, changed its rules` },
        uk: { title: "Змінився токен пари", reason: `${pair}, пара ${token}, змінив свої правила` },
        cta,
      };
    }
  }
}

/** The monitor id a launch's notes carry — the contract's `mon_` shape, from the wallet and the token; no monitor has it. */
export function creatorNoteMonitorId(owner: string, token: string): string {
  return `mon_${createHash("sha256").update(`launch-creator:${owner}:${token}`).digest("hex").slice(0, 24)}`;
}

/** Write one note: the claim, the inbox row, then its deliveries. Idempotent by the identity. */
export async function writeCreatorNote(
  store: GuardStore,
  args: Readonly<{ owner: string; record: Pick<LaunchRecord, "token" | "symbol">; event: CreatorNoteEvent; identity: string; holders?: number; pairSymbol?: string; nowMs: number }>,
): Promise<boolean> {
  const at = new Date(args.nowMs).toISOString();
  const locale = await noteLocaleOf(store, args.owner);
  const words = creatorNoteWords(args.event, args.record.symbol, args.holders, args.pairSymbol);
  /* The inbox row is named by the event: written first and once, so a pass that stopped after it writes the claim next time. */
  const inboxId = creatorNoteInboxId(args.identity);
  const note: InboxRecord = {
    id: inboxId,
    owner: args.owner,
    monitorId: creatorNoteMonitorId(args.owner, args.record.token),
    triggerId: args.identity,
    title: words[locale].title,
    reason: words[locale].reason,
    context: cleanSymbol(args.record.symbol),
    href: `/app/alerts/open?n=${inboxId}`,
    cta: words.cta[locale],
    paper: false,
    unread: true,
    createdAt: at,
    locale,
    subject: { kind: "launch-creator", id: args.record.token },
    text: { en: words.en, uk: words.uk },
  };
  await inboxOf(store).insertIfAbsent(inboxKeyOf(args.owner, inboxId), note);
  const claimed = await claimTrigger(store, args.identity, at);
  /*
   * The delivery is keyed by the event too: asked again shortly after a pass that stopped before it, it is written once.
   * A note claimed long ago is not sent late to a Telegram connected since.
   */
  const claimedAt = claimed ? args.nowMs : Date.parse((await triggersOf(store).get(args.identity))?.at ?? "");
  const prefs = await readPreferences(store, args.owner);
  if (prefs.telegram && args.nowMs - claimedAt < LATE_DELIVERY_MS) await enqueue(store, args.owner, args.identity, inboxId, "telegram", at);
  if (!claimed) return false;
  /* No push yet: the phone opens a creator's note only once its line reads the kind (request in the handoff). */
  return true;
}

/** The inbox id of a note, from its event's identity — the contract's `inb_` shape. */
export function creatorNoteInboxId(identity: string): string {
  return `inb_${createHash("sha256").update(identity).digest("hex").slice(0, 24)}`;
}

/** The wallets with a part of a launch's creator fees, and what each can take now. */
export function feeParts(observation: CreatorFeesObservation): readonly Readonly<{ wallet: string; unclaimedRaw: bigint }>[] {
  const wallets = observation.sharing ? observation.sharing.users.map((user) => user.address) : [observation.roleOwner];
  return wallets.map((wallet) => ({ wallet, unclaimedRaw: BigInt(creatorEarnings(observation.read, wallet).mine.unclaimedRaw) }));
}

export type CreatorNotesStep = Readonly<{ token: string; wrote: readonly CreatorNoteEvent[]; unread: readonly ("fees" | "holders")[] }>;

type PassDeps = MarketDeps & Readonly<{ readFees?: (record: LaunchRecord) => Promise<CreatorFeesObservation>; readHolders?: (record: LaunchRecord) => Promise<number | null> }>;

/** People holding the token now — the mint's accounts with a balance, less the curve's, the pool's and the lock's. */
async function holdersNow(deps: MarketDeps, record: LaunchRecord): Promise<number | null> {
  const reader = launchMarketReader(deps);
  const state = await reader.state({ token: record.token, pool: record.pool });
  const escrow = record.lock?.escrow ?? null;
  const read = await reader.holders({ token: record.token, state, wallets: [], escrow });
  if (read.totalHolders === null) return null;
  const notPeople = new Set([state.curve.baseVault, state.graduated?.tokenVault, escrow].filter((value): value is string => Boolean(value)));
  return Math.max(0, read.totalHolders - read.balances.filter((balance) => notPeople.has(balance.owner)).length);
}

/** One launch's notes: what the chain shows now, against where the notes stood. */
export async function noteLaunch(deps: PassDeps, record: LaunchRecord): Promise<CreatorNotesStep> {
  const store = deps.store;
  const nowMs = deps.now().getTime();
  const now = Math.floor(nowMs / 1000);
  const cluster = deps.network.cluster;
  const states = store.collection<CreatorNotesState>(STATE);
  const before = (await states.get(stateKey(cluster, record.token))) ?? { cluster, token: record.token, holdersMark: null, feesArmed: {}, feesNotes: {}, updatedAt: new Date(nowMs).toISOString() };
  const wrote: CreatorNoteEvent[] = [];
  const unread: ("fees" | "holders")[] = [];
  const base = `launch:${cluster}:${record.token}`;

  if (now - Math.floor(Date.parse(record.launchedAt) / 1000) < FRESH_SECONDS) {
    if (await writeCreatorNote(store, { owner: record.creator, record, event: "launched", identity: `${base}:launched`, nowMs })) wrote.push("launched");
  }

  let holdersMark = before.holdersMark;
  const holders = await (deps.readHolders ?? ((launch) => holdersNow(deps, launch)))(record).catch(() => null);
  if (holders === null) unread.push("holders");
  else {
    const mark = holderMark(holders);
    /* The first read sets where the count stands: a mark passed before the notes is not news. */
    if (holdersMark !== null && mark > holdersMark) {
      if (await writeCreatorNote(store, { owner: record.creator, record, event: "holders", identity: `${base}:holders:${mark}`, holders: mark, nowMs })) wrote.push("holders");
    }
    holdersMark = Math.max(holdersMark ?? 0, mark);
  }

  const feesArmed = { ...before.feesArmed };
  const feesNotes = { ...before.feesNotes };
  const observation = await (deps.readFees ?? ((launch) => creatorFeesOf(deps, launch)))(record).catch(() => null);
  if (!observation) unread.push("fees");
  else {
    if (observation.migrated && observation.graduatedAt !== null && now - observation.graduatedAt < FRESH_SECONDS) {
      if (await writeCreatorNote(store, { owner: record.creator, record, event: "graduated", identity: `${base}:graduated`, nowMs })) wrote.push("graduated");
    }
    const pair = launchPair(deps.network, record.preset, record.pairMint);
    /* A threshold only where the pair is a dollar: a community token's amount says nothing on its own. */
    if (pair.dollar) {
      const threshold = BigInt(FEES_NOTE_UNITS) * 10n ** BigInt(pair.decimals);
      for (const part of feeParts(observation)) {
        const armed = feesArmed[part.wallet] ?? true;
        if (armed && part.unclaimedRaw >= threshold) {
          const sequence = (feesNotes[part.wallet] ?? 0) + 1;
          if (await writeCreatorNote(store, { owner: part.wallet, record, event: "fees", identity: `${base}:fees:${part.wallet}:${sequence}`, nowMs })) wrote.push("fees");
          feesArmed[part.wallet] = false;
          feesNotes[part.wallet] = sequence;
        } else if (!armed && part.unclaimedRaw * 2n < threshold) feesArmed[part.wallet] = true;
      }
    }
  }

  await states.set(stateKey(cluster, record.token), { cluster, token: record.token, holdersMark, feesArmed, feesNotes, updatedAt: new Date(nowMs).toISOString() });
  return { token: record.token, wrote, unread };
}

/** One pass over the network's launches: a few, from where the last pass stopped, inside the budget. */
export async function runCreatorNotes(deps: PassDeps, options: Readonly<{ budgetMs: number; launches?: number }>): Promise<readonly CreatorNotesStep[]> {
  const started = Date.now();
  const cluster = deps.network.cluster;
  const records = (await deps.store.collection<LaunchRecord>("launches").valuesWithPrefix(`solana:${cluster}:`))
    .filter((record) => record.state === "LAUNCHED" && record.cluster === cluster)
    .sort((a, b) => a.token.localeCompare(b.token));
  if (!records.length) return [];
  const cursors = deps.store.collection<Readonly<{ cluster: string; next: string }>>(CURSOR);
  const steps: CreatorNotesStep[] = [];
  const count = Math.min(records.length, options.launches ?? PASS_LAUNCHES);
  const now = deps.now().getTime();
  const read = async (record: LaunchRecord) => steps.push(await noteLaunch(deps, record).catch(() => ({ token: record.token, wrote: [], unread: ["fees", "holders"] as ("fees" | "holders")[] })));
  /*
   * Two turns, each with its own cursor and half the pass: the launches young enough for «launched» and the first
   * holders, and the rest. Neither turn can starve the other, and a young launch past the first few still gets its turn
   * well inside its two days.
   */
  const turn = async (key: string, list: readonly LaunchRecord[], until: number) => {
    if (!list.length) return;
    const cursor = await cursors.get(key);
    let at = cursor ? list.findIndex((record) => record.token >= cursor.next) : 0;
    if (at < 0) at = 0;
    for (let step = 0; step < Math.min(list.length, count) && Date.now() - started < until; step += 1) {
      await read(list[(at + step) % list.length]!);
      await cursors.set(key, { cluster, next: list[(at + step + 1) % list.length]!.token });
    }
  };
  const young = records.filter((record) => now - Date.parse(record.launchedAt) < YOUNG_MS);
  const rest = records.filter((record) => !young.includes(record));
  await turn(`${cluster}:young`, young, rest.length ? options.budgetMs / 2 : options.budgetMs);
  await turn(cluster, rest, options.budgetMs);
  return steps;
}
