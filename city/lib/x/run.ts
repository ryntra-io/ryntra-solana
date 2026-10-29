import { outgoing } from '../moments/drafts/sender.ts';
import type { Draft, DraftStore } from '../moments/drafts/store.ts';
import type { XConfig } from './config.ts';
import { isFresh } from './facts.ts';
import { LIVE, NEAR_HOURS, mediaHash, shapeHash, textHash, type XLedger } from './ledger.ts';
import { hasLink, postCost, sumUsd } from './pricing.ts';
import { dueSlot } from './schedule.ts';
import type { XPublisher } from './sender.ts';

/**
 * One pass of the publisher, what the cron runs every 10 minutes. At most one post per pass and one per slot:
 *
 *   1. the sender is connected, the queue's switch is on and a slot's window is open, not yet taken;
 *   2. the oldest approved draft is claimed (`approved` → `sending`, atomic in the queue); a studio draft whose facts
 *      are no longer fresh for their template (`facts.ts`, `isFresh`) is `failed` as stale instead, never posted;
 *   3. the slot is taken in the ledger with the hashes of the words, their shape and the clip — a repeat of a live
 *      post, or a post of the same shape as one in the last 20 hours, is refused there and the draft is `failed` as a
 *      duplicate; a slot another pass took puts the draft back in line;
 *   4. the day's spend plus this post stays within `RYNTRA_X_DAILY_USD`, or nothing is claimed;
 *   5. the clip goes up and the post goes out; the draft becomes `sent` or `failed` with X's reason, and the ledger
 *      says the same. A post that may have gone out (a lost answer) is `failed` in the queue and `unsure` in the
 *      ledger: never sent again, and counted in the day's spend.
 */

export type RunDeps = {
  store: DraftStore;
  ledger: XLedger;
  sender: XPublisher;
  config: Pick<XConfig, 'slots' | 'dailyUsd'>;
  now?: () => Date;
};

export type RunState = 'not_connected' | 'switch_off' | 'no_slot' | 'slot_done' | 'empty' | 'over_budget' | 'sent' | 'failed' | 'unsure';

export type RunOutcome = {
  state: RunState;
  slot: string | null;
  draftId: string | null;
  postId: string | null;
  error: string | null;
  /** Drafts this pass took out of line as duplicates (the same words, clip or shape as a live post). */
  duplicates: { draftId: string; of: string | null }[];
  /** Studio drafts this pass took out of line because their facts are no longer fresh. */
  stale: string[];
};

/** Drafts tried in one pass before it gives up (each refused one is a duplicate or stale, now `failed`). */
const TRIES = 5;

export async function runSlot(deps: RunDeps): Promise<RunOutcome> {
  const now = deps.now ?? (() => new Date());
  const { store, ledger, sender, config } = deps;
  const at = now();
  const duplicates: RunOutcome['duplicates'] = [];
  const stale: string[] = [];
  const out = (state: RunState, rest: Partial<RunOutcome> = {}): RunOutcome => ({ state, slot: null, draftId: null, postId: null, error: null, duplicates, stale, ...rest });

  if (!sender.connected) return out('not_connected', { error: sender.reason });
  if (!(await store.switch()).on) return out('switch_off');
  const slot = dueSlot(at, config.slots);
  if (!slot) return out('no_slot');
  const today = await ledger.day(slot.day);
  if (today.some((r) => r.slot === slot.key)) return out('slot_done', { slot: slot.key });
  const spent = sumUsd(today.filter((r) => LIVE.includes(r.status)).map((r) => r.costUsd));

  const line = (await store.list({ status: 'approved', limit: 50 })).reverse();
  for (const candidate of line.slice(0, TRIES)) {
    // «In the last hour», read yesterday, is not news: a studio post goes out only while its facts are fresh.
    const facts = candidate.kind === 'studio' ? candidate.moment?.studio : undefined;
    if (candidate.kind === 'studio' && (!facts || !isFresh(facts, at))) {
      const held = await store.claim({ id: candidate.id, now: now() });
      if (held) {
        const read = facts ? (facts.template === 'launch' ? facts.graduatedAt : facts.readAt) : 'unknown';
        await store.delivered({ id: held.id, delivery: { status: 'failed', note: `stale: its facts (${facts?.template ?? 'none'}, read ${read}) are too old to post` }, now: now() });
        stale.push(held.id);
      }
      continue;
    }
    const cost = postCost(candidate.text);
    if (sumUsd([spent, cost]) > config.dailyUsd) return out('over_budget', { slot: slot.key, draftId: candidate.id, error: `$${spent} spent of $${config.dailyUsd}; this post is $${cost}` });

    const claimed = await store.claim({ id: candidate.id, now: now() });
    if (!claimed) continue; // another pass holds it, or the switch went off
    let media: Awaited<ReturnType<DraftStore['media']>>;
    let reserved: Awaited<ReturnType<XLedger['reserve']>>;
    try {
      media = await store.media(claimed.id);
      reserved = await ledger.reserve({
        slot: slot.key, day: slot.day, draftId: claimed.id, textHash: textHash(claimed.text), shapeHash: shapeHash(claimed.text), mediaHash: mediaHash(media?.bytes ?? null),
        link: hasLink(claimed.text), costUsd: cost, now: now(),
      });
    } catch (e) {
      // Nothing was sent: the draft goes back in line for the next pass.
      await store.delivered({ id: claimed.id, delivery: { status: 'approved', note: 'ledger unavailable; back in line' }, now: now() }).catch(() => null);
      throw e;
    }
    if (!reserved.ok) {
      if (reserved.conflict === 'slot') {
        await store.delivered({ id: claimed.id, delivery: { status: 'approved', note: 'slot taken by another pass; back in line' }, now: now() });
        return out('slot_done', { slot: slot.key });
      }
      const what = reserved.conflict === 'text' ? 'words' : reserved.conflict === 'media' ? 'clip' : `words but for numbers and links, within ${NEAR_HOURS} h,`;
      const note = `duplicate: the same ${what} as draft ${reserved.draftId ?? '?'}, not posted`;
      await store.delivered({ id: claimed.id, delivery: { status: 'failed', note }, now: now() });
      duplicates.push({ draftId: claimed.id, of: reserved.draftId });
      continue;
    }
    return send(claimed, media, slot.key);
  }
  return out('empty', { slot: slot.key });

  async function send(draft: Draft, media: Awaited<ReturnType<DraftStore['media']>>, key: string): Promise<RunOutcome> {
    let result: Awaited<ReturnType<XPublisher['publish']>>;
    try {
      result = await sender.publish(outgoing(draft, media));
    } catch (e) {
      result = { ok: false, error: `x-sender: ${e instanceof Error ? e.message : String(e)}`, unsure: true };
    }
    // Both records are written even if one of them fails; neither failure can make the draft go out again (it stays
    // `sending` in the queue, and the slot and hashes stay taken in the ledger).
    if (result.ok) {
      await Promise.allSettled([
        ledger.finish({ slot: key, status: 'sent', postId: result.postId, error: null, now: now() }),
        store.delivered({ id: draft.id, delivery: { status: 'sent', note: `posted ${result.postId}` }, now: now() }),
      ]);
      return out('sent', { slot: key, draftId: draft.id, postId: result.postId });
    }
    const status = result.unsure ? 'unsure' : 'failed';
    await Promise.allSettled([
      ledger.finish({ slot: key, status, postId: null, error: result.error, now: now() }),
      store.delivered({ id: draft.id, delivery: { status: 'failed', note: result.unsure ? `may have posted: ${result.error}` : result.error }, now: now() }),
    ]);
    return out(status, { slot: key, draftId: draft.id, error: result.error });
  }
}
