import { authorization, type XKeys } from './oauth.ts';

/**
 * The HTTP client of X API v2, as small as the publisher needs: a media upload in chunks and a post.
 *
 *     POST /2/media/upload/initialize        INIT      { media_type, total_bytes, media_category } → data.id
 *     POST /2/media/upload/:id/append        APPEND    multipart: segment_index, media (one chunk)
 *     POST /2/media/upload/:id/finalize      FINALIZE  → data.processing_info for a video
 *     GET  /2/media/upload?command=STATUS    STATUS    until processing_info.state is succeeded (or failed)
 *     POST /2/tweets                         post      { text, media: { media_ids } } → data.id
 *
 * Every request is signed (OAuth 1.0a, `oauth.ts`) and retried on 429, 5xx and a network failure, with backoff (a 429
 * waits until X's reset, when that is soon), never past the call's time (`until`). Any other answer is final. A post that met a 5xx or a lost connection
 * before failing may have gone out all the same: its error says `unsure`, and the publisher never sends it again.
 */

export const X_API = 'https://api.x.com';
/** One APPEND carries at most this much; a city clip (under 4 MB) is a few chunks. */
export const CHUNK_BYTES = 1024 * 1024;

export type MediaKind = 'video/mp4' | 'image/png' | 'image/jpeg';

export class XApiError extends Error {
  /** The HTTP status; 0 when no answer came (network, timeout, processing that never finished). */
  readonly status: number;
  /** The post may have been made: a 5xx or a lost answer came before this failure. */
  readonly unsure: boolean;
  constructor(status: number, message: string, unsure = false) {
    super(message);
    this.status = status;
    this.unsure = unsure;
  }
}

export type XClientDeps = {
  keys: XKeys;
  /** `https://api.x.com`; a test passes its own server. */
  base?: string;
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  /** Milliseconds since the epoch, for X's rate-limit reset. */
  now?: () => number;
  /** Retries after the first try (default 3). */
  retries?: number;
  /** Backoff before retry n is `backoffMs × 2ⁿ` (default 1 s). */
  backoffMs?: number;
  /** A 429 waits for X's reset only when it is at most this far off (default 20 s); otherwise it fails at once. */
  maxWaitMs?: number;
  /** How long a video may take to process, summed over X's `check_after_secs` (default 30 s). */
  processingMs?: number;
  /** Per request (default 15 s). */
  timeoutMs?: number;
};

/** The instant (ms since the epoch, by `now`) a call must be done by: a wait or a request never runs past it. */
export type Until = { until?: number };

export type XClient = {
  /** Uploads a clip or a card and hands back its media id, once X has processed it. */
  uploadMedia(type: MediaKind, bytes: Uint8Array, opts?: Until): Promise<string>;
  createPost(text: string, mediaIds: readonly string[], opts?: Until): Promise<{ id: string }>;
};

type Body = { json: unknown } | { multipart: FormData } | null;
type Processing = { state?: string; check_after_secs?: number; error?: { message?: string } } | undefined;

const sleepReal = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** What X said, in a line: v2 errors come as `{ title, detail }` or `{ errors: [{ message }] }`. */
function reason(status: number, body: unknown): string {
  const b = (body ?? {}) as { detail?: unknown; title?: unknown; errors?: { message?: unknown }[] };
  const said = [b.detail, b.title, b.errors?.[0]?.message].find((s) => typeof s === 'string' && s.trim());
  return `X ${status}: ${String(said ?? 'no reason given').slice(0, 200)}`;
}

export function createXClient(deps: XClientDeps): XClient {
  const base = (deps.base ?? X_API).replace(/\/$/, '');
  const doFetch = deps.fetch ?? fetch;
  const sleep = deps.sleep ?? sleepReal;
  const now = deps.now ?? Date.now;
  const retries = deps.retries ?? 3;
  const backoffMs = deps.backoffMs ?? 1000;
  const maxWaitMs = deps.maxWaitMs ?? 20_000;
  const processingMs = deps.processingMs ?? 30_000;
  const timeoutMs = deps.timeoutMs ?? 15_000;

  /** One call, with its retries. `unsure` turns true once an answer was lost or was a 5xx. */
  async function request(method: 'GET' | 'POST', path: string, body: Body, until = Infinity): Promise<{ data: Record<string, unknown>; unsure: boolean }> {
    const url = `${base}${path}`;
    let unsure = false;
    const late = () => new XApiError(0, 'out of time for this pass: X did not answer in time', unsure);
    /** Waits before a retry, unless the wait would run past the call's time. */
    const pause = async (ms: number) => {
      if (now() + ms >= until) throw late();
      await sleep(ms);
    };
    for (let attempt = 0; ; attempt += 1) {
      const left = until - now();
      if (left <= 0) throw late();
      const headers: Record<string, string> = { Authorization: authorization({ method, url, keys: deps.keys }) };
      if (body && 'json' in body) headers['Content-Type'] = 'application/json';
      let res: Response;
      try {
        res = await doFetch(url, {
          method,
          headers,
          body: body ? ('json' in body ? JSON.stringify(body.json) : body.multipart) : undefined,
          signal: AbortSignal.timeout(Math.min(timeoutMs, left)),
        });
      } catch (e) {
        unsure = true;
        if (attempt < retries) {
          await pause(backoffMs * 2 ** attempt);
          continue;
        }
        throw new XApiError(0, `X unreachable: ${e instanceof Error ? e.message : String(e)}`, unsure);
      }
      const text = await res.text();
      let parsed: unknown = null;
      try {
        parsed = text ? JSON.parse(text) : {};
      } catch {
        parsed = null;
      }
      if (res.ok) {
        if (!parsed || typeof parsed !== 'object') throw new XApiError(res.status, `X ${res.status}: not JSON`, unsure);
        return { data: parsed as Record<string, unknown>, unsure };
      }
      if (res.status === 429) {
        const reset = Number(res.headers.get('x-rate-limit-reset'));
        const after = Number(res.headers.get('retry-after'));
        const wait = Number.isFinite(after) && after > 0 ? after * 1000 : Number.isFinite(reset) && reset > 0 ? Math.max(0, reset * 1000 - now()) : backoffMs * 2 ** attempt;
        if (attempt < retries && wait <= maxWaitMs && now() + wait < until) {
          await sleep(wait);
          continue;
        }
        throw new XApiError(429, `${reason(429, parsed)} (rate limited, ${Math.ceil(wait / 1000)} s to reset)`, unsure);
      }
      if (res.status >= 500) {
        unsure = true;
        if (attempt < retries) {
          await pause(backoffMs * 2 ** attempt);
          continue;
        }
      }
      throw new XApiError(res.status, reason(res.status, parsed), unsure);
    }
  }

  const dataOf = (r: { data: Record<string, unknown> }) => (r.data.data ?? {}) as Record<string, unknown>;

  return {
    async uploadMedia(type, bytes, opts = {}) {
      const until = opts.until ?? Infinity;
      const init = dataOf(await request('POST', '/2/media/upload/initialize', {
        json: { media_type: type, total_bytes: bytes.byteLength, media_category: type === 'video/mp4' ? 'tweet_video' : 'tweet_image' },
      }, until));
      const id = typeof init.id === 'string' ? init.id : null;
      if (!id) throw new XApiError(200, 'X gave no media id on INIT');
      const path = `/2/media/upload/${encodeURIComponent(id)}`;
      for (let i = 0, at = 0; at < bytes.byteLength; i += 1, at += CHUNK_BYTES) {
        const form = new FormData();
        form.set('segment_index', String(i));
        form.set('media', new Blob([bytes.slice(at, at + CHUNK_BYTES)], { type: 'application/octet-stream' }), 'chunk');
        await request('POST', `${path}/append`, { multipart: form }, until);
      }
      let info = dataOf(await request('POST', `${path}/finalize`, null, until)).processing_info as Processing;
      let waited = 0;
      while (info && (info.state === 'pending' || info.state === 'in_progress')) {
        const wait = Math.max(1, Number(info.check_after_secs) || 1) * 1000;
        if (waited + wait > processingMs || now() + wait >= until) throw new XApiError(0, `X still processing the media after ${Math.round(waited / 1000)} s`);
        await sleep(wait);
        waited += wait;
        info = dataOf(await request('GET', `/2/media/upload?command=STATUS&media_id=${encodeURIComponent(id)}`, null, until)).processing_info as Processing;
      }
      if (info?.state === 'failed') throw new XApiError(200, `X could not process the media: ${String(info.error?.message ?? 'no reason given').slice(0, 200)}`);
      return id;
    },

    async createPost(text, mediaIds, opts = {}) {
      try {
        const r = await request('POST', '/2/tweets', { json: mediaIds.length ? { text, media: { media_ids: [...mediaIds] } } : { text } }, opts.until ?? Infinity);
        const id = dataOf(r).id;
        if (typeof id !== 'string') throw new XApiError(200, 'X gave no post id', true);
        return { id };
      } catch (e) {
        if (e instanceof XApiError && e.unsure && e.status === 403 && /duplicate/i.test(e.message)) {
          throw new XApiError(403, `${e.message} (after a lost answer: the post most likely went out)`, true);
        }
        throw e;
      }
    },
  };
}
