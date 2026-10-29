import type { Authorize, Caller, DoorKind } from './door.ts';
import { readPostEvent, momentForPost } from './events.ts';
import { postIsClean, studioLink, studioText } from '../../x/post.ts';
import { postLink, postText } from './post.ts';
import { outgoing, type XSender } from './sender.ts';
import {
  DRAFT_STATUSES, DraftStoreUnavailable, MEDIA_MAX_BYTES, MEDIA_TYPES,
  type Decision, type Delivery, type Draft, type DraftStatus, type DraftStore, type MediaType, type Switch,
} from './store.ts';

/**
 * `/api/moments`: the queue of post drafts. Every route asks who is calling (`door.ts`) and nothing here is open to a
 * visitor. The routes, with who may call them:
 *
 *     POST /events                  machine   an event of the city becomes a draft (its words, its link; the clip follows)
 *     PUT  /drafts/:id/clip         machine   the clip (MP4) or the card (PNG, JPEG) the city filmed for it
 *     GET  /drafts?status=          operator  the queue, the switch and whether a sender is connected
 *     GET  /drafts/:id/clip         operator  that file, for the desk's preview
 *     POST /drafts/:id/approve      operator  a ready draft is approved (asked again: the same answer)
 *     POST /drafts/:id/reject       operator  a ready draft is rejected
 *     POST /drafts/approve-all      fresh     every ready draft is approved
 *     GET  /switch                  operator  the kill switch for sending, off by default
 *     POST /switch                  operator to turn it off, fresh to turn it on
 *
 * `machine` is the desk's secret or an operator's session; `operator` is a session only; `fresh` is a session whose
 * second factor is recent. Approving never posts by itself: an approved draft goes to the sender only while the switch
 * is on and a sender is connected. The sender wired is `x-sender` (`city/lib/x`), off until the owner connects it; it
 * is scheduled, so its cron posts the approved line in the day's slots.
 */

export type { Caller } from './door.ts';

export type MomentsAuditAction = 'moments_decide' | 'moments_approve_all' | 'moments_switch';
export type MomentsAudit = {
  actor: number | null;
  by: string;
  action: MomentsAuditAction;
  outcome: 'attempt' | 'ok' | 'rejected' | 'failed';
  payload: Record<string, unknown>;
};

export type MomentsDeps = {
  store: DraftStore;
  /** Who is calling, for which kind of route; `mutation` asks the cookie path to also check the request is same-origin. */
  authorize: Authorize;
  sender: XSender;
  /** The admin's audit trail; a failure to record never blocks the action. */
  audit?: (entry: MomentsAudit) => Promise<unknown>;
  now?: () => Date;
};

export type MomentsApi = {
  events(req: Request): Promise<Response>;
  list(req: Request): Promise<Response>;
  approve(req: Request, id: string): Promise<Response>;
  reject(req: Request, id: string): Promise<Response>;
  approveAll(req: Request): Promise<Response>;
  putClip(req: Request, id: string): Promise<Response>;
  getClip(req: Request, id: string): Promise<Response>;
  getSwitch(req: Request): Promise<Response>;
  setSwitch(req: Request): Promise<Response>;
};

const EVENT_MAX_BYTES = 8 * 1024;
const LIST_LIMIT = 50;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const NO_STORE = { 'Cache-Control': 'no-store' };

const json = (body: unknown, status = 200) => Response.json(body, { status, headers: NO_STORE });
const error = (status: number, code: string) => json({ error: code }, status);

/** The file is what its type says: an MP4 box, a PNG or a JPEG signature. */
function looksLike(type: MediaType, b: Uint8Array): boolean {
  if (type === 'video/mp4') return b.length > 12 && b[4] === 0x66 && b[5] === 0x74 && b[6] === 0x79 && b[7] === 0x70;
  if (type === 'image/png') return b.length > 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47;
  return b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;
}

export function createMomentsApi(deps: MomentsDeps): MomentsApi {
  const { store, sender } = deps;
  const now = deps.now ?? (() => new Date());

  type Allowed = Extract<Caller, { ok: true }>;
  const refuse = (caller: Extract<Caller, { ok: false }>) => error(caller.status, caller.error);

  const audit = async (caller: Allowed, action: MomentsAuditAction, outcome: MomentsAudit['outcome'], payload: Record<string, unknown>) => {
    if (!deps.audit) return;
    try {
      await deps.audit({ actor: caller.actor, by: caller.by, action, outcome, payload });
    } catch {
      // Recording must never block the action it records.
    }
  };

  /** Runs a handler for a caller the door lets through for this kind of route; a store failure is a 503, never a half answer. */
  const guarded = (kind: DoorKind, mutation: boolean, handle: (req: Request, caller: Allowed) => Promise<Response>) => async (req: Request) => {
    const caller = await deps.authorize(req, kind, mutation);
    if (!caller.ok) return refuse(caller);
    try {
      return await handle(req, caller);
    } catch (e) {
      if (e instanceof DraftStoreUnavailable) return error(503, 'unavailable');
      throw e;
    }
  };

  const sending = async (sw?: Switch) => {
    const state = sw ?? (await store.switch());
    return { switch: state, sender: { connected: sender.connected, scheduled: sender.scheduled === true } };
  };

  /**
   * Hands approved drafts to the sender — only with the switch on and a sender connected. Otherwise they wait. Each
   * draft is first claimed (`approved` → `sending`, one atomic step in the store that also checks the switch), so two
   * deliveries at once never send it twice; then sent; then marked `sent` or `failed`. A scheduled sender is never
   * asked here: its cron posts the line slot by slot (`city/lib/x/run.ts`). A draft a crash leaves in
   * `sending` stays there for a person to look at: at most once, never twice.
   */
  async function deliver(drafts: Draft[]): Promise<Draft[]> {
    const approved = drafts.filter((d) => d.status === 'approved');
    // A scheduled sender (x-sender) takes approved drafts on its own clock, never on approval.
    if (!approved.length || !sender.connected || sender.scheduled || !(await store.switch()).on) return drafts;
    const out = new Map<string, Draft>();
    for (const d of approved) {
      // The switch is read before each post, so turning it off stops the rest of a batch.
      if (!(await store.switch()).on) break;
      const claimed = await store.claim({ id: d.id, now: now() });
      if (!claimed) continue; // another delivery holds it, or the switch went off meanwhile
      out.set(d.id, claimed);
      let delivery: Delivery;
      try {
        const result = await sender.send(outgoing(claimed, await store.media(d.id)));
        delivery = result.ok ? { status: 'sent', note: `posted ${result.postId}` } : { status: 'failed', note: result.error };
      } catch (e) {
        // Whether it left is unknown: failed, never back in line to be sent again.
        delivery = { status: 'failed', note: `sender error: ${e instanceof Error ? e.message : String(e)}` };
      }
      const updated = await store.delivered({ id: d.id, delivery, now: now() });
      if (updated) out.set(d.id, updated);
    }
    return drafts.map((d) => out.get(d.id) ?? d);
  }

  /** What a decision already made looks like: approving an approved draft again is the same answer, not a conflict. */
  const ALREADY: Record<Decision, readonly DraftStatus[]> = {
    approved: ['approved', 'sending', 'sent', 'failed'],
    rejected: ['rejected'],
  };

  const decide = (decision: Decision) => (req: Request, id: string) =>
    guarded('operator', true, async (_req, caller) => {
      if (!UUID.test(id)) return error(404, 'not_found');
      const r = await store.decide({ id, decision, by: caller.by, now: now() });
      if (!r.ok) {
        const current = r.error === 'not_ready' ? await store.get(id) : null;
        if (current && ALREADY[decision].includes(current.status)) {
          const [draft] = await deliver([current]);
          return json({ draft, already: true, ...(await sending()) });
        }
        await audit(caller, 'moments_decide', 'rejected', { id, decision, reason: r.error });
        return error(r.error === 'not_found' ? 404 : 409, r.error);
      }
      await audit(caller, 'moments_decide', 'ok', { id, decision });
      const [draft] = await deliver([r.draft]);
      return json({ draft, ...(await sending()) });
    })(req);

  return {
    events: guarded('machine', true, async (req) => {
      const text = await req.text();
      if (new TextEncoder().encode(text).byteLength > EVENT_MAX_BYTES) return error(413, 'too_large');
      let body: unknown;
      try {
        body = JSON.parse(text);
      } catch {
        return error(400, 'bad_json');
      }
      const read = readPostEvent(body);
      if (!read.ok) return json({ error: 'bad_event', field: read.error }, 400);
      const moment = momentForPost(read.event);
      if (!moment) return json({ error: 'not_a_post' }, 422);
      // A studio post's words come from its facts alone (CITY-38): no handle, no tag, within 280.
      const studio = read.event.kind === 'studio' ? read.event.facts : null;
      const link = studio ? studioLink(studio) : postLink(moment);
      const words = studio ? studioText(studio, link) : postText(moment, link);
      if (studio && !postIsClean(words)) return json({ error: 'not_a_post' }, 422);
      const put = await store.put({ eventId: `${read.event.kind}:${read.event.id}`, kind: read.event.kind, moment, text: words, link, now: now() });
      return json({ created: put.created, draft: put.draft }, put.created ? 201 : 200);
    }),

    list: guarded('operator', false, async (req) => {
      const asked = new URL(req.url).searchParams.get('status');
      if (asked && !DRAFT_STATUSES.includes(asked as DraftStatus)) return error(400, 'bad_status');
      const drafts = await store.list({ status: (asked as DraftStatus | null) ?? null, limit: LIST_LIMIT });
      return json({ drafts, ...(await sending()) });
    }),

    approve: decide('approved'),
    reject: decide('rejected'),

    approveAll: guarded('fresh', true, async (_req, caller) => {
      await audit(caller, 'moments_approve_all', 'attempt', {});
      let approved: Draft[];
      try {
        approved = await store.approveAll({ by: caller.by, now: now() });
      } catch (e) {
        await audit(caller, 'moments_approve_all', 'failed', {});
        throw e;
      }
      await audit(caller, 'moments_approve_all', 'ok', { count: approved.length, ids: approved.map((d) => d.id) });
      const drafts = await deliver(approved);
      return json({ approved: drafts.length, drafts, ...(await sending()) });
    }),

    putClip: (req, id) =>
      guarded('machine', true, async (req) => {
        if (!UUID.test(id)) return error(404, 'not_found');
        const type = (req.headers.get('content-type') ?? '').split(';')[0]!.trim() as MediaType;
        if (!MEDIA_TYPES.includes(type)) return error(415, 'bad_type');
        const declared = Number(req.headers.get('content-length') ?? 0);
        if (declared > MEDIA_MAX_BYTES) return error(413, 'too_large');
        const bytes = new Uint8Array(await req.arrayBuffer());
        if (bytes.byteLength > MEDIA_MAX_BYTES) return error(413, 'too_large');
        if (!looksLike(type, bytes)) return error(415, 'not_that_type');
        const r = await store.setMedia({ id, type, bytes, now: now() });
        if (!r.ok) return error(r.error === 'not_found' ? 404 : 409, r.error);
        return json({ draft: r.draft });
      })(req),

    getClip: (req, id) =>
      guarded('operator', false, async () => {
        if (!UUID.test(id)) return error(404, 'not_found');
        const file = await store.media(id);
        if (!file) return error(404, 'not_found');
        return new Response(file.bytes as BodyInit, { headers: { 'Content-Type': file.type, 'Content-Length': String(file.bytes.byteLength), ...NO_STORE } });
      })(req),

    getSwitch: guarded('operator', false, async () => json(await sending())),

    /** Off with one tap for any operator; on only with a fresh second factor, and on the record. */
    setSwitch: guarded('operator', true, async (req, operator) => {
      let body: unknown;
      try {
        body = await req.json();
      } catch {
        return error(400, 'bad_json');
      }
      const on = (body as { on?: unknown } | null)?.on;
      if (typeof on !== 'boolean') return error(400, 'bad_switch');
      let caller = operator;
      if (on) {
        const fresh = await deps.authorize(req, 'fresh', true);
        if (!fresh.ok) {
          await audit(operator, 'moments_switch', 'rejected', { on, reason: fresh.error });
          return refuse(fresh);
        }
        caller = fresh;
      }
      await audit(caller, 'moments_switch', 'attempt', { on });
      let sw: Switch;
      try {
        sw = await store.setSwitch({ on, by: caller.by, now: now() });
      } catch (e) {
        await audit(caller, 'moments_switch', 'failed', { on });
        throw e;
      }
      await audit(caller, 'moments_switch', 'ok', { on });
      // Turning it on sends what was approved meanwhile — if a sender is connected; none is.
      if (on) await deliver(await store.list({ status: 'approved', limit: LIST_LIMIT }));
      return json(await sending(sw));
    }),
  };
}
