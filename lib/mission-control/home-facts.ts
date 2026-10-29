/**
 * The facts under Mission Control's scene on the home page (MC-0): how a mission flies, who earns from it, what Meteora
 * gives it. Every figure is read from the Classic preset's terms (`lib/core/launch/preset-terms.ts`) — the same module
 * the launch form, its review and the creator's cabinet read — so the page can never say a share the chain does not
 * keep. English only; data, never a promise of price or profit.
 */

import { ORBIT_BONUS_BPS, ORBIT_BONUS_LIVE } from "../core/launch/orbit-bonus.ts";
import { presetTerms } from "../core/launch/preset-terms.ts";

const classic = presetTerms("classic");
const guarded = presetTerms("protected");
if (!classic || !guarded) throw new Error("The Classic or Protected preset has no terms: the home page would have no shares to show.");
const terms = classic;

const pct = (bps: number) => `${Math.round(bps) / 100}%`;
const usd = (value: number) => `$${value.toLocaleString("en-US")}`;
const minutes = (seconds: number) => (seconds % 60 === 0 ? `${seconds / 60} minutes` : `${seconds} seconds`);

/** Who is paid on a launch and for what; `live` — on mainnet now, otherwise the next step of the flight plan (decision 68). */
export type EarnerCard = Readonly<{ who: string; forWhat: string; text: string; live: boolean }>;

export type EarningsRow = Readonly<{
  moment: string;
  detail: string;
  creator: string;
  ryntra: string;
  meteora: string;
  /** The same split in basis points of the fee, for the gauge: creator, Ryntra, Meteora, and what grows the pool. */
  bps: Readonly<{ creator: number; ryntra: number; meteora: number; pool: number }>;
}>;

export const HOME_FACTS = {
  launch: {
    eyebrow: "LAUNCH IN A MINUTE",
    /* Non-breaking spaces keep each pair whole: «Picture it.» never splits across lines. */
    title: "Name\u00a0it. Picture\u00a0it. Launch\u00a0it.",
    lede: "Three fields here. The market's rules and a review on the next screen. One signature in your wallet.",
    name: "Name",
    namePlaceholder: "Kite",
    symbol: "Ticker",
    symbolPlaceholder: "KITE",
    picture: "Picture",
    pictureHint: "Square PNG, JPG, WebP or GIF",
    pictureBad: "That file is not a picture a wallet can show. Try a PNG, JPG, WebP or GIF.",
    pictureBusy: "Preparing the picture…",
    go: "Continue to the rules",
    note: "Nothing is uploaded or signed before your review.",
    storeless: "This browser keeps nothing between pages, so the form will open empty. Press again to go on and fill it in there.",
    preview: "YOUR MISSION",
    previewState: "READY · LIFTOFF AT T-0",
    /* What the form opens on: the Protected preset (`app/app/launch/new/launch-flow.tsx`). */
    previewRows: [
      ["PRESET", "Protected"],
      ["LAUNCH FEE", `${pct(guarded.curve.sniperFee.startBps)} → ${pct(guarded.curve.sniperFee.endBps)} in ${minutes(guarded.curve.sniperFee.seconds).replace(" minutes", " min")}`],
      ["AT ORBIT", "LP locked forever"],
    ],
    defaults: ["No code, no fee beyond the network's rent", "A launch fee that makes rushing in costly", "Liquidity locked forever at orbit", "A share of every trade's fee to you"],
  },
  why: {
    eyebrow: "WHY LAUNCH ON RYNTRA",
    title: ["Meteora built the engine.", "Ryntra flies the mission."],
    lede: "The same Meteora engine, without the code: a tested launch in one form, a launch fee that makes rushing in costly, liquidity nobody can pull, your income in one cabinet — and an audience watching.",
    diy: "BUILDING ON METEORA YOURSELF",
    ryntra: "LAUNCHING ON RYNTRA",
    rows: [
      { topic: "Setup", diy: "Write a partner config, a price curve and a migration plan, then ship the code.", lead: "One form, no code.", ryntra: "Pick a tested preset; no fee beyond the network's rent." },
      {
        topic: "The first minutes",
        diy: "Configure the anti-sniper fee yourself.",
        lead: "Rushing in costs the most.",
        ryntra: `The launch fee falls ${pct(terms.curve.sniperFee.startBps)} → ${pct(terms.curve.sniperFee.endBps)} over ${minutes(terms.curve.sniperFee.seconds)} (${pct(guarded.curve.sniperFee.startBps)} over ${minutes(guarded.curve.sniperFee.seconds)} on Protected), so bots that grab the start pay for it.`,
      },
      { topic: "Liquidity", diy: "Choose and configure the lock yourself.", lead: "Locked forever at orbit.", ryntra: `Two positions, the creator's and Ryntra's, ${terms.exitLiquidity.creatorPct} / ${terms.exitLiquidity.ryntraPct}. Nobody can pull them, Ryntra included.` },
      { topic: "Your income", diy: "Build your own claim flow.", lead: "A creator cabinet.", ryntra: "Your income by source, your holders, and a Claim for each launch." },
      { topic: "Trust", diy: "Show buyers the chain yourself.", lead: "Facts, not promises.", ryntra: "The token page links its facts to the chain: supply, mint and freeze rights, locked liquidity." },
      { topic: "Audience", diy: "Bring every viewer yourself.", lead: "A public flight.", ryntra: "Your token flies live in Mission Control, watched without a wallet, with a ready post for X." },
      { topic: "What it costs", diy: "You are the partner: the partner's share of the fees is yours, and so is all the work above.", lead: "Ryntra is the partner.", ryntra: "It takes the partner's share — every split is below, and in your review before you sign." },
    ],
  },
  how: {
    eyebrow: "HOW IT WORKS",
    title: "Every token is a mission.",
    lede: "The path every token launched on Ryntra can fly — three steps, each one recorded on the Solana chain. You can watch it all without a wallet.",
    acts: [
      {
        n: "01",
        name: "Liftoff",
        text: `The token starts trading on a price curve run by Meteora: the price rises with every purchase. For the first ${minutes(terms.curve.sniperFee.seconds)} the fee falls from ${pct(terms.curve.sniperFee.startBps)} to ${pct(terms.curve.sniperFee.endBps)}, so bots can't grab the start cheaply.`,
      },
      {
        n: "02",
        name: "Flight",
        text: `Each purchase pushes the token higher. When its market value reaches ${usd(terms.curve.graduationMarketCapUsd)} the curve is complete and the token moves into its own trading pool on Meteora (DAMM v2) — that is orbit. The money the pool opens with is locked forever, so nobody can pull it out.`,
      },
      {
        n: "03",
        name: "Survival",
        text: "On days 7, 30 and 90 the chain answers one question: is anyone besides the creator and Ryntra still trading it? A token that reached orbit and is still alive on day 90 becomes a permanent star in the Ryntra sky.",
      },
    ],
  },
  earn: {
    eyebrow: "WHO EARNS",
    title: "Every fee is split on chain.",
    lede: "Every trade pays a small fee. Meteora's programs split it automatically between the token's creator, Ryntra and Meteora, by a rule written on chain at launch that nobody can change afterwards.",
    rows: [
      { moment: "Every trade on the curve", detail: `the base fee is ${pct(terms.curve.baseFeeBps)}`, creator: pct(terms.curve.split.creatorBps), ryntra: pct(terms.curve.split.ryntraBps), meteora: pct(terms.curve.split.meteoraBps), bps: { creator: terms.curve.split.creatorBps, ryntra: terms.curve.split.ryntraBps, meteora: terms.curve.split.meteoraBps, pool: 0 } },
      { moment: "Reaching orbit", detail: `once — ${pct(terms.graduation.feeBps)} of what the curve raised, as the token moves to its pool; Meteora keeps ${pct(terms.graduation.meteoraLiquidityBps)} of the liquidity that moves`, creator: pct(terms.graduation.creatorBps), ryntra: pct(terms.graduation.ryntraBps), meteora: "—", bps: { creator: terms.graduation.creatorBps, ryntra: terms.graduation.ryntraBps, meteora: 0, pool: 0 } },
      {
        moment: "Every trade in the pool",
        detail: `the fee starts at ${pct(terms.pool.startFeeBps)} and falls to ${pct(terms.pool.endFeeBps)}; ${pct(terms.pool.compoundingBps)} of it stays in the pool and makes it deeper; the two shares hold while the two locked positions are its only liquidity`,
        creator: pct(terms.pool.creatorPositionBps),
        ryntra: pct(terms.pool.ryntraPositionBps),
        meteora: pct(terms.pool.meteoraBps),
        bps: { creator: terms.pool.creatorPositionBps, ryntra: terms.pool.ryntraPositionBps, meteora: terms.pool.meteoraBps, pool: terms.pool.compoundingBps },
      },
    ] satisfies readonly EarningsRow[],
    traders: `After launch every buyer pays the same falling launch fee, and anyone can buy or sell at any moment — on the curve, then in the pool. The creator's own first buy, at most ${pct(terms.firstBuy.capBps)} of the supply, is made in the creation itself.`,
    pool: "In the pool, the creator's 20% and Ryntra's 20% are what their two locked positions earn while they are its only liquidity. Anyone who adds liquidity later earns their own share.",
    referral: `A trade made on Ryntra carries Ryntra's referral code, which takes a fifth of Meteora's part: on the curve ${pct(terms.curve.splitThroughRyntra.ryntraBps)} to Ryntra and ${pct(terms.curve.splitThroughRyntra.meteoraBps)} to Meteora; the creator's share is the same.`,
    onBoard: "WHAT EACH ONE IS PAID FOR",
    live: "LIVE",
    next: "NEXT",
    nextHead: "COMING NEXT",
    earners: [
      {
        who: "Creator",
        forWhat: "Launches it and keeps it trading",
        text: "A share of every fee on the curve, of the fee at orbit and of the pool's fees through their locked position — from the first trade, claimed from the creator cabinet.",
        live: true,
      },
      {
        who: "Ryntra",
        forWhat: "Runs the launch, the cabinet and the show",
        text: "The partner's share of the curve's fees and of the fee at orbit, a referral part of Meteora's on trades made here, and the other locked position — locked as the creator's is.",
        live: true,
      },
      {
        who: "Meteora",
        forWhat: "Runs the programs underneath",
        text: `Its protocol part of every fee, on the curve and in the pool, and ${pct(terms.graduation.meteoraLiquidityBps)} of the liquidity that moves at orbit.`,
        live: true,
      },
      { who: "Holders", forWhat: "Hold the token", text: "A share of the creator's fees, sent by snapshot under a rule shown before anyone buys. Never a tax on transfers.", live: false },
      {
        who: "Crew",
        forWhat: "Bring their audience and keep the market alive",
        /* MC-3: the bonus's rate is named only once it is truly accrued (`ORBIT_BONUS_LIVE`); until then, no number. */
        text: `Two to five people share the creator's fees on chain, each by their own consent, with a bonus at the checks of days 7, 30 and 90${ORBIT_BONUS_LIVE ? ` — ${pct(ORBIT_BONUS_BPS)} of what Ryntra has received from the mission` : ""}.`,
        live: false,
      },
      { who: "Scouts", forWhat: "Bring a creator to Ryntra", text: "A share of what Ryntra receives from the pools of the creators they bring.", live: false },
    ] satisfies readonly EarnerCard[],
    buyers: `Buyers: one falling launch fee for everyone, no insider allocation beyond the creator's own first buy of at most ${pct(terms.firstBuy.capBps)} of the supply (${pct(guarded.firstBuy.capBps)} on Protected), and a sell at any moment.`,
  },
  meteora: {
    eyebrow: "BUILT WITH METEORA INFRASTRUCTURE",
    title: ["The engine is Meteora's.", "The show is Ryntra's."],
    parts: [
      { name: "Dynamic Bonding Curve", text: "the price curve every token starts on, with the falling launch fee and a fee that rises when the price swings" },
      { name: "DAMM v2", text: `the trading pool a token moves into at orbit; its fee falls step by step for up to ${Math.round(terms.pool.expiresAfterSeconds / 86_400)} days` },
      { name: "Locked liquidity", text: `the pool opens with two positions — the creator's and Ryntra's, ${terms.exitLiquidity.creatorPct} / ${terms.exitLiquidity.ryntraPct} — locked forever` },
    ],
    docs: "https://docs.meteora.ag/core-products/dbc/what-is-dbc",
  },
  end: {
    title: "Launch once. Stay in orbit.",
  },
  details: "How the shares work",
} as const;

export { terms as CLASSIC_TERMS };
