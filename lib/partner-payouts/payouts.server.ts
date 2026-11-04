/**
 * CITY-128 — the partners' weekly payout on its network: the switch, the reads the statements are counted from, the
 * proposal's bytes and the chain's word on it. Server-only.
 *
 * - **The switch.** `RYNTRA_PARTNER_PAYOUTS=on` — the weekly pass prepares and settles; anything else, it does nothing.
 *   The treasury that pays is `RYNTRA_PARTNER_PAYOUTS_MULTISIG` (a Squads v4 multisig whose vault 0 holds USDC) on the
 *   payout's own network, `RYNTRA_PARTNER_PAYOUTS_NETWORK` (`mainnet` | `devnet`, server-only) — never the treasury
 *   page's public switch, which would open the old page (CITY-128b); the page's network only where none is named.
 * - **The proposal.** The treasury's own payout batch (`buildTreasury`, kind `payouts`, SOL-4): one USDC transfer per
 *   partner from vault 0, a partner's USDC account opened by the vault where there is none, the operator's wallet the fee
 *   payer and the proposer, and also a vote «for» when it votes. The operator signs in the wallet; the payout's admin route
 *   sends the signed bytes by the treasury's own submit (`submitTreasury`); the server never signs nor holds a key.
 */

import { readAllOperations } from "../attribution/stats.server.ts";
import { readAddressEvidence } from "../evidence/service.server.ts";
import { referralCheckDeps } from "../growth/referral-guard-deps.server.ts";
import { payoutPairEffects } from "../growth/referral-guard-store.ts";
import { getGuardRuntime } from "../guard/runtime.ts";
import { readRewardAccount } from "../rewards/ledger.ts";
import type { TreasuryBuildResponse } from "../solana/treasury/contract.ts";
import { readMultisig, readProposals } from "../solana/treasury/squads.server.ts";
import { treasuryNetworkFrom, type TreasuryNetwork } from "../solana/treasury/model.ts";
import { buildTreasury, submitTreasury, treasuryDeps, treasuryNetwork, type TreasuryDeps, type TreasuryFailure } from "../solana/treasury/service.server.ts";
import type { TreasurySubmitRequest, TreasurySubmitResponse } from "../solana/treasury/contract.ts";
import { bindProposal, listStatements, prepareWeeks, proposalMatches, readStatement, settleWeek, settleWeeks, type PayoutCluster, type PrepareDeps, type ProposalReader } from "./store.server.ts";
import { payoutsOf, type Statement } from "./week.ts";

type Env = Readonly<Record<string, string | undefined>>;

export const PAYOUTS_ENV = "RYNTRA_PARTNER_PAYOUTS";
export const PAYOUTS_MULTISIG_ENV = "RYNTRA_PARTNER_PAYOUTS_MULTISIG";
export const PAYOUTS_NETWORK_ENV = "RYNTRA_PARTNER_PAYOUTS_NETWORK";

/** The network partners are paid on: the payout's own server switch, else the treasury page's. */
export function payoutsNetwork(env: Env = process.env): TreasuryNetwork | null {
  return treasuryNetworkFrom(env[PAYOUTS_NETWORK_ENV]) ?? treasuryNetwork(env);
}

/** The treasury's reads and store on the payout's network; null where it is not served. */
export function payoutsTreasury(env: Env = process.env): TreasuryDeps | null {
  return treasuryDeps(payoutsNetwork(env));
}

export function payoutsOn(env: Env = process.env): boolean {
  return env[PAYOUTS_ENV]?.trim().toLowerCase() === "on";
}

export function payoutsMultisig(env: Env = process.env): string | null {
  const value = env[PAYOUTS_MULTISIG_ENV]?.trim();
  return value && /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(value) ? value : null;
}

/**
 * The engine's reads for a statement: the operations ledger, the Rewards record, the sanctions source
 * and the referral guard (CITY-125) — the same cluster check the city asks, on the protection's own key; without the
 * key every pair waits and nobody is paid.
 */
export function prepareDeps(cluster: PayoutCluster, deps: Partial<PrepareDeps> = {}, env: Env = process.env): PrepareDeps {
  const store = deps.store ?? getGuardRuntime().store;
  return {
    store,
    cluster,
    now: deps.now ?? (() => new Date()),
    readOperations: deps.readOperations ?? (async () => (await readAllOperations()).operations),
    readAccount: deps.readAccount ?? ((wallet) => readRewardAccount(store, wallet)),
    screen:
      deps.screen ??
      (async (wallet) => {
        const read = await readAddressEvidence({ address: wallet });
        return read.evidence?.sanctions.state ?? "unavailable";
      }),
    pairs: deps.pairs ?? ((pairs, now) => payoutPairEffects(store, pairs, now, referralCheckDeps(store, env))),
  };
}

/** The chain's word on one proposal of the treasury, as the treasury page reads it (the latest twenty). */
export function proposalReader(treasury: Pick<TreasuryDeps, "connection" | "network">): ProposalReader {
  return async (multisig, index) => {
    const read = await readMultisig(treasury.connection, multisig);
    if (BigInt(index) > read.transactionIndex) return null;
    return (await readProposals(treasury.connection, read, treasury.network)).find((proposal) => proposal.index === index) ?? null;
  };
}

export type WeeklyPass = Readonly<{ on: boolean; prepared: readonly string[]; existing: readonly string[]; settled: readonly Readonly<{ week: string; state: Statement["state"] }>[] }>;

/** The cron's pass: prepare every closed week, then settle every week with a proposal. Off, it reads nothing. */
export async function weeklyPass(env: Env = process.env, deps: Readonly<{ treasury?: TreasuryDeps | null; prepare?: Partial<PrepareDeps> }> = {}): Promise<WeeklyPass> {
  const treasury = deps.treasury === undefined ? payoutsTreasury(env) : deps.treasury;
  if (!payoutsOn(env) || !treasury) return { on: false, prepared: [], existing: [], settled: [] };
  const prepare = prepareDeps(treasury.network, { store: treasury.store, now: treasury.now, ...deps.prepare }, env);
  const { prepared, existing } = await prepareWeeks(prepare);
  const settled = await settleWeeks(treasury.store, treasury.network, proposalReader(treasury), treasury.now());
  return { on: true, prepared, existing, settled: settled.map((statement) => ({ week: statement.week, state: statement.state })) };
}

/**
 * The week's proposal for the operator's wallet to sign. Refused when the week is not prepared, pays nobody, or already has
 * its proposal on chain; the number the build was given is recorded on the statement.
 */
export async function buildWeekProposal(
  treasury: TreasuryDeps,
  request: Readonly<{ week: string; wallet: string; format?: "legacy" | "v1" }>,
  env: Env = process.env,
): Promise<Readonly<{ ok: true; build: TreasuryBuildResponse; statement: Statement }> | TreasuryFailure> {
  const multisig = payoutsMultisig(env);
  if (!payoutsOn(env) || !multisig) return { ok: false, code: "PAYOUTS_OFF", message: "Partner payouts are not switched on here." };
  const reader = proposalReader(treasury);
  /* What the chain already shows decides first: a week whose proposal landed is never built again. */
  let statement = (await settleWeek(treasury.store, treasury.network, request.week, reader, treasury.now()).catch(() => null)) ?? (await readStatement(treasury.store, treasury.network, request.week));
  if (!statement) return { ok: false, code: "WEEK_NOT_PREPARED", message: "This week has no statement yet." };
  if (statement.state !== "PREPARED") return { ok: false, code: "WEEK_PROPOSED", message: `This week is ${statement.state.toLowerCase()}.` };
  if (statement.proposal && proposalMatches(statement, await reader(statement.proposal.multisig, statement.proposal.index).catch(() => null))) {
    return { ok: false, code: "WEEK_PROPOSED", message: "This week already has its proposal." };
  }
  const payouts = payoutsOf(statement);
  if (!payouts.length) return { ok: false, code: "WEEK_PAYS_NOBODY", message: "Nobody reached the smallest payout this week." };
  const built = await buildTreasury(treasury, {
    kind: "payouts",
    wallet: request.wallet,
    multisig,
    asset: "USDC",
    payouts: payouts.map((line) => ({ to: line.to, amountRaw: line.amountRaw.toString() })),
    ...(request.format ? { format: request.format } : {}),
  });
  if (!built.ok) return built;
  const index = built.build.review.index;
  if (!index) return { ok: false, code: "UNAVAILABLE", message: "The proposal's number could not be read; nothing was built." };
  statement = await bindProposal(treasury.store, treasury.network, request.week, { multisig, index, buildId: built.build.buildId }, treasury.now());
  return { ok: true, build: built.build, statement };
}

/**
 * A vote «for» or the execution of a week's proposal, for the operator's wallet — only on the payout's multisig and only
 * at the number the week is bound to: the operator's page moves nothing else of any treasury.
 */
export async function buildWeekAct(
  treasury: TreasuryDeps,
  request: Readonly<{ week: string; wallet: string; act: "approve" | "execute"; format?: "legacy" | "v1" }>,
  env: Env = process.env,
): Promise<Readonly<{ ok: true; build: TreasuryBuildResponse }> | TreasuryFailure> {
  const multisig = payoutsMultisig(env);
  if (!payoutsOn(env) || !multisig) return { ok: false, code: "PAYOUTS_OFF", message: "Partner payouts are not switched on here." };
  const statement = await readStatement(treasury.store, treasury.network, request.week);
  if (!statement?.proposal || statement.proposal.multisig !== multisig) return { ok: false, code: "WEEK_NOT_PROPOSED", message: "This week has no proposal yet." };
  if (statement.state === "PAID" || statement.state === "VOID") return { ok: false, code: "WEEK_CLOSED", message: `This week is ${statement.state.toLowerCase()}.` };
  const format = request.format ? { format: request.format } : {};
  const built =
    request.act === "approve"
      ? await buildTreasury(treasury, { kind: "vote", vote: "approve", wallet: request.wallet, multisig, index: statement.proposal.index, ...format })
      : await buildTreasury(treasury, { kind: "execute", wallet: request.wallet, multisig, index: statement.proposal.index, ...format });
  return built.ok ? { ok: true, build: built.build } : built;
}

/** What the operator's wallet signed for the payout, sent by the treasury's own submit on the payout's network. */
export async function submitWeekAct(treasury: TreasuryDeps, request: TreasurySubmitRequest): Promise<Readonly<{ ok: true; submit: TreasurySubmitResponse }> | TreasuryFailure> {
  const sent = await submitTreasury(treasury, request);
  if (sent.ok) await settleWeeks(treasury.store, treasury.network, proposalReader(treasury), treasury.now()).catch(() => undefined);
  return sent;
}

/** Every statement of the treasury's network, newest first, for the operator's page. */
export async function statementsFor(treasury: Pick<TreasuryDeps, "store" | "network">): Promise<readonly Statement[]> {
  return (await listStatements(treasury.store, treasury.network)).reverse();
}
