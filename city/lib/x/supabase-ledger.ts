import { XLedgerUnavailable, type Finish, type Reserve, type ReserveResult, type XLedger, type XPost } from './ledger.ts';

/**
 * The ledger in the database: one `public.x_post*` function per question, each gated by the app secret
 * (`supabase/migrations/20261027180000_city_x_posts_v1.sql`). The unique indexes there make `reserve` atomic.
 */

export type XRpc = (fn: string, args: Record<string, unknown>) => Promise<{ ok: true; data: unknown } | { ok: false; error: string }>;

type Answer = Record<string, unknown> & { ok?: unknown; error?: unknown };

export class SupabaseXLedger implements XLedger {
  private readonly rpc: XRpc;

  constructor(rpc: XRpc) {
    this.rpc = rpc;
  }

  private async call(fn: string, args: Record<string, unknown>): Promise<Answer> {
    const answer = await this.rpc(fn, args);
    if (!answer.ok) throw new XLedgerUnavailable(`${fn}: ${answer.error}`);
    const data = answer.data;
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new XLedgerUnavailable(`${fn}: no answer`);
    return data as Answer;
  }

  async reserve(input: Reserve): Promise<ReserveResult> {
    const data = await this.call('x_post_reserve', {
      p_slot: input.slot, p_day: input.day, p_draft_id: input.draftId, p_text_hash: input.textHash, p_shape_hash: input.shapeHash, p_media_hash: input.mediaHash,
      p_link: input.link, p_cost_usd: input.costUsd, p_now: input.now.toISOString(),
    });
    if (data.ok === true) return { ok: true, post: data.post as XPost };
    if (data.error === 'slot' || data.error === 'text' || data.error === 'media' || data.error === 'shape') return { ok: false, conflict: data.error, draftId: (data.draftId as string | null) ?? null };
    throw new XLedgerUnavailable(`x_post_reserve: ${String(data.error)}`);
  }

  async finish(input: Finish) {
    const data = await this.call('x_post_finish', {
      p_slot: input.slot, p_status: input.status, p_post_id: input.postId, p_error: input.error?.slice(0, 300) ?? null, p_now: input.now.toISOString(),
    });
    if (data.ok !== true) throw new XLedgerUnavailable(`x_post_finish: ${String(data.error)}`);
    return (data.post as XPost | null) ?? null;
  }

  async day(day: string) {
    const data = await this.call('x_posts_day', { p_day: day });
    if (data.ok !== true) throw new XLedgerUnavailable(`x_posts_day: ${String(data.error)}`);
    return data.posts as XPost[];
  }
}
