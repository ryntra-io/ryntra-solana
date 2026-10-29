import type { Moment } from '../moment.ts';
import type { PostKind } from './events.ts';

/**
 * The queue of post drafts. A draft is made when its event arrives, with its words and its link; its clip is filmed
 * by the city (the desk does it in the browser, where the city is drawn) and the draft is then ready. A person
 * approves it — one by one or all ready at once — or rejects it. Sending is a step of its own: only with the switch on
 * and a sender connected, and neither is the case until the owner says so.
 *
 *     filming → ready → approved → sending → sent | failed
 *                    ↘ rejected        ↖________↙ (not sent: back in line)
 *
 * `sending` is the claim: a delivery moves a draft out of `approved` in one atomic step before it asks the sender, so
 * two deliveries at once never post the same draft twice.
 */

export type DraftStatus = 'filming' | 'ready' | 'approved' | 'rejected' | 'sending' | 'sent' | 'failed';
export const DRAFT_STATUSES: readonly DraftStatus[] = ['filming', 'ready', 'approved', 'rejected', 'sending', 'sent', 'failed'];

export type MediaType = 'video/mp4' | 'image/png' | 'image/jpeg';
export const MEDIA_TYPES: readonly MediaType[] = ['video/mp4', 'image/png', 'image/jpeg'];
/** X takes a video up to 512 MB, but a city clip is under one; 4 MB keeps a request within what a function receives. */
export const MEDIA_MAX_BYTES = 4 * 1024 * 1024;

export type Draft = {
  id: string;
  /** The producer's id of the happening: one draft per happening. */
  eventId: string;
  kind: PostKind;
  /** The clip's recipe: what the director stages, and the facts the words say. */
  moment: Moment;
  text: string;
  link: string;
  status: DraftStatus;
  media: { type: MediaType; bytes: number } | null;
  /** Who decided, as the desk names them ("operator:…", "key"). */
  decidedBy: string | null;
  decidedAt: string | null;
  /** What the sender said, when it was asked. */
  note: string | null;
  createdAt: string;
  updatedAt: string;
};

/** The kill switch for sending. Off until a person turns it on; off again with one tap. */
export type Switch = { on: boolean; changedBy: string | null; changedAt: string | null };

export type NewDraft = { eventId: string; kind: PostKind; moment: Moment; text: string; link: string; now: Date };
export type Decision = 'approved' | 'rejected';
export type Delivery = { status: 'sent' | 'failed' | 'approved'; note: string };

export type DecideResult = { ok: true; draft: Draft } | { ok: false; error: 'not_found' | 'not_ready' };
export type MediaResult = { ok: true; draft: Draft } | { ok: false; error: 'not_found' | 'decided' };

export interface DraftStore {
  /** Makes the draft of an event, or hands back the one already made for it. */
  put(input: NewDraft): Promise<{ created: boolean; draft: Draft }>;
  /** Newest first; all statuses when `status` is null. */
  list(input: { status: DraftStatus | null; limit: number }): Promise<Draft[]>;
  get(id: string): Promise<Draft | null>;
  /** Approves or rejects a ready draft. */
  decide(input: { id: string; decision: Decision; by: string; now: Date }): Promise<DecideResult>;
  /** Approves every ready draft; returns the ones it approved. */
  approveAll(input: { by: string; now: Date }): Promise<Draft[]>;
  /** The clip (or, where the browser cannot film, the card) of a draft not yet decided; the draft is then ready. */
  setMedia(input: { id: string; type: MediaType; bytes: Uint8Array; now: Date }): Promise<MediaResult>;
  media(id: string): Promise<{ type: MediaType; bytes: Uint8Array } | null>;
  /**
   * Claims an approved draft for sending (`approved` → `sending`) in one atomic step, only while the switch is on.
   * Null when it is not approved any more (another delivery holds it), not there, or the switch is off.
   */
  claim(input: { id: string; now: Date }): Promise<Draft | null>;
  /** What became of a claimed (`sending`) draft when the sender was asked. */
  delivered(input: { id: string; delivery: Delivery; now: Date }): Promise<Draft | null>;
  switch(): Promise<Switch>;
  setSwitch(input: { on: boolean; by: string; now: Date }): Promise<Switch>;
}

/** The store failed (the database is unreachable or answered nonsense): a route answers 503. */
export class DraftStoreUnavailable extends Error {}

/** The queue in memory: tests, and a development server without a database. */
export class MemoryDraftStore implements DraftStore {
  private drafts = new Map<string, Draft>();
  private files = new Map<string, { type: MediaType; bytes: Uint8Array }>();
  private state: Switch = { on: false, changedBy: null, changedAt: null };
  private seq = 0;

  async put(input: NewDraft) {
    for (const d of this.drafts.values()) if (d.eventId === input.eventId) return { created: false, draft: { ...d } };
    this.seq += 1;
    const at = input.now.toISOString();
    const id = `00000000-0000-4000-8000-${String(this.seq).padStart(12, '0')}`;
    const draft: Draft = {
      id, eventId: input.eventId, kind: input.kind, moment: input.moment, text: input.text, link: input.link,
      status: 'filming', media: null, decidedBy: null, decidedAt: null, note: null, createdAt: at, updatedAt: at,
    };
    this.drafts.set(id, draft);
    return { created: true, draft: { ...draft } };
  }

  async list(input: { status: DraftStatus | null; limit: number }) {
    return [...this.drafts.values()]
      .filter((d) => !input.status || d.status === input.status)
      .sort((a, b) => (a.createdAt === b.createdAt ? b.id.localeCompare(a.id) : b.createdAt.localeCompare(a.createdAt)))
      .slice(0, input.limit)
      .map((d) => ({ ...d }));
  }

  async get(id: string) {
    const d = this.drafts.get(id);
    return d ? { ...d } : null;
  }

  async decide(input: { id: string; decision: Decision; by: string; now: Date }): Promise<DecideResult> {
    const d = this.drafts.get(input.id);
    if (!d) return { ok: false, error: 'not_found' };
    if (d.status !== 'ready') return { ok: false, error: 'not_ready' };
    const at = input.now.toISOString();
    Object.assign(d, { status: input.decision, decidedBy: input.by, decidedAt: at, updatedAt: at });
    return { ok: true, draft: { ...d } };
  }

  async approveAll(input: { by: string; now: Date }) {
    const done: Draft[] = [];
    for (const d of await this.list({ status: 'ready', limit: 1000 })) {
      const r = await this.decide({ id: d.id, decision: 'approved', by: input.by, now: input.now });
      if (r.ok) done.push(r.draft);
    }
    return done;
  }

  async setMedia(input: { id: string; type: MediaType; bytes: Uint8Array; now: Date }): Promise<MediaResult> {
    const d = this.drafts.get(input.id);
    if (!d) return { ok: false, error: 'not_found' };
    if (d.status !== 'filming' && d.status !== 'ready') return { ok: false, error: 'decided' };
    this.files.set(d.id, { type: input.type, bytes: input.bytes.slice() });
    Object.assign(d, { status: 'ready', media: { type: input.type, bytes: input.bytes.byteLength }, updatedAt: input.now.toISOString() });
    return { ok: true, draft: { ...d } };
  }

  async media(id: string) {
    const f = this.files.get(id);
    return f ? { type: f.type, bytes: f.bytes.slice() } : null;
  }

  async claim(input: { id: string; now: Date }) {
    const d = this.drafts.get(input.id);
    // One synchronous check-and-set: nothing else runs between them.
    if (!d || d.status !== 'approved' || !this.state.on) return null;
    Object.assign(d, { status: 'sending', updatedAt: input.now.toISOString() });
    return { ...d };
  }

  async delivered(input: { id: string; delivery: Delivery; now: Date }) {
    const d = this.drafts.get(input.id);
    if (!d || d.status !== 'sending') return d ? { ...d } : null;
    Object.assign(d, { status: input.delivery.status, note: input.delivery.note.slice(0, 300), updatedAt: input.now.toISOString() });
    return { ...d };
  }

  async switch() {
    return { ...this.state };
  }

  async setSwitch(input: { on: boolean; by: string; now: Date }) {
    this.state = { on: input.on, changedBy: input.by, changedAt: input.now.toISOString() };
    return { ...this.state };
  }
}
