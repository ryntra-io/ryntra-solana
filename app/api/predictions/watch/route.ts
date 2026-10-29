import { z } from "zod";

import { clientIp, FixedWindowLimiter, rateLimitHeaders } from "@/lib/http-control";
import { predictionFailure, predictionJson, readPredictionBody, requirePredictionActor } from "@/lib/predictions/http";
import { failure } from "@/lib/predictions/failure";
import { predictionsLocale } from "@/lib/predictions/locale.server";
import { predictionTransports } from "@/lib/predictions/notify/transports.server";
import { watchExplainer } from "@/lib/predictions/watch/explain.server";
import { sweepWatch } from "@/lib/predictions/watch/run";
import { normalizeRule, ruleComplete, ruleFromWords, WatchRuleInputSchema, WatchSubjectSchema } from "@/lib/predictions/watch/rules";
import { markSignalsRead, putWatchRule, removeWatchRule, setWatchRuleOn, stopEveryWatchRule } from "@/lib/predictions/watch/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const RuleId = z.string().regex(/^[0-9a-f]{6,64}$/);

const Body = z
  .object({
    /** A rule the person set by hand, or confirmed after dictating it. Watching starts with it. */
    set: WatchRuleInputSchema.optional(),
    /** Words to read into a rule. Nothing is watched: the shape comes back for the person to confirm. */
    words: z.string().min(1).max(400).optional(),
    /** The market the words are about; required with `words`. */
    subject: WatchSubjectSchema.optional(),
    /** One rule on or off. */
    ruleId: RuleId.optional(),
    on: z.boolean().optional(),
    /** One rule gone, rules and signals with it. */
    remove: RuleId.optional(),
    /** One touch: every rule of the wallet off. */
    stop: z.literal(true).optional(),
    /** Signal ids the person has read, or `true` for every one of them. */
    read: z.union([z.array(RuleId).max(80), z.literal(true)]).optional(),
    /** Run the pass for this wallet now, rather than waiting for the schedule. */
    check: z.literal(true).optional(),
  })
  .strict()
  .refine((body) => Object.keys(body).length > 0, { message: "Say what to change." })
  .refine((body) => body.words === undefined || body.subject !== undefined, { message: "Words need the market they are about." })
  .refine((body) => body.on === undefined || body.ruleId !== undefined, { message: "Name the rule to turn on or off." });

/**
 * What the wallet is watching and what its watches have found.
 *
 * A read is a read: the rules and the signals come back as the store holds
 * them, nothing is judged and nothing is sent. Looking at the page never
 * raises a signal — the schedule does that, so the answer is the same whether
 * or not anybody is looking.
 */
export async function GET(request: Request) {
  const resolved = await requirePredictionActor(request, "read");
  if (!resolved.ok) return resolved.response;
  const { actor } = resolved;
  const swept = await sweepWatch(actor.store, actor.provider, actor.wallet, process.env, Date.now(), { judge: false, locale: await predictionsLocale() });
  return swept.ok ? predictionJson(swept.value) : predictionFailure(swept);
}

/**
 * A warm instance's bound on «check now»: the schedule does the watching, and
 * a press is a convenience, not a way to make the provider answer in a loop.
 */
const checks = new FixedWindowLimiter({ limit: 4, windowMs: 60_000, maxKeys: 5_000 });

/**
 * Setting a watch, changing one, stopping them all, reading the signals, or
 * asking for a pass now.
 *
 * `words` is the dictated path: the sentence is read into the same rule shape
 * by a parser, not by a model, so the same words always give the same rule —
 * and the rule comes back for the person to look at. Nothing is watched until
 * they send it as `set`.
 */
export async function POST(request: Request) {
  const resolved = await requirePredictionActor(request, "mutation");
  if (!resolved.ok) return resolved.response;
  const read = await readPredictionBody(request, Body);
  if (!read.ok) return read.response;
  const { actor } = resolved;
  const body = read.body;
  const locale = await predictionsLocale();
  const now = Date.now();

  /* The dictated path answers on its own: a draft is a proposal, and it changes nothing. */
  if (body.words !== undefined && body.subject !== undefined) {
    const draft = ruleFromWords(body.words, body.subject);
    return predictionJson({ wallet: actor.wallet, draft: draft === null ? null : { ...draft, complete: ruleComplete(draft.rule) } });
  }

  if (body.set !== undefined) {
    const rule = normalizeRule(body.set);
    if (!ruleComplete(rule)) return predictionFailure(failure("VALIDATION_ERROR", "This watch is about one outcome; pick the side first."));
    const put = await putWatchRule(actor.store, actor.wallet, rule, now);
    if (!put.ok) return predictionFailure(put.code === "limit" ? failure("VALIDATION_ERROR", "You are watching as many markets as one account holds; remove a watch first.") : failure("UNAVAILABLE", "The watch could not be written; try again."));
  }
  if (body.remove !== undefined) await removeWatchRule(actor.store, actor.wallet, body.remove);
  if (body.ruleId !== undefined && body.on !== undefined) await setWatchRuleOn(actor.store, actor.wallet, body.ruleId, body.on, now);
  if (body.stop === true) await stopEveryWatchRule(actor.store, actor.wallet, now);
  if (body.read !== undefined) await markSignalsRead(actor.store, actor.wallet, body.read === true ? null : body.read, now);

  /* A press that would make the provider answer too often is refused; the schedule keeps watching either way. */
  const rate = body.check === true ? checks.consume(actor.wallet || clientIp(request.headers)) : null;
  if (rate && !rate.allowed) return predictionFailure(failure("RATE_LIMITED", "The watch was checked a moment ago; it runs on its own schedule.", { retryAfterSeconds: 60 }));
  const swept = await sweepWatch(actor.store, actor.provider, actor.wallet, process.env, now, {
    judge: body.check === true && rate?.allowed === true,
    locale,
    ...(body.check === true ? { transports: predictionTransports(actor.store), explain: watchExplainer({ store: actor.store }) ?? undefined } : {}),
  });
  return swept.ok ? predictionJson(swept.value, 200, rate ? rateLimitHeaders(rate) : {}) : predictionFailure(swept);
}
