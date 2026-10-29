import { DRAND_QUICKNET, type BeaconInfo } from "./beacon";
import { canonicalJson, sha256Hex } from "./hash";
import type { MatchResult } from "./match";
import { RULES, type Seat } from "./rules";
import { MatchConfigSchema, MatchLogSchema, type MatchConfig } from "./schema";
import { logDigest, verify, type Divergence } from "./replay";

/**
 * The dice receipt (CITY-69): what a finished match proves, in the shape the Ring's judge (CITY-68) reads. In dice the
 * code decides, no model does, so the receipt reaches two levels of proof: the log's format and digest, and a
 * deterministic replay of every input. There is no third level to ask a model.
 *
 *   win        the replay decides a winner, and the claim matches it
 *   no_winner  both agents missed the same deadline, or the beacon never came; nobody won
 *   unclear    the log stops before the match is decided — never read as a win
 *   blocked    the log or the claim does not replay, or the config is not the one agreed before the match
 *
 * A replay proves the result follows from the log's inputs, not that the inputs are true. Anyone can write a log with
 * seeds of their own, a mock beacon and made-up moves, and it replays. So the class is «verified» only when the config
 * is the one agreed before the match (the digest the judge fixed) and its beacon is drand quicknet. Even then two
 * inputs rest on the host, and the receipt says so: the beacon's BLS signature is not checked here (`beacon:
 * "unchecked"`), and moves and their times are as the host recorded them (`moves: "host_recorded"`). Before any SOL
 * rides on a match, moves are signed by the agents and the signature is checked.
 *
 * Anchoring the digest (a Solana memo), the «verified» seal and any payout are the judge's, after CITY-68; nothing here
 * moves money.
 */

export const RECEIPT_FORMAT = "ryntra-dice-receipt/1";

export type DiceVerdict =
  | Readonly<{ kind: "win"; winner: Seat; winnerId: string; reason: MatchResult["reason"] }>
  | Readonly<{ kind: "no_winner"; reason: MatchResult["reason"] }>
  | Readonly<{ kind: "unclear"; why: string }>
  | Readonly<{ kind: "blocked"; why: string; divergence: Divergence | null }>;

export type DiceReceipt = Readonly<{
  format: typeof RECEIPT_FORMAT;
  game: "dice";
  /** «verified» only for a decided replay of an agreed config on drand quicknet; anything else is «unverified». */
  class: "verified" | "unverified";
  ruleset: typeof RULES.id;
  /** Null when the log is too malformed to name its match. */
  matchId: string | null;
  players: readonly [string, string] | null;
  /** SHA-256 of the canonical JSON of the config; compare with the digest agreed when the match was made. */
  configDigest: string | null;
  /** SHA-256 of the canonical JSON of the whole log: the value to anchor. */
  logDigest: string | null;
  proof: Readonly<{
    format: boolean;
    replay: boolean;
    /** The config matches the digest agreed before the match. False when none was handed in. */
    agreedConfig: boolean;
    /** `unchecked`: drand quicknet, BLS signature not verified here. `unknown_chain`: a mock or any other chain. */
    beacon: "unchecked" | "unknown_chain";
    /** Moves and their times are taken as the host recorded them: agents do not sign them yet. */
    moves: "host_recorded";
  }>;
  verdict: DiceVerdict;
}>;

/** SHA-256 of a config's canonical JSON: fixed when a match is made, checked again on its receipt. */
export function configDigest(config: MatchConfig): string {
  return sha256Hex(canonicalJson(config));
}

export type ReceiptOptions = Readonly<{
  /**
   * The config digest agreed before the match; a log with another config is blocked. Null when none was agreed: the
   * receipt then still replays, but is never «verified».
   */
  agreedConfig: string | null;
}>;

/** True when `info` is drand quicknet itself, not just a config that borrows its chain hash. */
export function isDrandQuicknet(info: BeaconInfo): boolean {
  return info.chainHash === DRAND_QUICKNET.chainHash && info.genesisTime === DRAND_QUICKNET.genesisTime && info.period === DRAND_QUICKNET.period;
}

/** Replays `log` and checks `claimed` against it; never throws on what an agent or a host hands in. */
export function diceReceipt(log: unknown, claimed: unknown, options: ReceiptOptions): DiceReceipt {
  const shape = MatchLogSchema.safeParse(log);
  const config = shape.success ? shape.data.config : MatchConfigSchema.safeParse(configOf(log)).data;
  const configHash = config ? configDigest(config) : null;
  const trust = {
    agreedConfig: options.agreedConfig !== null && configHash !== null && options.agreedConfig === configHash,
    beacon: config && isDrandQuicknet(config.beacon) ? "unchecked" : "unknown_chain",
    moves: "host_recorded",
  } as const;
  const head = {
    format: RECEIPT_FORMAT,
    game: "dice",
    ruleset: RULES.id,
    matchId: config?.matchId ?? null,
    players: config ? ([config.players[0], config.players[1]] as const) : null,
    configDigest: configHash,
  } as const;
  const receipt = (digest: string | null, format: boolean, replay: boolean, verdict: DiceVerdict): DiceReceipt => {
    const decided = verdict.kind === "win" || verdict.kind === "no_winner";
    const verified = decided && format && replay && trust.agreedConfig && trust.beacon === "unchecked";
    return { ...head, class: verified ? "verified" : "unverified", logDigest: digest, proof: { format, replay, ...trust }, verdict };
  };

  if (!shape.success) {
    const v = verify(log, claimed);
    const divergence = v.ok ? null : v.divergence;
    return receipt(null, false, false, { kind: "blocked", why: "malformed_log", divergence });
  }

  const digest = logDigest(shape.data as Parameters<typeof logDigest>[0]);
  if (options.agreedConfig !== null && !trust.agreedConfig) {
    return receipt(digest, true, false, { kind: "blocked", why: "config_not_agreed", divergence: null });
  }

  const v = verify(log, claimed);
  if (!v.ok) {
    const { divergence } = v;
    // An honest log that stops before the end: the replay has no result to compare the claim with.
    if (divergence.index === "result" && divergence.path === "" && divergence.expected === null) {
      return receipt(digest, true, true, { kind: "unclear", why: "log_stops_early" });
    }
    const why = divergence.index === "result" ? "claim_differs" : "log_does_not_replay";
    return receipt(digest, true, false, { kind: "blocked", why, divergence });
  }

  const { result } = v;
  const verdict: DiceVerdict =
    result.winner === null || result.winnerId === null
      ? { kind: "no_winner", reason: result.reason }
      : { kind: "win", winner: result.winner, winnerId: result.winnerId, reason: result.reason };
  return receipt(digest, true, true, verdict);
}

function configOf(log: unknown): unknown {
  return log !== null && typeof log === "object" ? (log as { config?: unknown }).config : undefined;
}
