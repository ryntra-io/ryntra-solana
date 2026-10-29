/**
 * The Exchange asks its executors at once and keeps every answer (B9).
 *
 * «Беремо 2–3 котировки паралельно, показуємо найкращу після всіх комісій і
 * пишемо, хто виконавець». This module does the first half: every
 * source that serves the pair is asked in parallel, each under its own deadline,
 * and every answer is kept — a quote, or a refusal that names the executor. The
 * ranking «after every cost» is the core screen's (`rankQuotes`, `@ryntra/core`
 * A9), with prices this build supplies beside the quotes; no executor is dropped
 * here for being worse.
 *
 * Pure: the sources carry the world. Relative imports only.
 */

import type { ExchangeFeeRoute, ExchangeQuote, ExchangeQuoteRequest, ExchangeQuoteSource, ExchangeRefusal } from "./contract.ts";

export type ExchangeQuotesAnswer = Readonly<{
  intentId: string;
  /** In the order the sources are listed: the screen ranks them, and keeps this order on a tie. */
  quotes: readonly ExchangeQuote[];
  /** Ryntra's fee with each executor that quoted — what was asked, and where it lands. */
  fees: readonly ExchangeFeeRoute[];
  /** Every executor that serves the pair and gave no quote, with why. */
  refusals: readonly ExchangeRefusal[];
}>;

/** Long enough for a cross-network quote on a slow minute, short enough that one silent executor never holds the others. */
export const EXCHANGE_SOURCE_DEADLINE_MS = 9_000;

export async function collectExchangeQuotes(
  request: ExchangeQuoteRequest,
  sources: readonly ExchangeQuoteSource[],
  options: Readonly<{ deadlineMs?: number }> = {},
): Promise<ExchangeQuotesAnswer> {
  const deadline = options.deadlineMs ?? EXCHANGE_SOURCE_DEADLINE_MS;
  const serving = sources.filter((source) => source.serves(request));
  const answers = await Promise.all(
    serving.map(async (source) => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const late = new Promise<null>((resolve) => {
        timer = setTimeout(() => resolve(null), deadline);
      });
      try {
        const answer = await Promise.race([source.quote(request), late]);
        if (answer === null) return { ok: false as const, refusal: { executor: source.executor, code: "UNAVAILABLE" as const, reason: `${source.executor} did not answer in time.` } };
        return answer;
      } catch {
        /* A source that throws is a source that did not answer; it never takes the others down. */
        return { ok: false as const, refusal: { executor: source.executor, code: "UNAVAILABLE" as const, reason: `${source.executor} could not be asked just now.` } };
      } finally {
        clearTimeout(timer);
      }
    }),
  );
  const quotes: ExchangeQuote[] = [];
  const fees: ExchangeFeeRoute[] = [];
  const refusals: ExchangeRefusal[] = [];
  for (const answer of answers) {
    if (answer.ok) {
      /* Every quote must answer this intent and arrive in the asked asset — the screen cannot rank anything else. */
      if (answer.quote.quote.intent_id !== request.intentId || answer.quote.quote.out_expected.asset.toLowerCase() !== request.to.asset.toLowerCase()) {
        refusals.push({ executor: answer.quote.executor, code: "NO_ROUTE", reason: `${answer.quote.executor} answered another exchange.` });
        continue;
      }
      quotes.push(answer.quote);
      fees.push(answer.fee);
    } else refusals.push(answer.refusal);
  }
  return { intentId: request.intentId, quotes, fees, refusals };
}
