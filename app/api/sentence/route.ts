import { guestKeyFor } from "@/lib/assistant/guest";
import { getGuardRuntime } from "@/lib/guard/runtime";
import { storeSupportsConcurrentInstances } from "@/lib/guard/store";
import { clientIp, FixedWindowLimiter } from "@/lib/http-control";
import { allDayOf, guardSentenceMeter } from "@/lib/sentence/meter.server";
import { sentenceParserOf } from "@/lib/sentence/provider.server";
import { serveSentence } from "@/lib/sentence/serve";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 15;

/** A warm instance's burst bound per caller; the durable day is the meter's. */
const burst = new FixedWindowLimiter({ limit: 6, windowMs: 60_000, maxKeys: 5_000 });

/**
 * `POST /api/sentence` — the agent's line asks the model to sort one sentence into a plan
 * (`lib/sentence/serve.ts`). Off unless `RYNTRA_SENTENCE` is on and the assistant's provider is keyed; the
 * caller is a keyed digest of the day under the deployment's existing token secret, never an address.
 */
export async function POST(request: Request) {
  const secret = process.env.BETA_TOKEN_SECRET?.trim();
  const parser = sentenceParserOf(process.env);
  const guard = parser ? getGuardRuntime() : null;
  const shared = guard && guard.writes.allowed && storeSupportsConcurrentInstances(guard.store) ? guard.store : null;
  return serveSentence(
    {
      parser,
      meter: shared ? guardSentenceMeter(shared, allDayOf(process.env)) : null,
      callerOf: (req) => (secret ? guestKeyFor(clientIp(req.headers), secret, Date.now()) : null),
      burst: (caller) => burst.consume(caller).allowed,
      now: () => Date.now(),
    },
    request,
  );
}
