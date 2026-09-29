/**
 * @ryntra/tokenized-stocks — the model of a tokenized stock on Solana.
 *
 * Four questions a venue has to answer before it shows a price for a stock
 * token, each answered by a pure function over facts the caller has already
 * read from the chain or from the issuer:
 *
 * - **what is it** — a listed equity or ETF, or pre-IPO exposure; priced per
 *   underlying share or per token; with which rights (`instrument.ts`);
 * - **what does one unit mean** — the Scaled UI Amount multiplier turns a raw
 *   balance into the units a holder economically owns, with integer
 *   arithmetic and never a multiplier applied twice (`units.ts`);
 * - **is the reference current** — a reference price's state against the
 *   exchange session, judged from the source's own observation time
 *   (`session.ts`);
 * - **does the issuer still support it** — the token's life from a chain
 *   pause, a verified issuer notice or the issuer's catalogue
 *   (`instrument.ts`, `lifecycle-events.ts`).
 *
 * The modules are the ones the Ryntra product runs on, imported rather than
 * copied. Nothing here fetches, signs or builds a transaction.
 */

export {
  INSTRUMENT_CLASS_WORDS,
  LIFECYCLE_UNKNOWN,
  LIFECYCLE_WORDS,
  NO_FEE_CAP_RAW,
  RIGHTS_WORDS,
  UNIT_WORDS,
  lifecycleOf,
  markPremiumPct,
  transferFeeOf,
  type Instrument,
  type InstrumentClass,
  type IssuerMark,
  type Lifecycle,
  type LifecycleEvent,
  type LifecycleState,
  type RightsKind,
  type TransferFee,
  type TransferFeeConfigData,
  type UnitBasis,
} from "../../../lib/stocks/instrument.ts";

export { LIFECYCLE_EVENTS, LIFECYCLE_EVENTS_VERSION, lifecycleEventFor } from "../../../lib/stocks/lifecycle-events.ts";

export {
  ACTIVATION_WINDOW_MS,
  STOCK_QUOTE_PRESETS_USD,
  baseAmountString,
  deviationPct,
  isScaledMultiplier,
  multiplierFromChain,
  multiplierFromMint,
  multiplierRatio,
  multiplierState,
  perShareExecutable,
  perShareFromTokenPrice,
  rawFromScaledRaw,
  scaledAmountString,
  type Multiplier,
  type MultiplierState,
} from "../../../lib/stocks/units.ts";

export {
  REFERENCE_STALE_AFTER_MS,
  REFERENCE_STATE_WORDS,
  REFERENCE_UNAVAILABLE,
  SESSION_WORDS,
  UNKNOWN_SESSION,
  referenceJudgedAt,
  referenceState,
  referenceStateOf,
  sessionFromIssuer,
  type Reference,
  type ReferenceState,
  type Session,
  type SessionPeriod,
} from "../../../lib/stocks/session.ts";
