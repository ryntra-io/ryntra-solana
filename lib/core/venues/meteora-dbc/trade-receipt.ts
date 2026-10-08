/**
 * A launch trade's receipt facts — what a buy or a sale of a Ryntra launch did,
 * as the chain shows it, beside what the person reviewed.
 *
 * The facts come from the trade's own transaction: the program's swap event
 * (the tokens, the pair currency, the fee) and the chain's balances (Meteora's
 * referral into Ryntra's account, Ryntra's own fee into its fee wallet). The
 * quote the wallet was shown stands beside them, so a receipt says both what was
 * asked and what happened, and whether the least the trade could receive was met.
 *
 * Ryntra's part of the fee is the cashback's base: on the curve the partner's
 * part of the trading fee and the referral; in the pool the referral and
 * Ryntra's own fee. Nobody paid it on top of the curve's or the pool's fee.
 *
 * The facts travel inside the standard Outcome Receipt as `observedEffects`
 * chunks under `LAUNCH_TRADE_RECEIPT_FACTS_SOURCE`, as a swap's do.
 *
 * Pure and client-safe.
 */

import { z } from "zod";

export const LAUNCH_TRADE_RECEIPT_FACTS_SOURCE = "ryntra.solana.launch-trade-receipt.facts@1";
export const LAUNCH_TRADE_RECEIPT_FACTS_SCHEMA = "ryntra.solana.launch-trade-receipt-facts";

const Base58 = z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/);
const Signature = z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{64,90}$/);
const Raw = z.string().regex(/^[0-9]+$/);

export const LaunchTradeReceiptFactsSchema = z
  .object({
    schema: z.literal(LAUNCH_TRADE_RECEIPT_FACTS_SCHEMA),
    network: z.enum(["mainnet", "devnet"]),
    signature: Signature,
    slot: z.number().int().min(0),
    /** The program's own clock in the swap event, ISO. */
    at: z.string().datetime({ offset: true }),
    /** The wallet that signed and whose tokens moved. */
    wallet: Base58,
    side: z.enum(["buy", "sell"]),
    /** The bonding curve, or the DAMM v2 pool the launch graduated into. */
    venue: z.enum(["curve", "pool"]),
    token: z.object({ mint: Base58, symbol: z.string().min(1).max(24), decimals: z.number().int().min(0).max(18) }).strict(),
    pair: z.object({ mint: Base58, symbol: z.string().min(1).max(24), decimals: z.number().int().min(0).max(18), dollar: z.boolean() }).strict(),
    /** The launch's curve — and its config, which a Ryntra launch's config is: the registry names it. */
    curve: Base58,
    config: Base58,
    /** The graduated pool, when the trade ran there. */
    pool: Base58.nullable(),
    /**
     * What the wallet was shown before it signed. The fee and Ryntra's part of it are null where none was shown — the
     * creator's first purchase inside a launch, quoted by what it buys.
     */
    quote: z
      .object({
        amountInRaw: Raw,
        amountOutRaw: Raw,
        minimumOutRaw: Raw,
        slippageBps: z.number().int().min(0).max(10_000),
        feeRaw: Raw.nullable(),
        ryntraRaw: Raw.nullable(),
      })
      .strict(),
    /** What the program's swap event and the transaction's balances say happened. */
    observed: z
      .object({
        tokensRaw: Raw,
        /** The pair currency the buyer paid or the seller kept, every fee counted. */
        pairRaw: Raw,
        /** Every fee of the trade in the pair currency. */
        feeRaw: Raw,
        /** Ryntra's part of it. */
        ryntraRaw: Raw,
        /** The price the trade left, pair currency per token — a float, for showing only. */
        priceAfter: z.number().finite().min(0),
      })
      .strict(),
    /** Whether the trade received at least the least it was built with. */
    minimumMet: z.boolean(),
  })
  .strict();

export type LaunchTradeReceiptFacts = z.output<typeof LaunchTradeReceiptFactsSchema>;

type ReceiptEffect = Readonly<{ description: string; sourceRef: string; observedAt: string }>;
const EFFECT_CHUNK_SIZE = 480;

/** The facts as receipt effects: one JSON text cut into chunks, each named `<source>:<ref>#i/N`. */
export function launchTradeFactsToEffects(args: Readonly<{ facts: LaunchTradeReceiptFacts; sourceRef: string; observedAt: string }>): readonly ReceiptEffect[] {
  const encoded = JSON.stringify(LaunchTradeReceiptFactsSchema.parse(args.facts));
  const chunks: string[] = [];
  for (let offset = 0; offset < encoded.length; offset += EFFECT_CHUNK_SIZE) chunks.push(encoded.slice(offset, offset + EFFECT_CHUNK_SIZE));
  return chunks.map((description, index) => ({ description, sourceRef: `${LAUNCH_TRADE_RECEIPT_FACTS_SOURCE}:${args.sourceRef}#${index + 1}/${chunks.length}`, observedAt: args.observedAt }));
}

/** The facts back from a receipt's effects; null when they are absent, incomplete or not these facts. */
export function parseLaunchTradeFactsFromEffects(effects: readonly ReceiptEffect[]): LaunchTradeReceiptFacts | null {
  const escaped = LAUNCH_TRADE_RECEIPT_FACTS_SOURCE.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`^${escaped}:.*#(\\d+)/(\\d+)$`);
  const chunks = effects
    .map((effect) => ({ effect, match: pattern.exec(effect.sourceRef) }))
    .filter((entry): entry is { effect: ReceiptEffect; match: RegExpExecArray } => entry.match !== null)
    .map((entry) => ({ index: Number(entry.match[1]), total: Number(entry.match[2]), description: entry.effect.description }));
  if (chunks.length === 0) return null;
  const total = chunks[0]!.total;
  if (chunks.length !== total || chunks.some((chunk) => chunk.total !== total)) return null;
  chunks.sort((left, right) => left.index - right.index);
  if (chunks.some((chunk, index) => chunk.index !== index + 1)) return null;
  try {
    const parsed = LaunchTradeReceiptFactsSchema.safeParse(JSON.parse(chunks.map((chunk) => chunk.description).join("")));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/**
 * Ryntra's part as a share of the trade's gross in the pair currency, basis points — the rate a fee row states; at least
 * 1 when the part is not nothing, so a small part is never read as none.
 */
export function ryntraShareBps(args: Readonly<{ ryntraRaw: bigint; pairRaw: bigint; feeRaw: bigint; side: "buy" | "sell" }>): number {
  /* A buy paid the pair amount with every fee in it; a sale kept it after them, so its gross is the kept part and the fees. */
  if (args.ryntraRaw <= 0n || args.pairRaw <= 0n) return 0;
  const gross = args.side === "buy" ? args.pairRaw : args.pairRaw + args.feeRaw;
  return Math.min(10_000, Math.max(1, Number((args.ryntraRaw * 10_000n) / gross)));
}
