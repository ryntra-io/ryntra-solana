import {
  DraftStoreUnavailable,
  type DecideResult, type Decision, type Delivery, type Draft, type DraftStatus, type DraftStore, type MediaResult,
  type MediaType, type NewDraft, type Switch,
} from './store.ts';

/**
 * The queue in the database: one call to one `public.moments_*` function per question, each gated by the app secret
 * and each one transaction (`supabase/migrations/20261027150000_city_moments_drafts_v1.sql`). The transport is the
 * server's usual one (`rpcResult`, which adds the secret); a test passes its own transport to a throwaway database.
 */

export type MomentsRpc = (fn: string, args: Record<string, unknown>) => Promise<{ ok: true; data: unknown } | { ok: false; error: string }>;

type Answer = Record<string, unknown> & { ok?: unknown; error?: unknown };

const toBase64 = (b: Uint8Array) => Buffer.from(b.buffer, b.byteOffset, b.byteLength).toString('base64');
const fromBase64 = (s: string) => new Uint8Array(Buffer.from(s, 'base64'));

export class SupabaseDraftStore implements DraftStore {
  private readonly rpc: MomentsRpc;

  constructor(rpc: MomentsRpc) {
    this.rpc = rpc;
  }

  private async call(fn: string, args: Record<string, unknown>): Promise<Answer> {
    const answer = await this.rpc(fn, args);
    if (!answer.ok) throw new DraftStoreUnavailable(`${fn}: ${answer.error}`);
    const data = answer.data;
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new DraftStoreUnavailable(`${fn}: no answer`);
    return data as Answer;
  }

  private async ok(fn: string, args: Record<string, unknown>): Promise<Answer> {
    const data = await this.call(fn, args);
    if (data.ok !== true) throw new DraftStoreUnavailable(`${fn}: ${String(data.error ?? 'refused')}`);
    return data;
  }

  async put(input: NewDraft) {
    const data = await this.ok('moments_draft_put', {
      p_event_id: input.eventId, p_kind: input.kind, p_moment: input.moment, p_text: input.text, p_link: input.link, p_now: input.now.toISOString(),
    });
    return { created: data.created === true, draft: data.draft as Draft };
  }

  async list(input: { status: DraftStatus | null; limit: number }) {
    const data = await this.ok('moments_drafts_list', { p_status: input.status, p_limit: input.limit });
    return data.drafts as Draft[];
  }

  async get(id: string) {
    const data = await this.ok('moments_draft_get', { p_id: id });
    return (data.draft as Draft | null) ?? null;
  }

  async decide(input: { id: string; decision: Decision; by: string; now: Date }): Promise<DecideResult> {
    const data = await this.call('moments_draft_decide', { p_id: input.id, p_decision: input.decision, p_by: input.by, p_now: input.now.toISOString() });
    if (data.ok === true) return { ok: true, draft: data.draft as Draft };
    if (data.error === 'not_found' || data.error === 'not_ready') return { ok: false, error: data.error };
    throw new DraftStoreUnavailable(`moments_draft_decide: ${String(data.error)}`);
  }

  async approveAll(input: { by: string; now: Date }) {
    const data = await this.ok('moments_drafts_approve_all', { p_by: input.by, p_now: input.now.toISOString() });
    return data.drafts as Draft[];
  }

  async setMedia(input: { id: string; type: MediaType; bytes: Uint8Array; now: Date }): Promise<MediaResult> {
    const data = await this.call('moments_draft_media_put', { p_id: input.id, p_type: input.type, p_base64: toBase64(input.bytes), p_now: input.now.toISOString() });
    if (data.ok === true) return { ok: true, draft: data.draft as Draft };
    if (data.error === 'not_found' || data.error === 'decided') return { ok: false, error: data.error };
    throw new DraftStoreUnavailable(`moments_draft_media_put: ${String(data.error)}`);
  }

  async media(id: string) {
    const data = await this.ok('moments_draft_media_get', { p_id: id });
    const media = data.media as { type: MediaType; base64: string } | null;
    return media ? { type: media.type, bytes: fromBase64(media.base64) } : null;
  }

  async claim(input: { id: string; now: Date }) {
    const data = await this.ok('moments_draft_claim', { p_id: input.id, p_now: input.now.toISOString() });
    return (data.draft as Draft | null) ?? null;
  }

  async delivered(input: { id: string; delivery: Delivery; now: Date }) {
    const data = await this.ok('moments_draft_delivered', {
      p_id: input.id, p_status: input.delivery.status, p_note: input.delivery.note.slice(0, 300), p_now: input.now.toISOString(),
    });
    return (data.draft as Draft | null) ?? null;
  }

  async switch() {
    const data = await this.ok('moments_switch_get', {});
    return data.switch as Switch;
  }

  async setSwitch(input: { on: boolean; by: string; now: Date }) {
    const data = await this.ok('moments_switch_set', { p_on: input.on, p_by: input.by, p_now: input.now.toISOString() });
    return data.switch as Switch;
  }
}
