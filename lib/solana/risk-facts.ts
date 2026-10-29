/**
 * The token's risk facts, as this product reads them from Ryntra's
 * market-data gateway (`GET /v1/risk?mint=`): the mint's own authorities and
 * extensions, who holds the supply, the pools the token trades in, how old it
 * is and who paid to create it. The gateway reads them from the chain and
 * serves no score — there is nothing here to turn into one.
 *
 * This module is a reader and nothing else. It belongs to another line's
 * service, so it states the shape it consumes and refuses to guess at
 * anything the answer does not carry:
 *
 * - without `MD_GATEWAY_URL` the facts are **not read**, and the reason says
 *   so in those words;
 * - a gateway that answers 404 (an older image without the route), 429, 503,
 *   times out, or sends a body this shape cannot parse is **not read** too,
 *   with the gateway's own words kept where it gave any;
 * - a family the gateway itself could not read arrives in `not_read` and stays
 *   there. Nothing is defaulted to zero, to an empty list or to "none".
 *
 * A reading is never evidence that a fact is absent. "The holders could not be
 * counted" and "no account holds more than a tenth" are two different answers,
 * and only the second is a fact.
 *
 * Server only: it reads an address the operator of the deployment sets, and
 * that address never reaches a browser.
 */

import { z } from "zod";

/** The gateway's route for a token's facts. */
export const RISK_FACTS_PATH = "/v1/risk";

/**
 * How long one read may take. A trade's Review waits for this before it can
 * be shown, so the budget is small on purpose: the gateway holds a minute of
 * facts in its own cache, and a reading that does not arrive in time is an
 * honest `INCOMPLETE` rather than a Review a person stares at.
 */
export const RISK_READ_TIMEOUT_MS = 1_500;

const Address = z.string().min(32).max(44);
const Whole = z.string().regex(/^\d+$/);
/** A share of the supply as the gateway writes it: a decimal fraction, never a percentage. */
const Share = z.string().regex(/^\d+(?:\.\d+)?$/);
const Slot = z.number().int().nonnegative().nullable();

const TransferFeeSchema = z.object({
  fee_bps: z.number().int().min(0).max(10_000),
  maximum: Whole.nullable(),
  maximum_why: z.string().nullable(),
  epoch: z.number().int().nonnegative(),
});

/*
 * Each schema below takes the fields this product judges a trade by and lets
 * the rest of the gateway's answer pass without a word: a field added there is
 * not a reason to stop reading here. What is named, though, is named exactly —
 * a shape that surprises us is a reading that did not happen.
 */
const MintAccountSchema = z.object({
  program: z.enum(["spl-token", "spl-token-2022"]),
  program_id: Address,
  decimals: z.number().int().min(0).max(255),
  supply: Whole,
  mint_authority: Address.nullable(),
  freeze_authority: Address.nullable(),
  transfer_fee: z
    .object({
      in_force: TransferFeeSchema.nullable(),
      in_force_why: z.string().nullable(),
    })
    .nullable(),
  permanent_delegate: Address.nullable(),
  new_accounts_frozen: z.boolean().nullable(),
  transfer_hook: z.object({ program: Address, authority: Address.nullable() }).nullable(),
  pausable: z.object({ paused: z.boolean().nullable(), authority: Address.nullable() }).nullable(),
  non_transferable: z.boolean(),
  close_authority: Address.nullable(),
  extensions: z.array(z.string().min(1)),
});

const ConcentrationSchema = z.object({
  /** What the shares are summed over, in the gateway's own words. */
  over: z.string().min(1),
  /** Whether that set is every account of the mint, or only the ones read. */
  complete: z.boolean(),
  top1: Share,
  top5: Share,
  top10: Share,
  top20: Share,
});

const HoldersSchema = z.object({
  slot: Slot,
  basis: z.enum(["all_token_accounts", "top_token_accounts"]),
  basis_why: z.string().nullable(),
  holders: z.number().int().nonnegative().nullable(),
  concentration: ConcentrationSchema,
  /** Pools, programs and the burn address left out — the shares an owner could sell. */
  concentration_plain_accounts: ConcentrationSchema,
  at_burn_address: z.object({ over: z.string().min(1), complete: z.boolean(), share: Share }),
});

const PoolSchema = z.object({
  pool: Address,
  kind: z.enum(["pool", "launchpad_account"]),
  program: Address,
  program_name: z.string().min(1).nullable(),
  slot: Slot.optional(),
});

const OriginSchema = z.object({
  first: z.object({ signature: z.string().min(1), slot: z.number().int().nonnegative(), at: z.number().nullable() }).nullable(),
  exact: z.boolean(),
  oldest: z.object({ signature: z.string().min(1), slot: z.number().int().nonnegative(), at: z.number().nullable() }).nullable(),
  why: z.string().nullable(),
  creator: z.object({ address: Address, basis: z.string().min(1) }).nullable(),
  launchpad: z.object({ program: Address, name: z.string().min(1) }).nullable(),
  created_by: z.object({ program: Address, name: z.string().min(1).nullable() }).nullable(),
});

export const TokenRiskFactsSchema = z.object({
  mint: Address,
  /** The gateway's own clock when it built the answer, in milliseconds. */
  at: z.number().int().nonnegative(),
  /** The newest slot any of its reads saw; the chain's clock, not ours. */
  slot: Slot,
  source: z.object({ id: z.string().min(1), label: z.string().min(1) }),
  slots: z.object({
    mint_account: Slot,
    metadata: Slot,
    holders: Slot,
    origin: Slot,
    creator_holds: Slot,
  }),
  mint_account: MintAccountSchema.nullable(),
  holders: HoldersSchema.nullable(),
  pools: z.array(PoolSchema),
  origin: OriginSchema,
  creator_holds: z.object({ amount: Whole, share: Share, basis: z.string().min(1), slot: Slot }).nullable(),
  after_launchpad: z.array(z.object({ pool: Address, program: Address, program_name: z.string().min(1).nullable() })).nullable(),
  /** Every family the gateway could not read, and why. These stay unread here too. */
  not_read: z.array(z.object({ fact: z.string().min(1), why: z.string().min(1) })),
});

export type TokenRiskFacts = z.output<typeof TokenRiskFactsSchema>;

/**
 * One reading of a token's facts. `NOT_READ` carries the reason in the words a
 * person can act on, because that reason is what a Review shows in place of
 * the facts it does not have.
 */
export type TokenRiskReading =
  | Readonly<{ state: "READ"; mint: string; facts: TokenRiskFacts; readAt: string }>
  | Readonly<{ state: "NOT_READ"; mint: string; why: string; readAt: string }>;

export type RiskGatewayEnv = Readonly<{ baseUrl: string }> | null;

/**
 * The gateway's base address from the environment — the same variable the
 * prediction pages read it by. Nothing here is a secret: the gateway's reads
 * are public, and the address stays on the server all the same.
 */
export function readRiskGatewayEnv(env: NodeJS.ProcessEnv = process.env): RiskGatewayEnv {
  const raw = env.MD_GATEWAY_URL?.trim() ?? "";
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return { baseUrl: url.toString().replace(/\/+$/, "") };
  } catch {
    return null;
  }
}

type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

/** The gateway's own refusal, where it sent one in its usual shape. */
const RefusalSchema = z.object({ error: z.string().min(1).max(64), message: z.string().min(1).max(512) });

const notRead = (mint: string, why: string, readAt: string): TokenRiskReading => ({ state: "NOT_READ", mint, why, readAt });

/**
 * Read one token's facts. Never throws and never guesses: every path that does
 * not end in a parsed answer ends in `NOT_READ` with the reason.
 *
 * The gateway's address is left out of every reason on purpose — a Review is
 * read by a person, and the host this deployment reads through is not theirs
 * to see.
 */
export async function readTokenRiskFacts(
  args: Readonly<{
    mint: string;
    env?: NodeJS.ProcessEnv;
    fetchImpl?: Fetch;
    timeoutMs?: number;
    now?: () => Date;
  }>,
): Promise<TokenRiskReading> {
  const now = args.now ?? (() => new Date());
  const readAt = now().toISOString();
  const gateway = readRiskGatewayEnv(args.env ?? process.env);
  if (!gateway) {
    return notRead(
      args.mint,
      "This deployment reads no market-data gateway, so the token's chain facts — its authorities and extensions, its holders, its pools, its creator — were not read at all.",
      readAt,
    );
  }
  const fetchImpl = args.fetchImpl ?? fetch;
  const url = `${gateway.baseUrl}${RISK_FACTS_PATH}?mint=${encodeURIComponent(args.mint)}`;
  let response: Response;
  try {
    response = await fetchImpl(url, {
      headers: { accept: "application/json" },
      cache: "no-store",
      signal: AbortSignal.timeout(args.timeoutMs ?? RISK_READ_TIMEOUT_MS),
    });
  } catch (cause) {
    const reason = cause instanceof Error && cause.name === "TimeoutError" ? "did not answer in time" : "could not be reached";
    return notRead(args.mint, `The market-data gateway ${reason}, so the token's chain facts were not read.`, readAt);
  }
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const refusal = RefusalSchema.safeParse(body);
    /* A gateway whose image predates this route answers 404. That is not a
       token without facts — it is a deployment that cannot read them yet, and
       a Review must say which of the two it is. */
    const words = response.status === 404 && (!refusal.success || refusal.data.error === "not_found")
      ? "The market-data gateway serves no token facts at this address yet, so the token's chain facts were not read."
      : refusal.success
        ? `The market-data gateway did not serve the token's chain facts (${refusal.data.error}): ${refusal.data.message}`
        : `The market-data gateway did not serve the token's chain facts (HTTP ${response.status}).`;
    return notRead(args.mint, words, readAt);
  }
  const parsed = TokenRiskFactsSchema.safeParse(body);
  if (!parsed.success) {
    return notRead(args.mint, "The market-data gateway's answer did not match the shape this product reads, so none of it was taken as fact.", readAt);
  }
  if (parsed.data.mint !== args.mint) {
    return notRead(args.mint, "The market-data gateway answered about a different mint, so nothing in that answer was taken as fact.", readAt);
  }
  return { state: "READ", mint: args.mint, facts: parsed.data, readAt };
}
