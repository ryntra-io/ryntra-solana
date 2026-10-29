import { z } from "zod";

import { HEX32 } from "./hash";
import { RULES } from "./rules";

/**
 * Wire formats (CITY-69). An agent's move is a tool call `{ name, arguments }`, the shape of an MCP `tools/call`
 * request, so any agent with tool calling can play without a client of its own. Anything outside these schemas is a
 * malformed move and loses the match.
 */

const hex32 = z.string().regex(HEX32, "expected 64 lowercase hex characters");
const callId = z.string().max(128).optional();
const time = z.int().min(0);
const seat = z.union([z.literal(0), z.literal(1)]);
/** Ids end up inside hashed strings, so they never contain the `|` separator. */
const id = z.string().regex(/^[A-Za-z0-9._:-]{1,128}$/, "expected 1-128 characters of A-Z a-z 0-9 . _ : -");

export const CommitArgs = z.strictObject({ commitment: hex32 });
export const RevealArgs = z.strictObject({ seed: hex32 });
export const BidArgs = z.strictObject({ count: z.int().min(1), face: z.int().min(1).max(RULES.faces) });
export const ChallengeArgs = z.strictObject({});

export const MoveCall = z.discriminatedUnion("name", [
  z.strictObject({ name: z.literal("commit"), arguments: CommitArgs, id: callId }),
  z.strictObject({ name: z.literal("reveal"), arguments: RevealArgs, id: callId }),
  z.strictObject({ name: z.literal("bid"), arguments: BidArgs, id: callId }),
  z.strictObject({ name: z.literal("challenge"), arguments: ChallengeArgs.optional(), id: callId }),
]);
export type MoveCall = z.infer<typeof MoveCall>;
export type ToolName = MoveCall["name"];

export type ToolDefinition = Readonly<{
  name: ToolName;
  description: string;
  /** JSON Schema of `arguments`. */
  inputSchema: Record<string, unknown>;
}>;

/**
 * Tool definitions for an agent that runs commit and reveal itself; its view says which of them it may call right now.
 * A language model cannot hash reliably: give it `PLAY_TOOLS` through `hostedAgent` instead.
 */
export const TOOLS: readonly ToolDefinition[] = [
  {
    name: "commit",
    description:
      'Commit to a secret 32-byte seed before any dice exist. commitment = lowercase hex sha256 of the UTF-8 string "ryntra-dice/commit/v1|<matchId>|<seat>|<seed>".',
    inputSchema: z.toJSONSchema(CommitArgs),
  },
  {
    name: "reveal",
    description:
      "Reveal the seed you committed to. It goes only to the referee until the match ends. A seed that does not match your commitment loses the match.",
    inputSchema: z.toJSONSchema(RevealArgs),
  },
  {
    name: "bid",
    description:
      "Claim that at least `count` of all dice in play show `face` (ones are not wild). The bid must beat the last one: a higher count, or the same count with a higher face.",
    inputSchema: z.toJSONSchema(BidArgs),
  },
  {
    name: "challenge",
    description:
      "Call the last bid a lie. All dice are shown: if fewer than `count` dice show `face` the bidder loses a die, otherwise you do.",
    inputSchema: z.toJSONSchema(ChallengeArgs),
  },
];

/** The tools a model plays with when the platform keeps its seed (`hostedAgent`): bid and challenge only. */
export const PLAY_TOOLS: readonly ToolDefinition[] = TOOLS.filter((t) => t.name === "bid" || t.name === "challenge");

export const BeaconInfoSchema = z.strictObject({
  chainHash: hex32,
  genesisTime: time,
  period: z.int().min(1),
});

export const BeaconRoundSchema = z.strictObject({
  round: z.int().min(1),
  randomness: z.string(),
  signature: z.string(),
});

export const LimitsSchema = z.strictObject({
  /** From `startedAt` until both commitments are in. */
  commitMs: z.int().min(1),
  /** From the second commitment until both seeds are revealed. */
  revealMs: z.int().min(1),
  /** For every bid or challenge, from the previous move or the start of the round. */
  moveMs: z.int().min(1),
  /** From the beacon round's publication time (or the second reveal, if later) until the round is in; then the match is void. */
  beaconMs: z.int().min(1),
});
export type Limits = z.infer<typeof LimitsSchema>;

export const MatchConfigSchema = z.strictObject({
  matchId: id,
  ruleset: z.literal(RULES.id),
  players: z.tuple([id, id]).refine(([a, b]) => a !== b, "the two players must differ"),
  /** Unix time ms; the commit phase opens here. */
  startedAt: time,
  limits: LimitsSchema,
  beacon: BeaconInfoSchema,
  /** The beacon round is this many rounds after the latest one published when commitments close. */
  beaconDelayRounds: z.int().min(1).max(100),
});
export type MatchConfig = z.infer<typeof MatchConfigSchema>;

export const MatchEventSchema = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("move"), seat, at: time, call: z.unknown() }),
  z.strictObject({ type: z.literal("beacon"), at: time, beacon: BeaconRoundSchema }),
  z.strictObject({ type: z.literal("tick"), at: time }),
]);

export const LOG_FORMAT = "ryntra-dice-log/1";

/** Outer shape only: inputs are checked again by the engine, derived entries by comparison. */
export const MatchLogSchema = z.strictObject({
  format: z.literal(LOG_FORMAT),
  config: MatchConfigSchema,
  entries: z.array(z.looseObject({ type: z.string() })),
});
