"use client";
import Link from "next/link";
import { displayAmount } from "@/lib/solana/amounts";
import { additionalJupiterFeeBps, serviceFeeText, type RyntraServiceFee } from "@/lib/swap/service-fee";
import { useSolanaI18n } from "../i18n/provider";
export type SwapSide = Readonly<{
  mint: string;
  code: string;
  program: "SPL Token" | "Token-2022";
  /** Jupiter's catalogue claims, carried as claims and labelled as theirs. */
  listedUsd: string | null;
  listedVerified: boolean | null;
  listedSuspicious: boolean;
  /** What this wallet holds of it, already scaled, or null when unknown. */
  balance: string | null;
}>;

export type SwapFacts = Readonly<{
  /** The live quote's own numbers, or null while there is nothing quoted. */
  rate: number | null;
  priceImpactPct: string | null;
  slippageBps: number | null;
  minReceivedRaw: string | null;
  tradeUsdValue: string | null;
  platformFeeBasisPoints: number | null;
  /**
   * What Ryntra takes of this trade, whole: the rate, the asset the provider
   * states it in, the mechanism it travels, and whether it is being charged at
   * all. Null before there is a quote to read it from — and a zero is an answer,
   * not an absence.
   *
   * This replaced a bare `ryntraFeeBasisPoints`. Two fields for one fee is two
   * places for it to disagree, and the rate alone could not say whether the money
   * actually arrives.
   */
  ryntraFee: RyntraServiceFee | null;
  networkFeeSol: string | null;
  accountReserveSol: string | null;
  provider: string | null;
  route: readonly Readonly<{ label: string; basisPoints: number }>[];
  /** Seconds until this quote stops being one. */
  secondsLeft: number | null;
  quoting: boolean;
}>;


export function SwapContext({sell,buy,buyDecimals,facts}:{sell:SwapSide;buy:SwapSide;buyDecimals:number;facts:SwapFacts;tall:boolean}) {
 const {locale}=useSolanaI18n();const uk=locale==="uk";
 const provider=facts.provider?.split(",")[0]?.replace(/\s*(swap\s*)?api(\s*v?\d+)?\s*$/i,"").trim();
 const additionalFee = additionalJupiterFeeBps(facts.platformFeeBasisPoints, facts.ryntraFee);
 return <section className="ry-swap-details">
 {/*
   * Two links to the asset pages — and until now, two bare tickers with no
   * label, no underline and nothing marking them as links, sitting alone at the
   * foot of the card. `SOL   USDC`, which reads as something left behind rather
   * than somewhere to go. The label was only ever on the `aria-label`, so the
   * one audience that could tell what this row was for was the one that could
   * not see it.
   */}
 <nav aria-label={uk?"Відомості про активи":"Asset details"}><span>{uk?"Відомості про активи":"Asset details"}</span><Link href={"/app/assets?mint="+sell.mint}>{sell.code}</Link><Link href={"/app/assets?mint="+buy.mint}>{buy.code}</Link></nav>
 {/*
   * The costs of the thing being signed, in both depths.
   *
   * This was `pro && …`, so in Simple a person saw no minimum received, no
   * network fee, no account reserve and no executor — on the screen where
   * they decide whether to sign. Every one of them belongs to what a swap
   * shows, and a material fact is never hidden to reduce noise; the
   * repository’s own depth rule says the same thing from the other side —
   * depth is more data and more control, never fewer costs.
   *
   * `minReceivedRaw` still gates the block, and that gate is honest rather
   * than defensive: before Review the order carries no taker, so these
   * figures are genuinely unknown and showing a guess would be worse than
   * showing nothing.
   */}
 {facts.minReceivedRaw!==null?<dl>
 <div><dt>{uk?"Мінімум до отримання":"Minimum received"}</dt><dd>{displayAmount(facts.minReceivedRaw,buyDecimals)} {buy.code}</dd></div>
 {facts.slippageBps!==null?<div><dt>{uk?"Прослизання":"Slippage"}</dt><dd>{facts.slippageBps/100}%</dd></div>:null}
 {facts.networkFeeSol!==null?<div><dt>{uk?"Комісія мережі":"Network fee"}</dt><dd>{facts.networkFeeSol} SOL</dd></div>:null}
 {facts.accountReserveSol!==null?<div><dt>{uk?"Резерв для рахунку":"Account reserve"}</dt><dd>{facts.accountReserveSol} SOL</dd></div>:null}
 {additionalFee!==null && additionalFee>0?<div><dt>{uk?"Додаткова комісія Jupiter":"Additional Jupiter fee"}</dt><dd>{(additionalFee/100).toFixed(2)}%</dd></div>:null}
 {/* The referral fee is part of Jupiter's total, not an additional charge. */}
 {facts.ryntraFee!==null?<div><dt>{uk?"Комісія Ryntra":"Ryntra service fee"}</dt><dd>{serviceFeeText(facts.ryntraFee,uk?"Немає":"None")}</dd></div>:null}
 {provider?<div><dt>{uk?"Виконавець":"Provider"}</dt><dd>{provider}</dd></div>:null}
 {facts.route.length>0?<div><dt>{uk?"Маршрут":"Route"}</dt><dd>{facts.route.map(x=>x.label).join(" → ")}</dd></div>:null}
 </dl>:null}
 </section>;
}
