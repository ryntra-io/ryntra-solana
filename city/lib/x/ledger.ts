import { createHash } from 'node:crypto';

/**
 * The publisher's ledger: one row per post it set out to make. It is what keeps the city from posting twice:
 *
 *   * a slot (`2026-10-27 18:00`) is taken once, whatever the post's fate — two crons in the same window make one post;
 *   * the words and the clip are kept as hashes, and while a post with the same words or the same clip is being sent,
 *     was sent or may have been sent, another one is refused;
 *   * so is the words' shape — the words once numbers and links are taken out (`textShape`): a post of the same shape
 *     as a live one started in the last 20 hours is refused, so a template never goes out twice in a day with only
 *     its figures changed (X's rules: no near-duplicate posts);
 *   * what each post cost, so a day never goes over its budget and the day's report adds up.
 *
 * In the database the slot, words and clip rules are unique indexes (`supabase/migrations/20261027180000_city_x_posts_v1.sql`),
 * so the refusal is atomic; the shape is checked in the same function before the insert (two passes at once are in the
 * same slot, which the slot's index settles). In memory one synchronous step does the same.
 */

export type XPostStatus = 'sending' | 'sent' | 'failed' | 'unsure';
export const X_POST_STATUSES: readonly XPostStatus[] = ['sending', 'sent', 'failed', 'unsure'];
/** Rows whose words and clip a new post may not repeat; their cost counts against the day. */
export const LIVE: readonly XPostStatus[] = ['sending', 'sent', 'unsure'];
/** How long a live post's shape keeps another post of the same shape out. */
export const NEAR_HOURS = 20;
const NEAR_MS = NEAR_HOURS * 3_600_000;

export type XPost = {
  slot: string;
  /** The slot's local day, for the day's report. */
  day: string;
  draftId: string;
  textHash: string;
  /** The hash of the words' shape (`textShape`). */
  shapeHash: string;
  mediaHash: string | null;
  link: boolean;
  costUsd: number;
  status: XPostStatus;
  postId: string | null;
  error: string | null;
  startedAt: string;
  doneAt: string | null;
};

export type Reserve = Omit<XPost, 'status' | 'postId' | 'error' | 'startedAt' | 'doneAt'> & { now: Date };
export type ReserveResult = { ok: true; post: XPost } | { ok: false; conflict: 'slot' | 'text' | 'media' | 'shape'; draftId: string | null };
export type Finish = { slot: string; status: Exclude<XPostStatus, 'sending'>; postId: string | null; error: string | null; now: Date };

export interface XLedger {
  /**
   * Takes the slot for a draft, unless the slot is taken, the words or clip are live in another row, or a live row
   * started in the last 20 hours has the same shape. Checked in that order.
   */
  reserve(input: Reserve): Promise<ReserveResult>;
  /** What became of the post; only a `sending` row moves. */
  finish(input: Finish): Promise<XPost | null>;
  /** The rows of one local day, by slot. */
  day(day: string): Promise<XPost[]>;
}

export class XLedgerUnavailable extends Error {}

/** The same words are the same post to X, whatever the spacing or the case. */
export function textHash(text: string): string {
  return createHash('sha256').update(text.normalize('NFC').replace(/\s+/g, ' ').trim().toLowerCase()).digest('hex');
}

/**
 * The words once numbers and links are taken out: «JUST IN: $3.07B traded…» and «JUST IN: $3.11B traded…» are one shape,
 * «$BONK…» and «$WIF…» are two. Spacing and case do not count.
 */
export function textShape(text: string): string {
  return text
    .normalize('NFC')
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/\d+(?:[.,:]\d+)*(?:[kmb](?![a-z]))?/g, '#')
    .replace(/\s+/g, ' ')
    .trim();
}

export function shapeHash(text: string): string {
  return createHash('sha256').update(textShape(text)).digest('hex');
}

export function mediaHash(bytes: Uint8Array | null): string | null {
  return bytes ? createHash('sha256').update(bytes).digest('hex') : null;
}

export class MemoryXLedger implements XLedger {
  private rows: XPost[] = [];

  async reserve(input: Reserve): Promise<ReserveResult> {
    // One synchronous check-and-insert: nothing else runs between them.
    const slot = this.rows.find((r) => r.slot === input.slot);
    if (slot) return { ok: false, conflict: 'slot', draftId: slot.draftId };
    const live = this.rows.filter((r) => LIVE.includes(r.status));
    const text = live.find((r) => r.textHash === input.textHash);
    if (text) return { ok: false, conflict: 'text', draftId: text.draftId };
    const media = input.mediaHash ? live.find((r) => r.mediaHash === input.mediaHash) : undefined;
    if (media) return { ok: false, conflict: 'media', draftId: media.draftId };
    const near = live
      .filter((r) => r.shapeHash === input.shapeHash && input.now.getTime() - Date.parse(r.startedAt) < NEAR_MS)
      .sort((a, b) => b.startedAt.localeCompare(a.startedAt))[0];
    if (near) return { ok: false, conflict: 'shape', draftId: near.draftId };
    const { now, ...rest } = input;
    const post: XPost = { ...rest, status: 'sending', postId: null, error: null, startedAt: now.toISOString(), doneAt: null };
    this.rows.push(post);
    return { ok: true, post: { ...post } };
  }

  async finish(input: Finish) {
    const r = this.rows.find((row) => row.slot === input.slot);
    if (!r) return null;
    if (r.status === 'sending') Object.assign(r, { status: input.status, postId: input.postId, error: input.error?.slice(0, 300) ?? null, doneAt: input.now.toISOString() });
    return { ...r };
  }

  async day(day: string) {
    return this.rows.filter((r) => r.day === day).sort((a, b) => a.slot.localeCompare(b.slot)).map((r) => ({ ...r }));
  }
}
