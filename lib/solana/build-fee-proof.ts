/**
 * The fee of a `/build` swap, proved by the simulation of the exact bytes the
 * wallet will sign — before they reach the wallet.
 *
 * Jupiter's program pays the platform fee by one token transfer, inside the
 * swap instruction, into the fee account named in the bytes. The simulation
 * the effect firewall already runs reports every inner instruction; this reads
 * the transfers into the fee account and holds them against the Review: on
 * the input side the amount is exact, so the bytes must pay exactly it; on the
 * output side the amount follows the route, so the bytes must pay some fee
 * and never more than the flow's rate of the route's output — the fee and
 * what the person receives, read from the same simulation.
 * A fee that would go anywhere else, or nowhere, refuses the Review — the
 * screen, the receipt and the chain must state one fee.
 *
 * Pure: the simulation's answer in, a verdict out.
 */

const TOKEN_PROGRAMS = new Set(["TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA", "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb"]);

type ParsedInner = Readonly<{
  programId?: unknown;
  parsed?: Readonly<{ type?: unknown; info?: Readonly<Record<string, unknown>> }> | unknown;
}>;
type InnerGroup = Readonly<{ index?: unknown; instructions?: readonly ParsedInner[] }>;

/** What the simulated bytes pay into one token account, summed over every parsed token transfer into it. */
export function simulatedTransfersInto(innerInstructions: unknown, account: string): bigint {
  if (!Array.isArray(innerInstructions)) return 0n;
  let total = 0n;
  for (const group of innerInstructions as readonly InnerGroup[]) {
    for (const instruction of group?.instructions ?? []) {
      if (typeof instruction?.programId !== "string" || !TOKEN_PROGRAMS.has(instruction.programId)) continue;
      const parsed = instruction.parsed as { type?: unknown; info?: Record<string, unknown> } | undefined;
      if (!parsed || (parsed.type !== "transfer" && parsed.type !== "transferChecked")) continue;
      const info = parsed.info ?? {};
      if (info.destination !== account) continue;
      const amount = parsed.type === "transfer" ? info.amount : (info.tokenAmount as { amount?: unknown } | undefined)?.amount;
      if (typeof amount !== "string" || !/^[0-9]+$/.test(amount)) continue;
      total += BigInt(amount);
    }
  }
  return total;
}

export type BuildFeeProof =
  | Readonly<{ ok: true; paidRaw: string }>
  | Readonly<{ ok: false; code: "FEE_ACCOUNT_NOT_STATIC" | "FEE_NOT_PAID" | "FEE_MISMATCH" | "FEE_ABOVE_RATE" | "FEE_UNMEASURED"; reason: string }>;

/**
 * Whether the simulated bytes pay the reviewed fee into the reviewed account.
 * `expectedRaw` null means the output side: some fee, sized by the route, at
 * most `bps` of the route's output (`takerOutputRaw`, what the simulation
 * shows the person receiving, plus the fee itself) — one unit of rounding.
 */
export function proveBuildFee(args: Readonly<{
  staticAccounts: readonly string[];
  feeAccount: string;
  expectedRaw: string | null;
  innerInstructions: unknown;
  /** The flow's rate the Review states. */
  bps?: number;
  /** On the output side: what the simulation shows the person receiving of the output, raw; null when it could not be measured. */
  takerOutputRaw?: string | null;
}>): BuildFeeProof {
  /* The fee account is never in Jupiter's lookup tables, so it is one of the message's own accounts; anywhere else, nothing here can see it. */
  if (!args.staticAccounts.includes(args.feeAccount)) {
    return { ok: false, code: "FEE_ACCOUNT_NOT_STATIC", reason: "The fee account is not among the transaction's own accounts." };
  }
  const paid = simulatedTransfersInto(args.innerInstructions, args.feeAccount);
  if (paid === 0n) return { ok: false, code: "FEE_NOT_PAID", reason: "The simulated swap pays nothing into Ryntra's fee account." };
  if (args.expectedRaw !== null && paid !== BigInt(args.expectedRaw)) {
    return { ok: false, code: "FEE_MISMATCH", reason: `The simulated swap pays ${paid} into Ryntra's fee account, not the ${args.expectedRaw} the Review states.` };
  }
  if (args.expectedRaw === null) {
    /* An output-side fee is bounded by the rate the person was shown: unknown is not good, so an unmeasured output refuses. */
    const bps = args.bps ?? 0;
    const received = args.takerOutputRaw === null || args.takerOutputRaw === undefined || !/^[0-9]+$/.test(args.takerOutputRaw) ? null : BigInt(args.takerOutputRaw);
    if (bps <= 0 || received === null || received <= 0n) {
      return { ok: false, code: "FEE_UNMEASURED", reason: "The simulated swap's output could not be measured against the fee's rate." };
    }
    if (paid * 10_000n > BigInt(bps) * (paid + received) + 10_000n) {
      return { ok: false, code: "FEE_ABOVE_RATE", reason: `The simulated swap pays ${paid} into Ryntra's fee account, more than ${bps} bps of the route's output.` };
    }
  }
  return { ok: true, paidRaw: paid.toString() };
}
