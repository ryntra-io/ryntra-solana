/**
 * What kind of instrument a stock token is — the part of the model that
 * keeps four different things from being read as one:
 *
 * - the **issuer** (who stands behind the mint) from the **instrument class**
 *   (a listed equity or ETF, or exposure to a company that has not gone
 *   public);
 * - the **unit** a price is quoted in: an underlying share, where the issuer's
 *   catalogue states one token is one share, or one token as the wallet shows
 *   it, where no such statement holds;
 * - the **rights** a holder has, in the issuer's own words, from the token's
 *   price;
 * - the token's **life** — whether new purchases are still what the issuer
 *   supports — from the fact that its mint exists and a pool still quotes it.
 *
 * Everything here is pure. The chain facts (transfer fee, pause) arrive
 * already read; the issuer facts arrive from the catalogue readers; the
 * verified lifecycle events live in `lifecycle-events.ts`.
 */

/** A listed equity or ETF on an exchange, or exposure to a private company before an IPO. */
export type InstrumentClass = "listed-equity" | "pre-ipo";

/**
 * The unit one price stands for. `share`: the issuer's catalogue states the
 * scaled token is one underlying share (xStocks) or the token's own naming
 * implies it and the venue prices it that way (Backpack, Ondo). `token`: one
 * token as the wallet shows it — the only unit an issuer of pre-IPO exposure
 * has stated in a way Ryntra can check.
 */
export type UnitBasis = "share" | "token";

/**
 * What a holder has, by the issuer's own documents — never a legal opinion
 * for every jurisdiction. `issuer-terms`: the issuer's terms state the rights
 * (the listed-equity issuers). `economic-exposure`: PreStocks — price
 * exposure to a private company through a holding entity, no ownership,
 * voting, dividend or information rights. (The contract keeps one more value
 * for records written before canon v5.2 В26; no answer carries it now.)
 */
export type RightsKind = "issuer-terms" | "economic-exposure";

export type Instrument = Readonly<{ class: InstrumentClass; unitBasis: UnitBasis; rights: RightsKind }>;

/* -------------------------------------------------------------- transfer fee */

export type TransferFee = Readonly<{
  /** The fee the mint withholds on every transfer, in basis points — the config in force for the epoch given. */
  basisPoints: number;
  /** The most the mint withholds on one transfer, in raw units; `u64::MAX` means no cap. */
  maximumFeeRaw: string;
  /** Which of the two configs is in force: the newer one, the older one, or the newer one assumed because the epoch is unknown. */
  configUsed: "NEWER" | "OLDER";
  /** The epoch the choice was made on; null when the chain's epoch was not read. */
  epoch: string | null;
  /** A config that has not taken effect yet: the fee that starts at `fromEpoch`. */
  pending: Readonly<{ basisPoints: number; maximumFeeRaw: string; fromEpoch: string }> | null;
  source: "chain";
}>;

/** The two configs a mint stores, as plain data (`asset.server.ts` reads them off the decoded extension). */
export type TransferFeeConfigData = Readonly<{
  older: Readonly<{ epoch: string; basisPoints: number; maximumFeeRaw: string }>;
  newer: Readonly<{ epoch: string; basisPoints: number; maximumFeeRaw: string }>;
}>;

/**
 * The transfer fee a mint charges, from its own `TransferFeeConfig` and the
 * current epoch, on the token program's rule — the same one the kernel's
 * `computeTransferFee` applies to an amount (`lib/solana/preflight.ts`, pinned
 * against it in the tests): the older config while the epoch is before the
 * newer one's, the newer config from then on, and the newer config assumed
 * when the epoch is unknown — recorded as `epoch: null`, never hidden. A
 * config whose epoch has not come is pending.
 */
export function transferFeeOf(config: TransferFeeConfigData | null, epoch: bigint | null): TransferFee | null {
  if (config === null) return null;
  const useOlder = epoch !== null && epoch < BigInt(config.newer.epoch);
  const chosen = useOlder ? config.older : config.newer;
  return {
    basisPoints: chosen.basisPoints,
    maximumFeeRaw: chosen.maximumFeeRaw,
    configUsed: useOlder ? "OLDER" : "NEWER",
    epoch: epoch === null ? null : epoch.toString(),
    pending: useOlder ? { basisPoints: config.newer.basisPoints, maximumFeeRaw: config.newer.maximumFeeRaw, fromEpoch: config.newer.epoch } : null,
    source: "chain",
  };
}

/** `u64::MAX`, the value the extension stores for "no cap". */
export const NO_FEE_CAP_RAW = "18446744073709551615";

/* ---------------------------------------------------------------- lifecycle */

/**
 * Where a token stands in its issuer's life for it.
 *
 * - `active`: the issuer lists the mint today and nothing on chain stops a transfer;
 * - `paused`: the mint's own `PausableConfig` is paused — no transfer of any kind clears;
 * - `conversion-open`: the issuer has opened a conversion (an IPO, an acquisition) — a purchase now buys a token in a window the issuer will close;
 * - `redeem-only`: the issuer has opened redemption — the token is to be redeemed, not bought;
 * - `expired`: the issuer's window has closed — the issuer supports the token no longer;
 * - `unknown`: no source said.
 *
 * `tradable` is about **new purchases through Ryntra**: a paused, redeem-only
 * or expired token is not offered as an ordinary buy, whatever a pool still
 * quotes. Holdings and history stay visible; a sale is a person's own
 * decision on the token they hold and is not refused here.
 */
export type LifecycleState = "active" | "paused" | "conversion-open" | "redeem-only" | "expired" | "unknown";

export type Lifecycle = Readonly<{
  state: LifecycleState;
  /** Whether Ryntra offers a new purchase of this token. */
  tradable: boolean;
  /** Who stated the state: the chain (a pause), the issuer's catalogue (listed today), a verified event, or nobody. */
  source: "chain" | "issuer-catalogue" | "event-registry" | "none";
  /** When the source observed the fact; null when the source states no time. */
  observedAt: string | null;
  /** The issuer's own notice, when the state comes from a verified event. */
  url: string | null;
  /** When the recorded event is due for another look; null when the state is read live. */
  recheckBy: string | null;
  /** The issuer's own deadline for the window — a conversion or redemption cut-off, ISO — when the notice states one. */
  deadline: string | null;
  /** One sentence for a person, when the state needs one. */
  note: string | null;
}>;

export const LIFECYCLE_UNKNOWN: Lifecycle = { state: "unknown", tradable: true, source: "none", observedAt: null, url: null, recheckBy: null, deadline: null, note: null };

/** A verified issuer event about one mint, kept in the versioned registry (`lifecycle-events.ts`). */
export type LifecycleEvent = Readonly<{
  mint: string;
  state: Exclude<LifecycleState, "unknown" | "active" | "paused">;
  /** The issuer's own notice. */
  url: string;
  /** When Ryntra read the notice. */
  observedAt: string;
  /** When the state is due for another look — a window's end, or a date to re-read the notice. */
  recheckBy: string;
  /** The issuer's own cut-off for the window, ISO, when the notice states one. */
  deadline: string | null;
  note: string;
  /**
   * What a holder reads and does about the event (the IPO and conversion
   * watch, `conversion-watch.ts`): the token's symbol as the issuer names it —
   * said even once the issuer's catalogue no longer lists the token — the
   * company, why the window opened, and the token the issuer points the swap
   * to. Absent on an event the watch does not speak about.
   */
  watch?: ConversionWatch;
}>;

/** The words and the one action of a conversion event (canon v5.2 В27, §7, §11). */
export type ConversionWatch = Readonly<{
  /** The token's symbol, as the issuer names it («SPACEX»). */
  symbol: string;
  /** The company, as a person names it («SpaceX»). */
  company: string;
  /** Why the window opened: the company went public, or another company bought it. */
  cause: Readonly<{ kind: "ipo" }> | Readonly<{ kind: "acquisition"; acquirer: string }>;
  /** The token the issuer points the swap to — the one action's target; null when the issuer names none Ryntra offers. */
  into: Readonly<{ mint: string; symbol: string; company: string }> | null;
  /** The issuer's own word on how the swap works, when it published one — read by Ryntra, dated. */
  mechanics: Readonly<{ url: string; publishedAt: string; readAt: string }> | null;
}>;

/**
 * A registered event's state at a moment: a window the issuer stated a
 * cut-off for is over once the clock passes it, whatever the registry still
 * says. Without a clock the registry's word stands. The universe, the swap
 * routes and the watch read the event through this one door, so a purchase
 * the page no longer offers is not quoted either.
 */
export function eventStateAt(event: LifecycleEvent, nowMs?: number): LifecycleEvent["state"] {
  const past = event.deadline !== null && nowMs !== undefined && Date.parse(event.deadline) <= nowMs;
  return past && event.state === "conversion-open" ? "expired" : event.state;
}

/**
 * The lifecycle of a mint from three facts, in order of strength: a chain
 * pause stops everything; a verified issuer event says what the issuer
 * supports now; an issuer catalogue that lists the mint today says it is
 * offered. A tag-only representation without an event is `unknown` and still
 * tradable — the venue's list is the only fact, and it does not say
 * otherwise.
 */
export function lifecycleOf(input: Readonly<{ paused: boolean | null; event: LifecycleEvent | null; listedByIssuer: boolean; catalogueFetchedAt: string | null; chainObservedAt: string | null; /** The clock, for a window with a stated cut-off. */ nowMs?: number }>): Lifecycle {
  if (input.paused === true) {
    return { state: "paused", tradable: false, source: "chain", observedAt: input.chainObservedAt, url: null, recheckBy: null, deadline: null, note: "The issuer has paused every transfer of this token." };
  }
  if (input.event) {
    const state = eventStateAt(input.event, input.nowMs);
    return {
      state,
      tradable: state === "conversion-open",
      source: "event-registry",
      observedAt: input.event.observedAt,
      url: input.event.url,
      recheckBy: input.event.recheckBy,
      deadline: input.event.deadline,
      note: input.event.note,
    };
  }
  if (input.listedByIssuer) {
    return { state: "active", tradable: true, source: "issuer-catalogue", observedAt: input.catalogueFetchedAt, url: null, recheckBy: null, deadline: null, note: null };
  }
  return LIFECYCLE_UNKNOWN;
}

/* ---------------------------------------------------------------- the mark */

/**
 * The issuer's own figures for a pre-IPO token — its mark of one token and
 * of the company. Neither is a market reference: the issuer states no
 * observation time for them, they are the issuer's derivation from its own
 * sources, and a plan's reference rule does not read them. They are shown
 * as *the issuer's mark*, dated by Ryntra's fetch, never as a fair price.
 */
export type IssuerMark = Readonly<{
  source: Readonly<{ id: "issuer-prestocks"; label: string }>;
  /** The issuer's mark of one token, USD. */
  perUnit: number | null;
  /** The issuer's mark of the company's valuation, USD. */
  valuationUsd: number | null;
  /** PreStocks: the valuation the token's own market price implies — the issuer's derivation. */
  impliedValuationUsd: number | null;
  /** Tokens in circulation as the issuer counts them (PreStocks: scaled units). */
  supply: number | null;
  /** Holders as the issuer counts them; PreStocks publishes no count, so null — the field stays for the contract's readers. */
  holders: number | null;
  /** The issuer states no observation time; only the fetch is dated. */
  observedAt: null;
  fetchedAt: string;
  /** True when the catalogue copy is older than its freshness window and served under grace. */
  stale: boolean;
}>;

/**
 * The token's market price against the issuer's mark of one token, in
 * per cent — context for orientation (a premium or a discount to the
 * issuer's own figure), never a deviation from a market reference and
 * never a reason to trade.
 */
export function markPremiumPct(priceUsd: number | null, markPerUnit: number | null): number | null {
  if (priceUsd === null || markPerUnit === null) return null;
  if (!Number.isFinite(priceUsd) || !Number.isFinite(markPerUnit) || markPerUnit <= 0 || priceUsd <= 0) return null;
  return (priceUsd / markPerUnit - 1) * 100;
}

/* -------------------------------------------------------------------- words */

type Bi = Readonly<{ en: string; uk: string }>;

export const INSTRUMENT_CLASS_WORDS: Readonly<Record<InstrumentClass, Bi>> = {
  "listed-equity": { en: "Listed", uk: "Лістинг" },
  "pre-ipo": { en: "Pre-IPO", uk: "До IPO" },
};

export const UNIT_WORDS: Readonly<Record<UnitBasis, Readonly<{ per: Bi; plural: Bi }>>> = {
  share: { per: { en: "per share", uk: "за акцію" }, plural: { en: "shares", uk: "акцій" } },
  token: { per: { en: "per token", uk: "за токен" }, plural: { en: "tokens", uk: "токенів" } },
};

/** One sentence on the rights, in the issuer's own terms; the issuer's document is linked beside it. */
export const RIGHTS_WORDS: Readonly<Record<RightsKind, Readonly<{ title: Bi; body: Bi }>>> = {
  "issuer-terms": {
    title: { en: "As the issuer's terms state", uk: "Визначає емітент" },
    body: { en: "not a brokerage account · availability by jurisdiction", uk: "не брокерський рахунок · доступність за юрисдикцією" },
  },
  "economic-exposure": {
    title: { en: "Price exposure, not a share", uk: "Цінова прив'язка, не акція" },
    body: {
      en: "The issuer states the token gives economic exposure to the private company through a holding entity — no ownership, voting, dividend or information rights; not available to U.S. persons.",
      uk: "Емітент зазначає: токен дає економічну прив'язку до приватної компанії через холдингову структуру — без прав власності, голосу, дивідендів чи інформації; недоступно особам США.",
    },
  },
};

export const LIFECYCLE_WORDS: Readonly<Record<LifecycleState, Bi>> = {
  active: { en: "Offered by the issuer", uk: "Пропонується емітентом" },
  paused: { en: "Transfers paused by the issuer", uk: "Перекази зупинені емітентом" },
  "conversion-open": { en: "Conversion open — the issuer's window applies", uk: "Відкрито конвертацію — діє вікно емітента" },
  "redeem-only": { en: "Redemption only — not offered for purchase", uk: "Лише погашення — купівля не пропонується" },
  expired: { en: "Expired — no longer supported by the issuer", uk: "Строк минув — емітент більше не підтримує" },
  unknown: { en: "Life state not stated", uk: "Стан не зазначено" },
};
