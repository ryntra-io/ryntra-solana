/**
 * «Комісії» as rows of text (SOL-X1): Ryntra's own table read from the fee policy and the Rewards rules in force, the
 * parts every receipt shows, and the comparison with its sources. Pure — the page only draws what this returns, so a
 * rate cannot be typed into a sentence and drift from the code that charges it.
 */

import {
  BASE_FEE_LAMPORTS,
  BUILD_PRIORITY_CEILING_LAMPORTS,
  VENUES,
  launchPoolFee,
  onHundred,
  ryntraFlowRows,
  type OnHundred,
  type VenueRow,
} from "../../../lib/core/fee-comparison.ts";
import { FEE_POLICY_V2 } from "../../../lib/core/fee-policy.ts";
import { REWARD_RULES_CURRENT } from "../../../lib/rewards/rules.ts";
import { USD_MICROS_PER_USD } from "../../../lib/rewards/model.ts";
import { feesWords, type FeesWord } from "./fees-words.ts";

type Lang = "en" | "uk";
const NBSP = " ";

const localise = (figure: string, lang: Lang) => (lang === "uk" ? figure.replace(".", ",") : figure);

/**
 * Dollars to the cent, rounded against Ryntra: a cost up, a rebate down — so a figure here never flatters the
 * product, and a round trip's cost less its cashback is the net to the cent.
 */
export function usd(value: number, lang: Lang, round: "up" | "down" = "up"): string {
  if (value === 0) return "$0";
  const scaled = value * 100;
  const cents = round === "up" ? Math.ceil(scaled - 1e-9) : Math.floor(scaled + 1e-9);
  return `$${localise((cents / 100).toFixed(2), lang)}`;
}

/** A per cent without the sign, «0.5», «1», «0.25». */
function pctFigure(bps: number, lang: Lang): string {
  const value = bps / 100;
  return localise(Number.isInteger(value) ? value.toFixed(0) : value.toFixed(2).replace(/0$/, ""), lang);
}

export function pct(bps: number, lang: Lang): string {
  return `${pctFigure(bps, lang)}${NBSP}%`;
}

/** A range of rates under one sign, «0.1–1 %». */
function pctRange(low: number, high: number, lang: Lang): string {
  return low === high ? pct(low, lang) : `${pctFigure(low, lang)}–${pctFigure(high, lang)}${NBSP}%`;
}

const range = (low: string, high: string) => (low === high ? low : `${low}–${high}`);
const less = (value: number, lang: Lang) => (value === 0 ? "$0" : `−${usd(value, lang)}`);
/* The net is the rounded cost less the rounded cashback, so the three columns add up on the screen. */
const cents = (text: string) => (text === "$0" ? 0 : Math.round(Number(text.replace(/[^0-9.,]/g, "").replace(",", ".")) * 100));
/** A row's round trip after cashback: the rounded cost less the rounded-down cashback — one figure wherever it shows. */
const netRoundDollars = (row: Readonly<{ fee: OnHundred; cashback: OnHundred }>, lang: Lang) => (cents(usd(row.fee.round, lang)) - cents(usd(row.cashback.round, lang, "down"))) / 100;

export type FlowLine = Readonly<{ key: string; what: string; rate: string; buy: string; sell: string; round: string; back: string; net: string }>;

export function flowLines(lang: Lang): readonly FlowLine[] {
  const word = feesWords(lang);
  return ryntraFlowRows().map((row) => {
    /* A launch: $0 on top of the pool, and the pool's own fee — Ryntra's part inside it — shown beside it, never a bare $0. */
    if (row.pool) {
      const pool = row.pool;
      const dollars = (pick: keyof OnHundred) => word("launchDollars", { dollars: dollarsRange(pool.low, pool.high, pick, lang) });
      return {
        key: row.flow,
        what: word(`flow${row.flow}` as FeesWord),
        rate: word("launchRate", { pool: pctRange(pool.bps.low, pool.bps.high, lang), sniper: pct(launchPoolFee().sniperStartBps, lang) }),
        buy: dollars("buy"),
        sell: dollars("sell"),
        round: dollars("round"),
        back: "$0",
        net: dollars("round"),
      };
    }
    return {
    key: row.flow,
    what: word(`flow${row.flow}` as FeesWord),
    rate: row.bps === 0 ? "0" : pct(row.bps, lang),
    buy: less(row.fee.buy, lang),
    sell: less(row.fee.sell, lang),
    round: less(row.fee.round, lang),
    back: row.cashback.round === 0 ? "$0" : `+${usd(row.cashback.round, lang, "down")}`,
    net: less(netRoundDollars(row, lang), lang),
    };
  });
}

/** The «after cashback» column's name, with the Rewards rules version it is counted by. */
export function netColumnLabel(lang: Lang): string {
  return feesWords(lang)("colNet", { version: REWARD_RULES_CURRENT.version });
}

/** How a receipt's «same route without Ryntra's fee» is counted, in a sentence. */
export function methodLine(lang: Lang): string {
  return feesWords(lang)("method");
}

/** «−$1.00» under the table: the MEME buy's own figure, so the example cannot drift from the row. */
export function hundredNoteLine(lang: Lang): string {
  const meme = flowLines(lang).find((line) => line.key === "MEME");
  return feesWords(lang)("hundredNote", { example: (meme?.buy ?? "$0").replace(/^−/, "") });
}

/** The first minutes of a launch and its volatility fee, read from the presets; under the $100 table. */
export function launchNoteLine(lang: Lang): string {
  const fee = launchPoolFee();
  return feesWords(lang)("launchNote", {
    sniper: pct(fee.sniperStartBps, lang),
    curve: pct(fee.curve.baseBps, lang),
    curveMax: pct(fee.curve.withDynamicBps, lang),
    minutes: Math.ceil(fee.sniperSeconds / 60),
    sniperDollars: usd(onHundred(fee.sniperStartBps).buy, lang),
  });
}

/** Cashback is an accrual: when it is paid out, by the claim floor of the rules in force — or nothing without one. */
export function claimNoteLine(lang: Lang): string | null {
  const floor = REWARD_RULES_CURRENT.claimFloor;
  if (!floor) return null;
  const dollars = (micros: bigint) => usd(Number(micros) / Number(USD_MICROS_PER_USD), lang, "up");
  return feesWords(lang)("claimNote", { withAccount: dollars(floor.withAccountUsdMicros), withoutAccount: dollars(floor.withoutAccountUsdMicros) });
}

/** «Перші $10 назад» as the rules in force state it: how many wallets, how many days, the cap — or nothing without it. */
export function firstTenLine(lang: Lang): string | null {
  const rules = REWARD_RULES_CURRENT.firstTen;
  if (!rules) return null;
  return feesWords(lang)("firstTenNote", { wallets: rules.walletsPerMonth, days: rules.days, cap: `$${Number(rules.capUsdMicros / USD_MICROS_PER_USD)}` });
}

export function sameTokenLine(lang: Lang): string {
  const fee = launchPoolFee();
  return feesWords(lang)("sameToken", { spot: pct(FEE_POLICY_V2.MEME.bps, lang), poolStart: pct(fee.pool.startBps, lang), poolEnd: pctRange(fee.pool.endLowBps, fee.pool.endHighBps, lang) });
}

export type PartLine = Readonly<{ key: string; label: string; value: string }>;

export function partLines(lang: Lang): readonly PartLine[] {
  const word = feesWords(lang);
  const sol = (lamports: number) => `${localise((lamports / 1e9).toString(), lang)}${NBSP}SOL`;
  return [
    { key: "ryntra", label: word("partRyntra"), value: word("partRyntraIs") },
    { key: "protocol", label: word("partProtocol"), value: word("partProtocolIs") },
    { key: "network", label: word("partNetwork"), value: word("partNetworkIs", { base: sol(BASE_FEE_LAMPORTS) }) },
    { key: "priority", label: word("partPriority"), value: word("partPriorityIs", { ceiling: sol(BUILD_PRIORITY_CEILING_LAMPORTS) }) },
    { key: "tip", label: word("partTip"), value: word("partTipIs") },
    { key: "cashback", label: word("partCashback"), value: word("partCashbackIs", { pct: pct(REWARD_RULES_CURRENT.cashbackBps, lang) }) },
    { key: "quote", label: word("partQuote"), value: word("partQuoteIs") },
  ];
}

export type VenueLine = Readonly<{
  key: VenueRow["id"];
  name: string;
  interfaceFee: string;
  buy: string;
  round: string;
  after: string;
  note: string;
  sources: readonly Readonly<{ label: string; url: string | null; kind: string; readAt: string; via: string | null }>[];
}>;

function dollarsRange(low: OnHundred, high: OnHundred, pick: keyof OnHundred, lang: Lang): string {
  return range(usd(low[pick], lang), usd(high[pick], lang));
}

/** The launch row's note: its curve's and its pool's fees, read from the presets. */
function launchNoteVars(lang: Lang): Readonly<Record<string, string>> {
  const fee = launchPoolFee();
  return {
    curve: pct(fee.curve.baseBps, lang),
    curveMax: pct(fee.curve.withDynamicBps, lang),
    sniper: pct(fee.sniperStartBps, lang),
    poolStart: pct(fee.pool.startBps, lang),
    poolEnd: pctRange(fee.pool.endLowBps, fee.pool.endHighBps, lang),
  };
}

export function venueLines(lang: Lang): readonly VenueLine[] {
  const word = feesWords(lang);
  const date = (iso: string) => new Intl.DateTimeFormat(lang === "uk" ? "uk-UA" : "en-US", { dateStyle: "medium", timeZone: "UTC" }).format(new Date(`${iso}T00:00:00Z`));
  return VENUES.map((venue) => {
    const low = onHundred(venue.interfaceBps.low);
    const high = onHundred(venue.interfaceBps.high);
    /* A Ryntra launch's pool range holds after its sniper window: the cells say so, beside a venue that has none. */
    const firstMinutes = venue.id === "ryntra-launch" ? ` ${word("firstMinutes", { sniper: pct(launchPoolFee().sniperStartBps, lang) })}` : "";
    const pool = venue.poolBps ? ` ${word("plusPool", { pool: pctRange(venue.poolBps.low, venue.poolBps.high, lang) })}${firstMinutes}` : "";
    /* A rebate is a share of the fee, so the round trip after it is the round trip's fee by the same share. */
    const afterRound = (net: number, gross: number, fee: OnHundred) => (gross === 0 ? 0 : (fee.round * net) / gross);
    /* Ryntra's own «after» dollars are the $100 table's net for the same rates, so the page states one figure per trade. */
    const ownNet = (bps: number) => {
      const row = venue.id === "ryntra-spot" ? ryntraFlowRows().find((flow) => flow.bps === bps && flow.lane === "BUILD") : undefined;
      return row ? netRoundDollars(row, lang) : null;
    };
    const spotLow = venue.id === "ryntra-spot" ? ownNet(venue.interfaceBps.low) : null;
    const spotHigh = venue.id === "ryntra-spot" ? ownNet(venue.interfaceBps.high) : null;
    const after = venue.netBps && spotLow !== null && spotHigh !== null
      ? `${pctRange(venue.netBps.low, venue.netBps.high, lang)} · ${range(usd(spotLow, lang), usd(spotHigh, lang))}`
      : venue.netBps
      ? `${pctRange(venue.netBps.low, venue.netBps.high, lang)} · ${range(usd(afterRound(venue.netBps.low, venue.interfaceBps.low, low), lang), usd(afterRound(venue.netBps.high, venue.interfaceBps.high, high), lang))}`
      : word("noRebate");
    return {
      key: venue.id,
      name: venue.id === "ryntra-spot" || venue.id === "ryntra-launch" ? word(`name${venue.noteKey}` as FeesWord) : venue.name,
      interfaceFee: `${pctRange(venue.interfaceBps.low, venue.interfaceBps.high, lang)}${pool}`,
      /* A venue's own pool fee is what a trade there costs: its dollars are shown as the pool's, never as $0. */
      buy: venue.poolBps ? `${word("poolTag", { dollars: dollarsRange(onHundred(venue.poolBps.low), onHundred(venue.poolBps.high), "buy", lang) })}${firstMinutes}` : dollarsRange(low, high, "buy", lang),
      round: venue.poolBps ? `${word("poolTag", { dollars: dollarsRange(onHundred(venue.poolBps.low), onHundred(venue.poolBps.high), "round", lang) })}${firstMinutes}` : dollarsRange(low, high, "round", lang),
      after,
      note: word(`note${venue.noteKey}` as FeesWord, venue.noteKey === "ryntraLaunch" ? launchNoteVars(lang) : { pct: pct(REWARD_RULES_CURRENT.cashbackBps, lang) }),
      sources: venue.sources.map((source) => ({
        /* Ryntra's own sources by name and version in the reader's language — never a file path. */
        label: source.own ? word(`source${source.own}` as FeesWord, { version: source.version ?? "" }) : source.label,
        url: source.url,
        kind: word(`kind${source.kind}` as FeesWord),
        readAt: date(source.readAt),
        via: source.via === "SEARCH" ? word("viaSearch") : source.via === "DOCS" ? word("viaDocs") : null,
      })),
    };
  });
}
