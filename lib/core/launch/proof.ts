/**
 * Proof-of-Launch (SOL-L3) — every statement a token's page makes about the token, each with the transaction or the
 * account on chain where anyone can check it: its supply, the rights over the mint, who holds it, the liquidity's lock,
 * what its creator did, its fees and its move to the DEX.
 *
 * The rule is one: a statement without evidence is not made. A fact that was not read now leaves its topic said as «not
 * read» — never a guess, never a mark that silently goes —, and no statement here says a token is safe or free of
 * risk: each is one fact of the chain, with its link.
 *
 * Pure and client-safe: the page hands in what its server and its reads of the chain already hold; nothing here reaches
 * the network. `proof.test.mjs` holds the rule.
 */

import type { PresetTerms } from "./preset-terms.ts";

/** The topics of the proof, in the order the page says them. */
export const PROOF_TOPICS = ["supply", "rights", "distribution", "liquidity", "creator", "fees", "migration"] as const;
export type ProofTopic = (typeof PROOF_TOPICS)[number];

export const PROOF_CODES = [
  /* The supply: as launched, and what is left after anyone burned theirs. */
  "SUPPLY_FULL",
  "SUPPLY_BURNED",
  /* The rights over the mint, as its launch receipt reads them. */
  "MINT_REVOKED",
  "NO_FREEZE",
  "METADATA_FIXED",
  "NO_TRANSFER_HOOK",
  /* «Комісія за переказ» (SOL-L10): in place of «no rule on transfers», the rate until the DEX. */
  "TRANSFER_FEE_UNTIL_DEX",
  /* «Правила на кривій» (SOL-L8): in place of «no rule on transfers» too — Ryntra's verified rules until the DEX, and who may change the program that keeps them. */
  "CURVE_RULES_UNTIL_DEX",
  "CURVE_RULES_PROGRAM_GOVERNED",
  /* Who holds it. */
  "TOP10",
  "HOLDERS",
  "CREATOR_SHARE",
  /* The liquidity: held by the curve, then locked for ever in the DEX pool by position. */
  "CURVE_HOLDS_FUNDS",
  "LP_LOCKED",
  /* What the creator did. */
  "FIRST_BUY",
  "NO_FIRST_BUY",
  "CREATOR_LOCK",
  "CREATOR_SOLD",
  "CREATOR_NOT_SOLD",
  /* The fees, as the config fixes them. */
  "CURVE_FEE",
  "CURVE_SPLIT",
  "GRADUATION_FEE",
  "POOL_FEE",
  /* The move to the DEX. */
  "ON_CURVE",
  "MIGRATED",
] as const;
export type ProofCode = (typeof PROOF_CODES)[number];

/** What a link shows — the page names the link by it. */
export const PROOF_EVIDENCE_KINDS = ["mint", "creation", "curve", "config", "pool", "position", "escrow", "creator", "sale", "graduation", "rules"] as const;
export type ProofEvidenceKind = (typeof PROOF_EVIDENCE_KINDS)[number];

export type ProofEvidence = Readonly<{ kind: "tx" | "account"; id: string; what: ProofEvidenceKind }>;
export type ProofClaim = Readonly<{ code: ProofCode; values: Readonly<Record<string, string | number>>; evidence: readonly ProofEvidence[] }>;
/** One topic: its statements, and whether a part of it was not read now — said so, with no statement in its place. */
export type ProofSection = Readonly<{ topic: ProofTopic; claims: readonly ProofClaim[]; unread: boolean }>;

/** At most this many of the creator's sales are linked; the count names them all. */
export const PROOF_SALES_LINKED = 3;

export type ProofInput = Readonly<{
  /** The token's mint. */
  token: string;
  creator: string;
  /** The launch's creation transaction. */
  creation: string;
  /** The preset's terms, as the config fixes them; null for a preset this build does not know. */
  terms: PresetTerms | null;
  /** The launch receipt read from the chain now (or standing in from the last good read); null when not read or refused. */
  receipt: Readonly<{
    config: string;
    curve: string;
    supplyRaw: string;
    decimals: number;
    /** Each mark with the account it is seen at. */
    marks: readonly Readonly<{ code: string; account: string }>[];
    /** «Комісія за переказ» (SOL-L10): the rate on the curve; absent or null — none. */
    transferFeeBps?: number | null;
    /** «Правила на кривій» (SOL-L8): the rules the launch carries and the program that keeps them; absent or null — none. */
    curveRules?: Readonly<{ program: string; rules: readonly string[]; upgrade: string; upgradeAuthority: string | null; audit: string }> | null;
    creatorFirstBuy: Readonly<{ quoteInRaw: string; tokensOutRaw: string }> | null;
    creatorLock: Readonly<{ escrow: string; cliffAt: string; endsAt: string }> | null;
    migrated: boolean;
    progressBps: number;
    thresholdRaw: string;
    /** The DAMM v2 pool and its positions locked for ever, each with whose share it is; null before the DEX. */
    graduated: Readonly<{ pool: string; positions: readonly Readonly<{ position: string; owner: "creator" | "partner" | "other" }>[] }> | null;
  }> | null;
  /** The receipt's lock or exit was not read now: those parts are said as not read. */
  lockUnread: boolean;
  exitUnread: boolean;
  /** The token's market read from the chain; null while it is not. */
  market: Readonly<{
    supplyRaw: string;
    decimals: number;
    migrated: boolean;
    progressBps: number;
    thresholdRaw: string;
    /** The curve, or the pool it graduated into. */
    pool: string;
    curveFeeNowBps: number | null;
    /** The creator's sales, the newest last, and whether every trade of theirs was read. */
    creatorSales: readonly Readonly<{ signature: string; at: number }>[];
    /** How many sales, when counted from every trade of theirs (the market's own count); null — the sales above are all. */
    creatorSalesCount?: number | null;
    creatorTradesComplete: boolean;
    /** The move to the DEX: its transaction and time; null before it or when not read. */
    graduation: Readonly<{ signature: string; at: number }> | null;
    /** The creator's share of the supply and the account it is read at; null when not read. */
    creatorShare: Readonly<{ bps: number; account: string }> | null;
  }> | null;
  /** Market Health's holders and concentration — the same figures by the same definitions as its tiles; null while not read. */
  health: Readonly<{ top10Bps: number | null; top10AtLeast: boolean; holders: number | null; holdersAtLeast: boolean }> | null;
}>;

const RIGHTS: readonly ProofCode[] = ["MINT_REVOKED", "NO_FREEZE", "METADATA_FIXED", "NO_TRANSFER_HOOK", "TRANSFER_FEE_UNTIL_DEX", "CURVE_RULES_UNTIL_DEX"];

/** The proof of a launch, topic by topic. */
export function proofOfLaunch(input: ProofInput): readonly ProofSection[] {
  const mint: ProofEvidence = { kind: "account", id: input.token, what: "mint" };
  const creation: ProofEvidence = { kind: "tx", id: input.creation, what: "creation" };
  const receipt = input.receipt;
  const market = input.market;
  const sections: ProofSection[] = [];
  const section = (topic: ProofTopic, claims: ProofClaim[], unread: boolean) => sections.push({ topic, claims: claims.filter((claim) => claim.evidence.length > 0), unread });

  /* Supply: the mint holds it — the receipt's read of it, else the market's. */
  {
    const read = receipt ? { supplyRaw: receipt.supplyRaw, decimals: receipt.decimals } : market ? { supplyRaw: market.supplyRaw, decimals: market.decimals } : null;
    const launched = input.terms ? BigInt(input.terms.token.supply) * 10n ** BigInt(input.terms.token.decimals) : null;
    const claims: ProofClaim[] = [];
    if (read && launched !== null) {
      const burned = launched - BigInt(read.supplyRaw);
      claims.push(
        burned > 0n
          ? { code: "SUPPLY_BURNED", values: { supplyRaw: read.supplyRaw, launchedRaw: launched.toString(), burnedRaw: burned.toString(), decimals: read.decimals }, evidence: [mint, creation] }
          : { code: "SUPPLY_FULL", values: { supplyRaw: read.supplyRaw, decimals: read.decimals }, evidence: [mint, creation] },
      );
    }
    section("supply", claims, claims.length === 0);
  }

  /* Rights over the mint: each mark the receipt read, at the mint. */
  {
    const claims: ProofClaim[] = [];
    for (const code of RIGHTS) {
      const mark = receipt?.marks.find((entry) => entry.code === code);
      if (!mark) continue;
      if (code === "TRANSFER_FEE_UNTIL_DEX") claims.push({ code, values: { bps: receipt?.transferFeeBps ?? 0 }, evidence: [{ kind: "account", id: mark.account, what: "mint" }] });
      else if (code === "CURVE_RULES_UNTIL_DEX") {
        const rules = receipt?.curveRules ?? null;
        if (!rules) continue;
        claims.push({ code, values: { program: rules.program, rules: rules.rules.join(",") }, evidence: [{ kind: "account", id: mark.account, what: "mint" }] });
        /* Who may change the program that keeps the rules — at the program's own account, for anyone to read. */
        claims.push({
          code: "CURVE_RULES_PROGRAM_GOVERNED",
          values: { upgrade: rules.upgrade, ...(rules.upgradeAuthority ? { multisig: rules.upgradeAuthority } : {}), audit: rules.audit },
          evidence: [{ kind: "account", id: rules.program, what: "rules" }],
        });
      } else claims.push({ code, values: {}, evidence: [{ kind: "account", id: mark.account, what: "mint" }] });
    }
    section("rights", claims, receipt === null);
  }

  /* Who holds it: Market Health's figures; the mint's account lists every holder. */
  {
    const claims: ProofClaim[] = [];
    const health = input.health;
    if (health?.top10Bps != null) claims.push({ code: "TOP10", values: { bps: health.top10Bps, atLeast: health.top10AtLeast ? 1 : 0 }, evidence: [mint] });
    if (health?.holders != null) claims.push({ code: "HOLDERS", values: { count: health.holders, atLeast: health.holdersAtLeast ? 1 : 0 }, evidence: [mint] });
    if (market?.creatorShare) claims.push({ code: "CREATOR_SHARE", values: { bps: market.creatorShare.bps }, evidence: [{ kind: "account", id: market.creatorShare.account, what: "creator" }] });
    section("distribution", claims, health?.top10Bps == null || health.holders == null || !market?.creatorShare);
  }

  /* Liquidity: the curve holds the buyers' money until the DEX; there, the exit's positions locked for ever. */
  {
    const claims: ProofClaim[] = [];
    let unread = receipt === null;
    if (receipt && !receipt.migrated) {
      const mark = receipt.marks.find((entry) => entry.code === "CURVE_HOLDS_FUNDS");
      if (mark) claims.push({ code: "CURVE_HOLDS_FUNDS", values: {}, evidence: [{ kind: "account", id: mark.account, what: "curve" }] });
    }
    if (receipt?.migrated) {
      for (const position of receipt.graduated?.positions ?? []) {
        if (!receipt.marks.some((mark) => mark.code === "LP_LOCKED_FOREVER" && mark.account === position.position)) continue;
        claims.push({ code: "LP_LOCKED", values: { owner: position.owner }, evidence: [{ kind: "account", id: position.position, what: "position" }] });
      }
      if (input.exitUnread || !receipt.graduated) unread = true;
    }
    section("liquidity", claims, unread || claims.length === 0);
  }

  /* The creator: their first buy in the creation, their lock, their sales — or none, when every trade of theirs was read. */
  {
    const claims: ProofClaim[] = [];
    let unread = false;
    if (receipt) {
      claims.push(
        receipt.creatorFirstBuy
          ? { code: "FIRST_BUY", values: { tokensRaw: receipt.creatorFirstBuy.tokensOutRaw, quoteRaw: receipt.creatorFirstBuy.quoteInRaw }, evidence: [creation] }
          : { code: "NO_FIRST_BUY", values: {}, evidence: [creation] },
      );
      if (receipt.creatorLock) claims.push({ code: "CREATOR_LOCK", values: { cliffAt: receipt.creatorLock.cliffAt, endsAt: receipt.creatorLock.endsAt }, evidence: [{ kind: "account", id: receipt.creatorLock.escrow, what: "escrow" }] });
      else if (input.lockUnread) unread = true;
    } else unread = true;
    if (market && market.creatorSales.length > 0) {
      const linked = market.creatorSales.slice(-PROOF_SALES_LINKED).reverse();
      claims.push({ code: "CREATOR_SOLD", values: { sales: Math.max(market.creatorSales.length, market.creatorSalesCount ?? 0), at: market.creatorSales.at(-1)?.at ?? 0 }, evidence: linked.map((sale) => ({ kind: "tx", id: sale.signature, what: "sale" })) });
    } else if (market?.creatorTradesComplete) {
      claims.push({ code: "CREATOR_NOT_SOLD", values: {}, evidence: [{ kind: "account", id: input.creator, what: "creator" }] });
    } else unread = true;
    section("creator", claims, unread);
  }

  /* Fees: the config fixes them for ever; after the DEX the pool's own account holds its schedule. */
  {
    const claims: ProofClaim[] = [];
    const terms = input.terms;
    if (receipt && terms) {
      const config: ProofEvidence = { kind: "account", id: receipt.config, what: "config" };
      const migrated = market?.migrated ?? receipt.migrated;
      if (!migrated) {
        claims.push({
          code: "CURVE_FEE",
          values: { startBps: terms.curve.sniperFee.startBps, endBps: terms.curve.sniperFee.endBps, seconds: terms.curve.sniperFee.seconds, ...(market?.curveFeeNowBps != null ? { nowBps: market.curveFeeNowBps } : {}) },
          evidence: [config],
        });
        claims.push({ code: "CURVE_SPLIT", values: { creatorBps: terms.curve.split.creatorBps, ryntraBps: terms.curve.split.ryntraBps, meteoraBps: terms.curve.split.meteoraBps }, evidence: [config] });
      }
      claims.push({ code: "GRADUATION_FEE", values: { feeBps: terms.graduation.feeBps, creatorBps: terms.graduation.creatorBps, ryntraBps: terms.graduation.ryntraBps }, evidence: [config] });
      const pool = receipt.graduated?.pool ?? (market?.migrated ? market.pool : null);
      claims.push({
        code: "POOL_FEE",
        values: { startBps: terms.pool.startFeeBps, endBps: terms.pool.endFeeBps },
        evidence: pool ? [{ kind: "account", id: pool, what: "pool" }, config] : [config],
      });
    }
    section("fees", claims, claims.length === 0);
  }

  /* The move to the DEX: the curve's way there, or the transaction that moved it and the pool it opened. */
  {
    const claims: ProofClaim[] = [];
    const migrated = market?.migrated ?? receipt?.migrated ?? null;
    const progressBps = market?.progressBps ?? receipt?.progressBps ?? null;
    const thresholdRaw = market?.thresholdRaw ?? receipt?.thresholdRaw ?? null;
    if (migrated === false && progressBps !== null && thresholdRaw !== null) {
      const curve: ProofEvidence = { kind: "account", id: receipt?.curve ?? market?.pool ?? "", what: "curve" };
      claims.push({ code: "ON_CURVE", values: { bps: progressBps, thresholdRaw }, evidence: [curve, ...(receipt ? [{ kind: "account" as const, id: receipt.config, what: "config" as const }] : [])].filter((entry) => entry.id) });
    }
    if (migrated === true) {
      const pool = receipt?.graduated?.pool ?? market?.pool ?? null;
      const evidence: ProofEvidence[] = [];
      if (market?.graduation) evidence.push({ kind: "tx", id: market.graduation.signature, what: "graduation" });
      if (pool) evidence.push({ kind: "account", id: pool, what: "pool" });
      claims.push({ code: "MIGRATED", values: market?.graduation ? { at: market.graduation.at } : {}, evidence });
    }
    section("migration", claims, claims.length === 0 || (migrated === true && !market?.graduation));
  }

  return sections;
}

/** Every statement of the proof — each with at least one link, by construction. */
export function proofClaims(sections: readonly ProofSection[]): readonly ProofClaim[] {
  return sections.flatMap((entry) => entry.claims);
}

/**
 * Where a fact of «Risk» that is a count over many holders can be checked when the fact names no single account: the
 * mint, whose account lists every holder; the creator's own facts at their wallet; the token's age at its creation.
 * Null for a fact about the read itself (the history or the opening minutes not read whole) — it states nothing of the token.
 */
export function riskFactEvidence(code: string, ids: Readonly<{ token: string; creator: string; creation: string | null }>): Readonly<{ kind: "tx" | "account"; id: string }> | null {
  switch (code) {
    case "TOP10_HOLD":
    case "FEW_HOLDERS":
    case "HOLDERS_UNCOUNTED":
    case "SNIPERS_HOLD":
    case "BUNDLE_HOLDS":
      return { kind: "account", id: ids.token };
    case "CREATOR_HOLDS":
    case "CREATOR_SOLD":
    case "CREATOR_OTHER_CURVES":
      return { kind: "account", id: ids.creator };
    case "YOUNG":
      return ids.creation ? { kind: "tx", id: ids.creation } : null;
    default:
      return null;
  }
}
