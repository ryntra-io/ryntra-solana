import { FixedWindowLimiter, clientIp } from "../http-control.ts";

export const AGENT_CONTROL_MAX_BODY_BYTES = 96 * 1_024;
export const AGENT_CONTROL_MAX_CONCURRENT_UPSTREAM_READS = 4;
export const AGENT_CONTROL_UPSTREAM_RETRY_AFTER_SECONDS = 1;

/*
 * 12/60s is the same policy the two Vercel Firewall rules enforce at the edge,
 * so the advertised RateLimit headers, this process-local limiter and the
 * firewall now tell one story. The previous 90/minute header promised capacity
 * the edge would deny at 12.
 */
const AGENT_CONTROL_LIMITER = new FixedWindowLimiter({
  limit: 12,
  windowMs: 60_000,
  maxKeys: 5_000,
});

export function consumeAgentControlRequest(headers: Headers) {
  return AGENT_CONTROL_LIMITER.consume(`agent-control:${clientIp(headers)}`);
}

/*
 * Reading is not acting, and they must not share a budget.
 *
 * Opening the Swap card spends three of the twelve above before a person has
 * typed anything — holdings, the token catalogue, a first quote. Editing an
 * amount twice and searching the picker once exhausts an ordinary session
 * inside a minute, and what then fails is the *action*: the quote returns 429,
 * and the surface used to blame the venue for it.
 *
 * So the reads get their own window, on the same IP key. It is wider because
 * these calls are cheap and idempotent, and it is still bounded because an
 * unbounded read path is a way to spend somebody else's provider quota. The
 * tight window above stays exactly as it is for everything that builds, signs,
 * submits or burns.
 *
 * 120, since Spot (2026-09-12): one terminal polls the market every fifteen
 * seconds and the candles about as often, re-reads the list every minute,
 * reads holdings and fills after a fill, and quotes on every settled
 * keystroke — a second tab doubles it. At 60 the second market a person
 * clicked answered 429 on production and the header read *Price feed
 * unavailable* for a price the same route served a second later. Every one of
 * these reads is served from a server-side cache measured in seconds to
 * minutes, so the provider sees a fraction of them.
 */
const SOLANA_READ_LIMITER = new FixedWindowLimiter({
  limit: 120,
  windowMs: 60_000,
  maxKeys: 5_000,
});

export function consumeSolanaReadRequest(headers: Headers) {
  return SOLANA_READ_LIMITER.consume(`solana-read:${clientIp(headers)}`);
}

/*
 * An evidence read may cost money, so it does not share the reads' window.
 *
 * `/api/v1/research/evidence` is public — the asset page is — and behind it
 * a miss is a paid call to the evidence provider, bounded by the credit
 * governor. The governor is the ceiling on spend; this window is the ceiling
 * on one address's share of it: twenty a minute is more than a person opening
 * assets by hand and less than a loop.
 * Cached reads land on the same budget on purpose, so a scripted refresh of
 * one asset cannot starve the governor of its cache window either.
 */
const EVIDENCE_READ_LIMITER = new FixedWindowLimiter({
  limit: 20,
  windowMs: 60_000,
  maxKeys: 5_000,
});

export function consumeEvidenceReadRequest(headers: Headers) {
  return EVIDENCE_READ_LIMITER.consume(`evidence-read:${clientIp(headers)}`);
}

/*
 * Pictures are not reads, and they must not share the reads' budget either.
 *
 * A market list of 150 rows asks for up to 150 icons, and the image optimiser
 * in front of the icon route forwards the client's own headers, so each of
 * those landed on the person's read budget above. Measured on production on
 * 2026-09-12: about a hundred icon requests on one page load, then the market
 * detail — the price a person was about to trade at — refused with 429. The
 * icon route is cached at the edge for a day and bounded per upstream host;
 * its own window is wide enough for a long list scrolled twice and still a
 * ceiling.
 */
const SPOT_ICON_LIMITER = new FixedWindowLimiter({
  limit: 600,
  windowMs: 60_000,
  maxKeys: 5_000,
});

export function consumeSpotIconRequest(headers: Headers) {
  return SPOT_ICON_LIMITER.consume(`spot-icon:${clientIp(headers)}`);
}

export type AgentControlUpstreamSlot =
  | Readonly<{ allowed: false; retryAfterSeconds: number }>
  | Readonly<{ allowed: true; release: () => void }>;

type WarmInstanceConcurrencyGateOptions = Readonly<{
  limit: number;
  retryAfterSeconds: number;
}>;

function positiveSafeInteger(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new TypeError(`${label} must be a positive safe integer`);
  }
  return value;
}

/**
 * Non-queuing warm-instance concurrency gate for fixed upstream reads.
 * Project-global controls remain a separate production layer.
 */
export class WarmInstanceConcurrencyGate {
  readonly limit: number;
  readonly retryAfterSeconds: number;
  private active = 0;

  constructor(options: WarmInstanceConcurrencyGateOptions) {
    this.limit = positiveSafeInteger(options.limit, "limit");
    this.retryAfterSeconds = positiveSafeInteger(
      options.retryAfterSeconds,
      "retryAfterSeconds",
    );
  }

  get inFlight(): number {
    return this.active;
  }

  acquire(): AgentControlUpstreamSlot {
    if (this.active >= this.limit) {
      return { allowed: false, retryAfterSeconds: this.retryAfterSeconds };
    }

    this.active += 1;
    let released = false;
    return {
      allowed: true,
      release: () => {
        if (released) return;
        released = true;
        this.active -= 1;
      },
    };
  }
}

const AGENT_CONTROL_UPSTREAM_GATE = new WarmInstanceConcurrencyGate({
  limit: AGENT_CONTROL_MAX_CONCURRENT_UPSTREAM_READS,
  retryAfterSeconds: AGENT_CONTROL_UPSTREAM_RETRY_AFTER_SECONDS,
});

export function acquireAgentControlUpstreamReadSlot(): AgentControlUpstreamSlot {
  return AGENT_CONTROL_UPSTREAM_GATE.acquire();
}

export type BoundedJsonResult =
  | { ok: true; value: unknown }
  | { ok: false; status: 400 | 413 | 415; code: string };

export async function readAgentControlJson(
  request: Request,
  maxBytes = AGENT_CONTROL_MAX_BODY_BYTES,
  signal?: AbortSignal,
): Promise<BoundedJsonResult> {
  const contentType = (request.headers.get("content-type") ?? "")
    .split(";", 1)[0]
    .trim()
    .toLowerCase();
  if (contentType !== "application/json") {
    return { ok: false, status: 415, code: "JSON_REQUIRED" };
  }

  const declared = request.headers.get("content-length");
  if (declared !== null) {
    const bytes = Number(declared);
    if (!Number.isSafeInteger(bytes) || bytes < 0) {
      return { ok: false, status: 400, code: "INVALID_CONTENT_LENGTH" };
    }
    if (bytes > maxBytes) return { ok: false, status: 413, code: "BODY_TOO_LARGE" };
  }

  if (!request.body) return { ok: false, status: 400, code: "BODY_REQUIRED" };
  const reader = request.body.getReader();
  const cancel = () => { void reader.cancel(signal?.reason).catch(() => {}); };
  signal?.addEventListener("abort", cancel, { once: true });
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    signal?.throwIfAborted();
    while (true) {
      const { done, value } = await reader.read();
      signal?.throwIfAborted();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        try {
          await reader.cancel("request body exceeded the bounded limit");
        } catch {
          // The 413 remains authoritative if cancellation races with the stream.
        }
        return { ok: false, status: 413, code: "BODY_TOO_LARGE" };
      }
      chunks.push(value);
    }
  } catch {
    return { ok: false, status: 400, code: "INVALID_BODY_STREAM" };
  } finally {
    signal?.removeEventListener("abort", cancel);
    reader.releaseLock();
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return { ok: true, value: JSON.parse(text) as unknown };
  } catch {
    return { ok: false, status: 400, code: "INVALID_JSON" };
  }
}
