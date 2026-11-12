import { randomBytes } from "node:crypto";

import type { AttemptResponse, FeedResponse, Guards, Limits, PublicEntry, VaultState, VaultView } from "./contract";
import { exposure, named, publicCopy } from "./detect";
import { feedTag, networkOf, whoKey, type Who } from "./identity";
import { guardOf, TITLE, VAULT_IDS, VAULTS, type VaultId } from "./levels";
import { ModelFailure, type ModelGateway } from "./model";
import { isPhrase, phraseOf } from "./phrase";
import { GUARD_TIMEOUT_MS, MAX_REPLY_CHARS, guardCall } from "./rules";
import { screen, tidy, type EncodingKind } from "./screen";
import { crackedOn, dayStart, fits, type Caps, type FeedEntry, type Pool, type Progress, type VaultStore, type Window } from "./store";
import type { VaultWorldEvent } from "./world";

/**
 * The guard's engine: one attempt from the text a person typed to the feed everyone reads, with no HTTP in it.
 *
 *   1. The vault must be open to the person: the level before it cracked.
 *   2. The text is screened: empty or over 280 characters is refused and not counted; encoded text counts and is never
 *      sent.
 *   3. Limits: 3 attempts a minute and 25 a day for each guest or wallet, and a wider limit per address (an IPv6
 *      address by its /64) so a cleared cookie is not a fresh day.
 *   4. The phrase itself, typed, cracks the vault; the guard is not asked.
 *   5. Anything else is a new conversation with the guard — its rules and this one message, no tools. A guard that
 *      does not answer in time costs the person nothing: the attempt is given back.
 *      Before the call its worst case is set aside against the day's dollar ceiling (guests together may use 70 % of
 *      it, so a person signed in with a wallet always finds a guard awake); after it, the real cost is booked. When the
 *      day's ceiling is reached the guards rest until midnight UTC — the door still opens to the phrase, the attempt
 *      is given back — and after a failure that will not pass by itself (no key, no credits) they rest ten minutes.
 *   6. The detector reads the reply: the person sees it as it is (from level 3 masked), the feed sees it masked, and
 *      the attempt itself joins the feed ten minutes later, masked. Masked means every word of the dictionary, not only
 *      the phrase's, so nothing public tells the phrase's words from the rest; and the pressure counts only the
 *      phrase's words the visitor did not bring (`detect.ts`).
 */

export const PERSON_LIMITS: readonly Window[] = [
  { name: "minute", ms: 60_000, limit: 3 },
  { name: "day", ms: 86_400_000, limit: 25 },
];
/** One address can be a household or an office: wider than one person, narrow enough that new cookies buy little. */
export const ADDRESS_LIMITS: readonly Window[] = [
  { name: "minute", ms: 60_000, limit: 12 },
  { name: "day", ms: 86_400_000, limit: 120 },
];
/** The attempt joins the public feed this long after it was made; the guard's reply and the pressure show at once. */
export const ATTEMPT_DELAY_MS = 10 * 60_000;
export const FEED_PAGE = 20;
/** The daily vault's days kept on a person's progress. */
const DAILY_DAYS_KEPT = 31;
/** What guests together may use of the day's ceiling; the rest is kept for people signed in with a wallet. */
export const GUEST_SHARE = 0.7;
/** How long the guards rest after a failure that will not pass by itself (no key, no credits, no model). */
export const REST_MS = 10 * 60_000;
/** What one call is taken to cost before any was priced, to say whether the guards are awake. */
export const NOMINAL_CALL_MICRO_USD = 2_500;
const DAY_MS = 86_400_000;

export type AttemptInput = { who: Who; address: string; vault: VaultId; text: string };

export type AttemptRefusal =
  | { ok: false; code: "LOCKED" | "EMPTY" | "TOO_LONG" | "GUARD_SILENT" }
  | { ok: false; code: "RATE_LIMITED"; window: Window["name"]; retryAfterS: number }
  /** The guards rest: the day's ceiling is reached, or the model needs a person. Nothing was counted. */
  | { ok: false; code: "RESTING"; guards: Guards; retryAfterS: number };

export type AttemptResult = { ok: true; response: AttemptResponse; event: VaultWorldEvent | null } | AttemptRefusal;

export type EngineDeps = {
  model: ModelGateway;
  store: VaultStore;
  /** The server's signing secret: phrases and feed tags are made from it. */
  secret: string;
  /**
   * The day's ceiling on what the guards' model may spend, in millionths of a dollar. None only where the model costs
   * nothing to anyone (tests); a deployment does not open without one (`ready.ts`).
   */
  ceilingMicroUsd?: number | null;
  now?: () => number;
  /** Random ids: feed entries, fence marks, trace ids. */
  newId?: () => string;
};

export const dayOf = (now: number) => new Date(now).toISOString().slice(0, 10);

/** Whose share of the day's ceiling a person's calls come from. */
export const poolOf = (who: Who | null): Pool => (who?.kind === "wallet" ? "wallet" : "guest");

/** The day's ceiling, shared: everything, and the guests' part of it. */
export const capsOf = (ceiling: number): Caps => ({ total: ceiling, guest: Math.floor(ceiling * GUEST_SHARE) });

const openTo = (progress: Progress, vault: VaultId) => {
  const after = VAULTS[vault].after;
  return !after || !!progress.cracked[after];
};

/** A reply as a person may see it: tidied, never longer than the vault allows. */
function cut(text: string): string {
  const tidied = tidy(text).replace(/\s*\n\s*/g, " ");
  const chars = [...tidied];
  return chars.length > MAX_REPLY_CHARS ? `${chars.slice(0, MAX_REPLY_CHARS - 1).join("").trimEnd()}…` : tidied || "…";
}

/** A feed entry as anyone may read it: the attempt only once it is ten minutes old. */
export function publicEntry(entry: FeedEntry, now: number): PublicEntry {
  return { ...entry, attempt: now - Date.parse(entry.at) >= ATTEMPT_DELAY_MS ? entry.attempt : null };
}

export type VaultEngine = ReturnType<typeof createVaultEngine>;

export function createVaultEngine(deps: EngineDeps) {
  const now = deps.now ?? Date.now;
  const newId = deps.newId ?? (() => randomBytes(9).toString("base64url"));

  const phrase = (vault: VaultId, day: string) => phraseOf(deps.secret, vault, day, VAULTS[vault].words);
  const ceiling = deps.ceilingMicroUsd ?? null;
  /** Until when the guards rest after a lasting failure (this instance's own knowledge; ms). */
  let restUntil = 0;
  /** The last worst case priced: what the next call is taken to cost. */
  let lastWorst = NOMINAL_CALL_MICRO_USD;

  const awake: Guards = { awake: true, wakesAt: null, walletsAwake: true };

  /** Whether the guards answer this person now, and if not, until when they rest. */
  async function guards(who: Who | null, at: number): Promise<Guards> {
    if (restUntil > at) return { awake: false, wakesAt: new Date(restUntil).toISOString(), walletsAwake: false };
    if (ceiling === null) return awake;
    const spent = await deps.store.spent(dayOf(at));
    const caps = capsOf(ceiling);
    if (fits(spent, poolOf(who), lastWorst, caps)) return awake;
    return { awake: false, wakesAt: new Date(dayStart(at) + DAY_MS).toISOString(), walletsAwake: fits(spent, "wallet", lastWorst, caps) };
  }

  const secondsTo = (iso: string | null, at: number) => (iso ? Math.max(1, Math.ceil((Date.parse(iso) - at) / 1000)) : 60);

  async function limits(who: Who | null, at: number): Promise<Limits> {
    if (!who) return { minute: { left: PERSON_LIMITS[0]!.limit, resetS: 0 }, day: { left: PERSON_LIMITS[1]!.limit, resetS: 0 } };
    return deps.store.left(whoKey(who), PERSON_LIMITS, at);
  }

  function views(progress: Progress, day: string): VaultView[] {
    return VAULT_IDS.map((id) => {
      const def = VAULTS[id];
      const guard = guardOf(id, day);
      return { id, kind: def.kind, level: def.level, words: def.words, points: def.points, guard: { name: guard.name, line: guard.line }, open: openTo(progress, id), cracked: crackedOn(progress, id, day) };
    });
  }

  /** The vaults as one person sees them today: which are open, which they cracked, and what is left of their limits. */
  async function state(who: Who | null): Promise<VaultState> {
    const at = now();
    const day = dayOf(at);
    const progress = who ? await deps.store.progress(whoKey(who)) : { cracked: {}, dailyDays: [], points: 0, title: null };
    return {
      day,
      resetsAt: new Date(dayStart(at) + DAY_MS).toISOString(),
      vaults: views(progress, day),
      me: { points: progress.points, title: progress.title, limits: await limits(who, at) },
      guards: await guards(who, at),
    };
  }

  async function attempt(input: AttemptInput): Promise<AttemptResult> {
    const at = now();
    const day = dayOf(at);
    const def = VAULTS[input.vault];
    const key = whoKey(input.who);
    let progress = await deps.store.progress(key);
    if (!openTo(progress, input.vault)) return { ok: false, code: "LOCKED" };

    const screened = screen(input.text);
    if (!screened.ok && screened.reason === "empty") return { ok: false, code: "EMPTY" };
    if (!screened.ok && screened.reason === "too_long") return { ok: false, code: "TOO_LONG" };

    const person = await deps.store.take(key, PERSON_LIMITS, at);
    if (!person.ok) return { ok: false, code: "RATE_LIMITED", window: person.window, retryAfterS: person.retryAfterS };
    const network = `ip:${networkOf(input.address)}`;
    const address = await deps.store.take(network, ADDRESS_LIMITS, at);
    if (!address.ok) {
      await deps.store.giveBack(key, person.ticket);
      return { ok: false, code: "RATE_LIMITED", window: address.window, retryAfterS: address.retryAfterS };
    }

    const words = phrase(input.vault, day);
    const text = screened.ok ? screened.text : tidy(input.text);
    let outcome: AttemptResponse["outcome"];
    let reply: string | null = null;
    let shown: string | null = null;
    let pressure = 0;
    let encoding: EncodingKind | null = null;
    let earned: { points: number; event: VaultWorldEvent } | null = null;

    if (!screened.ok) {
      outcome = "screened";
      encoding = screened.reason === "encoded" ? screened.kind : null;
    } else if (isPhrase(text, words)) {
      outcome = "cracked";
      // The store records the crack on the progress as it is now, in one step: two cracks at once pay once.
      const done = await deps.store.crack(key, { vault: input.vault, day, points: def.points, title: input.vault === "practice-3" ? TITLE : null, keepDays: DAILY_DAYS_KEPT }, at);
      progress = done.progress;
      if (done.recorded) {
        earned = {
          points: def.points,
          event: { kind: "vault_crack", vault: input.vault, day, points: def.points, title: done.title, idempotencyKey: `vault:${input.vault}:${input.vault === "daily" ? day : "once"}`, at: new Date(at).toISOString() },
        };
      }
    } else {
      const giveBack = async () => {
        await deps.store.giveBack(key, person.ticket);
        await deps.store.giveBack(network, address.ticket);
      };
      const resting = async (): Promise<AttemptRefusal> => {
        await giveBack();
        const now = await guards(input.who, at);
        return { ok: false, code: "RESTING", guards: now, retryAfterS: secondsTo(now.wakesAt, at) };
      };
      if (restUntil > at) return resting();

      const pool = poolOf(input.who);
      const call = guardCall({ vault: input.vault, guard: guardOf(input.vault, day), strictness: def.strictness, words, text, mark: newId(), traceId: newId() });
      // What is set aside for this call against the day's ceiling, and booked once it is known.
      let reserved = 0;
      // Awaited, so a serverless instance never freezes before the day's book is right; a failure here keeps the worst
      // case set aside, never less, and does not fail the attempt.
      const book = async (cost: number) => {
        if (ceiling === null || cost === reserved) return;
        const settled = await deps.store.settle(day, pool, cost - reserved, capsOf(ceiling)).catch((error: unknown) => {
          console.error("[vault] spend not booked", errorLine(error));
          return null;
        });
        // The day stays at its ceiling: what a call cost past it is said here, and the guards rest until midnight.
        if (settled && settled.over > 0) console.error("[vault] a call cost past the day's ceiling", `${settled.over} micro-USD not booked`, pool);
      };
      let said: string;
      try {
        if (ceiling !== null && deps.model.worstCase) {
          reserved = Math.max(0, Math.ceil(await deps.model.worstCase(call)));
          lastWorst = Math.max(reserved, 1);
          const room = await deps.store.reserve(day, pool, reserved, capsOf(ceiling));
          if (!room.ok) {
            reserved = 0;
            return resting();
          }
        }
        const answer = await withTimeout(deps.model.call(call), GUARD_TIMEOUT_MS + 1_000);
        await book(answer.costMicroUsd ?? reserved);
        said = answer.text;
      } catch (error) {
        if (error instanceof ModelFailure) {
          // A known cost is booked; a timeout may still be billed, so its worst case stays; a call refused before it
          // reached the model cost nothing.
          await book(error.costMicroUsd ?? (error.reason === "timeout" ? reserved : 0));
          if (error.lasting) {
            console.error("[vault] the guards rest", errorLine(error));
            restUntil = at + REST_MS;
            return resting();
          }
        } else {
          await book(reserved);
          console.error("[vault] guard call failed", errorLine(error));
        }
        await giveBack();
        return { ok: false, code: "GUARD_SILENT" };
      }
      reply = cut(said);
      // Words the visitor brought do not count: a guard that repeats them gives nothing away.
      pressure = exposure(reply, words, named(text, words)).pressure;
      shown = publicCopy(reply);
      outcome = pressure === 0 ? "held" : def.gate ? "caught" : "leaked";
      // From level 3 the person who asked reads the masked copy too, whatever the guard said.
      if (def.gate) reply = shown;
    }

    const entry: FeedEntry = {
      id: newId(),
      vault: input.vault,
      at: new Date(at).toISOString(),
      who: feedTag(input.who, day, deps.secret),
      outcome,
      reply: shown,
      pressure,
      attempt: publicCopy(text),
    };
    await deps.store.push(entry);

    return {
      ok: true,
      event: earned?.event ?? null,
      response: {
        outcome,
        reply,
        pressure,
        encoding,
        award: earned ? { points: earned.points, title: earned.event.title } : null,
        entry: publicEntry(entry, at),
        state: {
          day,
          resetsAt: new Date(dayStart(at) + DAY_MS).toISOString(),
          vaults: views(progress, day),
          me: { points: progress.points, title: progress.title, limits: await limits(input.who, at) },
          guards: await guards(input.who, at),
        },
      },
    };
  }

  /** A vault's public feed, newest first, a page at a time. */
  async function feed(vault: VaultId, before: string | null): Promise<FeedResponse> {
    const at = now();
    const entries = await deps.store.feed(vault, FEED_PAGE + 1, before);
    const page = entries.slice(0, FEED_PAGE).map((e) => publicEntry(e, at));
    return { vault, entries: page, next: entries.length > FEED_PAGE ? page[page.length - 1]!.id : null };
  }

  /**
   * A guest who signs in with a wallet keeps what they cracked: the guest's progress leaves the books once and each of
   * its cracks is recorded on the wallet's account, paying only what the account has not cracked yet (today's daily
   * vault, every practice level ever). True when there was something to hand over.
   */
  async function adopt(guest: Who, wallet: Who): Promise<boolean> {
    if (guest.kind !== "guest" || wallet.kind !== "wallet") return false;
    // The wallet's cracks first — each is recorded once, however often this runs — then the guest's row leaves the
    // books: a failure between the two steps loses nothing, and a second sign-in finds nothing more to hand over.
    const held = await deps.store.progress(whoKey(guest));
    const at = now();
    for (const id of VAULT_IDS) {
      const day = held.cracked[id];
      if (!day || (id === "daily" && day !== dayOf(at))) continue;
      await deps.store.crack(whoKey(wallet), { vault: id, day, points: VAULTS[id].points, title: id === "practice-3" ? TITLE : null, keepDays: DAILY_DAYS_KEPT }, at);
    }
    return (await deps.store.release(whoKey(guest))) !== null;
  }

  return { attempt, state, feed, phrase, adopt };
}

/**
 * An error as one log line: its name and message, cut short, with every word of the dictionary masked — a gateway's
 * error can carry the request, and the request carries the guard's rules with the phrase in them.
 */
export function errorLine(error: unknown): string {
  if (!(error instanceof Error)) return typeof error;
  return publicCopy(`${error.name}: ${error.message}`.slice(0, 300));
}

/** A promise that gives up after a time, as a model failure. */
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new ModelFailure("timeout")), ms);
  });
  return Promise.race([promise, late]).finally(() => clearTimeout(timer));
}
