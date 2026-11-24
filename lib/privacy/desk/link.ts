/**
 * How the person reaches the desk: three calls, each answered once.
 *
 * 1. `quote` — a firm price for exactly this amount, naming the desk's one-time address (`quote.ts`).
 * 2. `take` — taken within the firm window; the desk starts proving its own leg and holds the price until `fillUntil`.
 * 3. `fill` — the person hands over their own leg (built and proved in their browser, unsigned); the desk joins both legs
 *    into one transaction, signs its part and gives it back (`joint.ts`). The person checks it and their wallet signs.
 *
 * Nothing here carries a key: the person's leg is an unsigned transaction whose proof is already made; the desk's
 * answer is a transaction the desk's one-time address signed. The browser's desk is an HTTP service at `DESK_URL`; the devnet probe runs the desk in place (`desk.ts`).
 */

import { quoteFromWire, quoteToWire, type Ask, type Quote } from './quote.ts';

export type DeskLink = Readonly<{
  quote(ask: Ask): Promise<Quote>;
  take(id: string): Promise<Quote>;
  /** `leg` — the person's own leg, the unsigned wire transaction as base64; answers the joint transaction, desk-signed, base64. */
  fill(id: string, leg: string): Promise<string>;
}>;

/** The desk's refusal, in its own code (`QuoteRefusal`, `LegCode`, `EXPIRED`, `NO_QUOTE`, `NO_KEY`), or a desk that did not answer (`NO_ANSWER`). */
export class DeskRefused extends Error {
  readonly code: string;
  constructor(code: string, message?: string) {
    super(message ?? code);
    this.code = code;
  }
}

/** The desk's refusals that mean «not this pair now», not «something went wrong». */
const NOT_NOW: ReadonlySet<string> = new Set(['NO_STOCK', 'SMALL', 'NO_PRICE', 'STALE_PRICE', 'PAIR', 'SAME']);

/** A refusal of the desk as the Swap says it: the price ran out, not this pair now, or anything else the desk said. */
export function refusalCode(code: string): 'DESK_EXPIRED' | 'DESK_NOT_NOW' | 'DESK_REFUSED' {
  if (code === 'EXPIRED') return 'DESK_EXPIRED';
  return NOT_NOW.has(code) ? 'DESK_NOT_NOW' : 'DESK_REFUSED';
}

/** How long the browser waits for one answer of the desk; a proof on the desk's side is inside `take`/`fill`. */
export const DESK_DEADLINE_MS = 30_000;

/** The desk as an HTTP service: `POST {url}/quote`, `/take`, `/fill`, JSON both ways. */
export function httpDesk(url: string, fetchImpl: typeof fetch = fetch): DeskLink {
  const call = async (path: string, body: unknown): Promise<Record<string, unknown>> => {
    let answer: Response;
    try {
      answer = await fetchImpl(`${url}${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
        cache: 'no-store',
        signal: AbortSignal.timeout(DESK_DEADLINE_MS),
      });
    } catch (error) {
      throw new DeskRefused('NO_ANSWER', error instanceof Error ? error.message : String(error));
    }
    const json = (await answer.json().catch(() => null)) as Record<string, unknown> | null;
    if (!answer.ok || !json) throw new DeskRefused(typeof json?.code === 'string' ? json.code : 'NO_ANSWER');
    return json;
  };
  const quoted = (json: Record<string, unknown>): Quote => {
    const quote = quoteFromWire(json.quote);
    if (!quote) throw new DeskRefused('NO_ANSWER', 'not a quote');
    return quote;
  };
  return {
    quote: async (ask) => quoted(await call('/quote', { owner: ask.owner, inMint: ask.inMint, outMint: ask.outMint, inRaw: ask.inRaw.toString() })),
    take: async (id) => quoted(await call('/take', { id })),
    fill: async (id, leg) => {
      const json = await call('/fill', { id, leg });
      if (typeof json.joint !== 'string' || json.joint.length === 0) throw new DeskRefused('NO_ANSWER', 'no transaction');
      return json.joint;
    },
  };
}

/** A quote as the desk's HTTP answer carries it — for a desk service built on `desk.ts`. */
export function quoteAnswer(quote: Quote): Readonly<{ quote: ReturnType<typeof quoteToWire> }> {
  return { quote: quoteToWire(quote) };
}
