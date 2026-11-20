import { ISSUER_TERMS } from '../../lib/stocks/issuer-terms.ts';
import { offHoursRiskLine, type PoolFacts } from '../../lib/stocks/pool-facts.ts';

/**
 * What the one line before the signature of a position in a stock's pool says, decided apart from the markup.
 *
 * The line: the issuer's rights over its token (it can pause it and take it back, the pool included) — and, while the
 * exchange is not in its regular session, the chain's own risk line for it (`offHoursRiskLine`: the price stands still,
 * the open may jump). Behind «i»: where the issuer does not offer the token, as its terms say (`ISSUER_TERMS` — Ryntra
 * blocks no country; the terms are shown, never enforced), and the issuer's document. Facts not read yet say the issuer's
 * part only. Pure.
 */

export type StockLineView = Readonly<{
  /** The chain's off-hours risk line, in the language on screen; null while the exchange is open or nothing is read. */
  offHours: string | null;
  /** Where the issuer does not offer it, as one list; null where its terms name nowhere or the facts are not read. */
  excluded: string | null;
  /** Where it offers it only on its own conditions, as one list; null where none. */
  limited: string | null;
  /** The issuer's own document. */
  termsUrl: string | null;
}>;

export function stockLineOf(facts: PoolFacts | null | undefined, lang: 'en' | 'uk'): StockLineView {
  if (!facts?.isStock || !facts.issuer) return { offHours: null, excluded: null, limited: null, termsUrl: null };
  const terms = ISSUER_TERMS[facts.issuer.id] ?? null;
  const list = (entries: readonly Readonly<{ en: string; uk: string }>[]) => (entries.length ? entries.map((entry) => entry[lang]).join(' · ') : null);
  const excluded = terms ? list(terms.excluded) : null;
  return {
    offHours: offHoursRiskLine(facts, lang),
    excluded: excluded && terms?.also ? `${excluded} ${terms.also[lang]}` : excluded,
    limited: terms ? list(terms.limited) : null,
    termsUrl: facts.termsUrl,
  };
}

/** The line itself: the issuer's sentence, and the off-hours sentence after it where there is one. */
export const stockLineText = (issuerLine: string, view: StockLineView): string => (view.offHours ? `${issuerLine} ${view.offHours}` : issuerLine);
