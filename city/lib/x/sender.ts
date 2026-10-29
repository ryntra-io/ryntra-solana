import type { OutgoingPost, XSender } from '../moments/drafts/sender.ts';
import type { XClient } from './client.ts';
import { XApiError } from './client.ts';
import type { XConfig } from './config.ts';

/**
 * `x-sender`: the real sender of the drafts queue. It is connected only with `RYNTRA_X_SENDER=on` and all four keys
 * (`config.ts`); otherwise it says so and touches nothing. It is a scheduled sender: approving a draft only puts it
 * in line, and the cron (`run.ts`) posts it in the next open slot.
 */

export type Published = { ok: true; postId: string } | { ok: false; error: string; unsure: boolean };

export type XPublisher = XSender & {
  readonly reason: string | null;
  /** Uploads the clip or card, then posts the words with it. */
  publish(post: OutgoingPost): Promise<Published>;
};

/**
 * How long one post may take, upload and all: the cron's function has 60 s (`app/api/x/cron/route.ts`), and a pass
 * killed half way would leave its draft `sending` for a person to look at.
 */
export const PUBLISH_MS = 40_000;

export function createXSender(config: Pick<XConfig, 'connected' | 'reason'>, client: XClient | null, opts: { now?: () => number; budgetMs?: number } = {}): XPublisher {
  const now = opts.now ?? Date.now;
  const budgetMs = opts.budgetMs ?? PUBLISH_MS;
  const connected = config.connected && client !== null;
  const reason = connected ? null : config.reason ?? 'X not connected.';

  async function publish(post: OutgoingPost): Promise<Published> {
    if (!connected || !client) return { ok: false, error: reason!, unsure: false };
    try {
      const until = now() + budgetMs;
      const media = post.media ? [await client.uploadMedia(post.media.type, post.media.bytes, { until })] : [];
      const { id } = await client.createPost(post.text, media, { until });
      return { ok: true, postId: id };
    } catch (e) {
      if (e instanceof XApiError) return { ok: false, error: e.message, unsure: e.unsure };
      return { ok: false, error: `x-sender: ${e instanceof Error ? e.message : String(e)}`, unsure: true };
    }
  }

  return {
    connected,
    scheduled: true,
    reason,
    publish,
    async send(post) {
      const r = await publish(post);
      return r.ok ? r : { ok: false, error: r.error };
    },
  };
}
