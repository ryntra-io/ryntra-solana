import { REWARD_PAR_MINTS } from "../rewards/model.ts";
import { base58Encode } from "./pool-share.ts";
import type { JsonRpc } from "./pool-share-read.server.ts";
import type { FundingState, PoolTrade } from "./protect.ts";

/**
 * Reading protection's facts from Solana — read only, a public JSON-RPC.
 *
 * Three reads, each bounded, each honest about what it did not reach:
 * - a wallet's funding — who sent its first money, and when it first and last
 *   acted (S1, S2, S5);
 * - a wallet's transfers since a moment — whom it paid and who paid it (S2, S3);
 * - a launch curve's trades since a moment — who traded it and for how much in
 *   dollars (the activated creator, S6).
 *
 * Every figure here is an address or a time; the caller hashes the addresses
 * before anything is kept. Only finalized transactions are read.
 */

const PAGE = 1000;

/** How far back a wallet's history is read before it counts as a wallet with a long life of its own. */
export const FUNDING_MAX_PAGES = 4;
/** How many transactions of a wallet's recent history, or of a curve's, one read looks at. */
export const RECENT_MAX_TXS = 300;
/** The authority that owns every Meteora DBC curve's vaults — the IDL's fixed `poolAuthority`. */
export const DBC_POOL_AUTHORITY = "FhVo3mqL8PW5pH5U2CN4XE33DokiyZnUwuGpH2hmHLuM";
export const CURVE_MAX_TXS = 600;

type SignatureRow = Readonly<{ signature: string; blockTime: number | null; err: unknown }>;
type ParsedInstruction = Readonly<{ program?: string; programId?: string; parsed?: { type?: string; info?: Record<string, unknown> } }>;
type TokenBalance = Readonly<{ accountIndex?: number; owner?: string; mint: string; uiTokenAmount: Readonly<{ amount: string; decimals: number }> }>;
type ParsedTx = Readonly<{
  blockTime: number | null;
  meta: Readonly<{
    err: unknown;
    preTokenBalances?: readonly TokenBalance[];
    postTokenBalances?: readonly TokenBalance[];
    innerInstructions?: readonly Readonly<{ instructions: readonly ParsedInstruction[] }>[];
  }> | null;
  transaction: Readonly<{ message: Readonly<{ accountKeys: readonly Readonly<{ pubkey: string; signer?: boolean }>[]; instructions: readonly ParsedInstruction[] }> }>;
}>;

const iso = (seconds: number | null | undefined) => (typeof seconds === "number" && Number.isFinite(seconds) ? new Date(seconds * 1000).toISOString() : null);

async function signatures(rpc: JsonRpc, address: string, options: Readonly<{ before?: string; limit?: number }>): Promise<SignatureRow[]> {
  const result = await rpc("getSignaturesForAddress", [address, { limit: options.limit ?? PAGE, commitment: "finalized", ...(options.before ? { before: options.before } : {}) }]);
  if (!Array.isArray(result)) throw new Error("getSignaturesForAddress: not a list");
  return result as SignatureRow[];
}

/** Any version up to 1 (SIMD-0385): asked for 0, a node refuses a v1 transaction (-32015), and the read would be unavailable. */
async function transaction(rpc: JsonRpc, signature: string): Promise<ParsedTx | null> {
  const result = await rpc("getTransaction", [signature, { encoding: "jsonParsed", maxSupportedTransactionVersion: 1, commitment: "finalized" }]);
  return (result as ParsedTx | null) ?? null;
}

function instructionsOf(tx: ParsedTx, inner = true): ParsedInstruction[] {
  return [...tx.transaction.message.instructions, ...(inner ? (tx.meta?.innerInstructions ?? []).flatMap((group) => group.instructions) : [])];
}

/** System-program transfers of a transaction: source, destination. `inner` false — only what the signer asked for itself. */
function lamportMoves(tx: ParsedTx, inner = true): Array<{ from: string; to: string }> {
  const out: Array<{ from: string; to: string }> = [];
  for (const instruction of instructionsOf(tx, inner)) {
    if (instruction.program !== "system" || !instruction.parsed?.info) continue;
    const info = instruction.parsed.info;
    const type = instruction.parsed.type;
    if ((type === "transfer" || type === "transferWithSeed") && typeof info.source === "string" && typeof info.destination === "string") out.push({ from: info.source, to: info.destination });
    if ((type === "createAccount" || type === "createAccountWithSeed") && typeof info.source === "string" && typeof info.newAccount === "string") out.push({ from: info.source, to: info.newAccount });
  }
  return out;
}

/** The owner of each token account a transaction touched, from its balances. */
function tokenOwners(tx: ParsedTx): Map<string, string> {
  const keys = tx.transaction.message.accountKeys;
  const out = new Map<string, string>();
  for (const balance of [...(tx.meta?.preTokenBalances ?? []), ...(tx.meta?.postTokenBalances ?? [])]) {
    const account = typeof balance.accountIndex === "number" ? keys[balance.accountIndex]?.pubkey : undefined;
    if (account && balance.owner) out.set(account, balance.owner);
  }
  return out;
}

/**
 * Token transfers the signers asked for themselves (top-level only — a swap's own moves are a programme's, not a
 * person's): the authority, and the owners of both sides where the balances name them (the account otherwise).
 */
function tokenMoves(tx: ParsedTx): Array<{ authority: string; to: string; from: string }> {
  const owners = tokenOwners(tx);
  const out: Array<{ authority: string; to: string; from: string }> = [];
  for (const instruction of instructionsOf(tx, false)) {
    if ((instruction.program !== "spl-token" && instruction.program !== "spl-token-2022") || !instruction.parsed?.info) continue;
    const info = instruction.parsed.info;
    if (instruction.parsed.type !== "transfer" && instruction.parsed.type !== "transferChecked") continue;
    const authority = typeof info.authority === "string" ? info.authority : typeof info.multisigAuthority === "string" ? info.multisigAuthority : null;
    if (authority && typeof info.destination === "string" && typeof info.source === "string") {
      out.push({ authority, to: owners.get(info.destination) ?? info.destination, from: owners.get(info.source) ?? authority });
    }
  }
  return out;
}

export type FundingRead = Readonly<{ state: FundingState; funder: string | null; firstAt: string | null; lastAt: string | null }>;

/**
 * Who sent a wallet its first money: its oldest successful transaction, the system transfer (or account creation)
 * into it — or, without one, the transaction's fee payer when that is someone else. A history longer than
 * `FUNDING_MAX_PAGES` pages is `DEEP`; a failed request is `UNAVAILABLE`, never "no funder".
 */
export async function readFunding(rpc: JsonRpc, wallet: string): Promise<FundingRead> {
  try {
    let before: string | undefined;
    let lastAt: string | null = null;
    const all: SignatureRow[] = [];
    for (let page = 0; page < FUNDING_MAX_PAGES; page += 1) {
      const rows = await signatures(rpc, wallet, { before });
      if (page === 0) lastAt = iso(rows[0]?.blockTime);
      all.push(...rows);
      if (rows.length < PAGE) {
        /* No history at all: an empty wallet, or a node that has not caught up — never evidence of independence. */
        if (!all.length) return { state: "EMPTY", funder: null, firstAt: null, lastAt: null };
        const firstAt = iso(all[all.length - 1]!.blockTime);
        /* The oldest successful transactions — a failed one moved no money, and is never the start. */
        const successful = all.filter((row) => !row.err).reverse().slice(0, 5);
        /* Only failed transactions: the money that let it act is not in what was read. */
        if (!successful.length) return { state: "UNAVAILABLE", funder: null, firstAt: null, lastAt: null };
        for (const row of successful) {
          const tx = await transaction(rpc, row.signature);
          /* A transaction the node does not return is a read that failed — never "no funder". */
          if (!tx) return { state: "UNAVAILABLE", funder: null, firstAt: null, lastAt: null };
          if (tx.meta?.err) continue;
          const incoming = lamportMoves(tx).find((move) => move.to === wallet && move.from !== wallet);
          if (incoming) return { state: "FOUND", funder: incoming.from, firstAt, lastAt };
          const payer = tx.transaction.message.accountKeys[0]?.pubkey;
          if (payer && payer !== wallet) return { state: "FOUND", funder: payer, firstAt, lastAt };
          /* It paid for its own first transaction with nothing coming in: its start is not in what was read. */
          return { state: "UNAVAILABLE", funder: null, firstAt: null, lastAt: null };
        }
        return { state: "UNAVAILABLE", funder: null, firstAt: null, lastAt: null };
      }
      before = rows[rows.length - 1]!.signature;
    }
    /* Too long to read to the start: how far back it was read is what the rules weigh. */
    return { state: "DEEP", funder: null, firstAt: iso(all[all.length - 1]?.blockTime), lastAt };
  } catch {
    return { state: "UNAVAILABLE", funder: null, firstAt: null, lastAt: null };
  }
}

export type TransferRead = Readonly<{ items: readonly Readonly<{ counterparty: string; direction: "in" | "out"; at: string }>[]; complete: boolean }>;

/** Whom a wallet paid and who paid it since a moment, from its latest `RECENT_MAX_TXS` transactions; null — the read failed. */
export async function readTransfers(rpc: JsonRpc, wallet: string, since: string): Promise<TransferRead | null> {
  try {
    const sinceMs = Date.parse(since);
    const all = await signatures(rpc, wallet, { limit: RECENT_MAX_TXS });
    /* A party that launched or signed has a history: none read is a node behind, not a party with no transfers. */
    if (!all.length) return { items: [], complete: false };
    const items: Array<{ counterparty: string; direction: "in" | "out"; at: string }> = [];
    /* Whole only if the history ended before the cap, or reached the moment — failed rows count as read rows. */
    let reached = all.length < RECENT_MAX_TXS;
    for (const row of all) {
      const at = iso(row.blockTime);
      if (!at) {
        reached = false;
        break;
      }
      if (row.err) {
        if (Date.parse(at) < sinceMs) {
          reached = true;
          break;
        }
        continue;
      }
      if (Date.parse(at) < sinceMs) {
        reached = true;
        break;
      }
      const tx = await transaction(rpc, row.signature);
      if (!tx) return null;
      if (tx.meta?.err) continue;
      /* What the wallet's signer asked for itself: a swap's or a programme's own moves are nobody's transfer. */
      for (const move of lamportMoves(tx, false)) {
        if (move.from === wallet && move.to !== wallet) items.push({ counterparty: move.to, direction: "out", at });
        else if (move.to === wallet && move.from !== wallet) items.push({ counterparty: move.from, direction: "in", at });
      }
      for (const move of tokenMoves(tx)) {
        if (move.authority === wallet && move.to !== wallet) items.push({ counterparty: move.to, direction: "out", at });
        else if (move.to === wallet && move.authority !== wallet) items.push({ counterparty: move.from, direction: "in", at });
      }
    }
    return { items, complete: reached };
  } catch {
    return null;
  }
}

/**
 * A launch curve's trades since a moment: each successful transaction that touched it, its fee payer as the trader,
 * the side and the dollars from the curve's own quote vault (what the curve took in or paid out in a par dollar —
 * whatever route the trader paid through), or else the payer's own change in one. A transaction with neither is
 * kept without a figure. Null — the read failed.
 */
export async function readCurveTrades(rpc: JsonRpc, curve: string, since: string): Promise<Readonly<{ trades: PoolTrade[]; complete: boolean }> | null> {
  try {
    const sinceMs = Date.parse(since);
    /* The curve's own launch token, from its account (`base_mint` at 136): a trade elsewhere that only names the curve
       moves another curve's vault, never this one's. */
    const account = (await rpc("getAccountInfo", [curve, { encoding: "base64", commitment: "finalized" }])) as { value?: { data?: [string, string] } } | null;
    const bytes = account?.value?.data?.[0] ? Buffer.from(account.value.data[0], "base64") : null;
    if (!bytes || bytes.length < 168) return null;
    const curveBase = base58Encode(bytes.subarray(136, 168));
    /* Its own vaults (`base_vault` at 168, `quote_vault` at 200): the dollars are what this curve's quote vault moved. */
    const baseVault = base58Encode(bytes.subarray(168, 200));
    const quoteVault = base58Encode(bytes.subarray(200, 232));
    const trades: PoolTrade[] = [];
    let before: string | undefined;
    let seen = 0;
    let complete = false;
    while (seen < CURVE_MAX_TXS) {
      const asked = Math.min(PAGE, CURVE_MAX_TXS - seen);
      const rows = await signatures(rpc, curve, { before, limit: asked });
      if (!rows.length) {
        complete = true;
        break;
      }
      for (const row of rows) {
        seen += 1;
        const at = iso(row.blockTime);
        if (!at || row.err) continue;
        if (Date.parse(at) < sinceMs) {
          complete = true;
          break;
        }
        const tx = await transaction(rpc, row.signature);
        if (!tx) return null;
        if (tx.meta?.err) continue;
        const payer = tx.transaction.message.accountKeys[0]?.pubkey;
        if (!payer) continue;
        /* A trade on the curve moves its own base vault (the launch token, held by the curves' authority) one way and
           the payer's balance of that same token the other. A claim, a migration, a keeper's step, a swap elsewhere that
           only names the curve — none of them does both. */
        const tokenChange = (owner: string, mint: string) => {
          let change = 0n;
          for (const balance of tx.meta?.postTokenBalances ?? []) if (balance.owner === owner && balance.mint === mint) change += BigInt(balance.uiTokenAmount.amount);
          for (const balance of tx.meta?.preTokenBalances ?? []) if (balance.owner === owner && balance.mint === mint) change -= BigInt(balance.uiTokenAmount.amount);
          return change;
        };
        const keys = tx.transaction.message.accountKeys;
        const accountChange = (account: string, mint: string | null) => {
          let change = 0n;
          let decimals: number | null = null;
          for (const [list, sign] of [[tx.meta?.postTokenBalances, 1n], [tx.meta?.preTokenBalances, -1n]] as const) {
            for (const balance of list ?? []) {
              if (typeof balance.accountIndex !== "number" || keys[balance.accountIndex]?.pubkey !== account || (mint !== null && balance.mint !== mint)) continue;
              change += sign * BigInt(balance.uiTokenAmount.amount);
              decimals = REWARD_PAR_MINTS[balance.mint] === balance.uiTokenAmount.decimals ? balance.uiTokenAmount.decimals : null;
            }
          }
          return { change, decimals };
        };
        const base = { vault: accountChange(baseVault, curveBase).change, payer: tokenChange(payer, curveBase) };
        if (base.vault === 0n || base.payer === 0n || (base.vault > 0n) === (base.payer > 0n)) continue;
        const side: "buy" | "sell" = base.payer > 0n ? "buy" : "sell";
        /* The dollars: what this curve's own quote vault took in or paid out, whatever route paid; none — a pair that is
           not a par dollar, no figure. */
        const quote = accountChange(quoteVault, null);
        const moved = quote.decimals === null || quote.change === 0n ? null : quote.change * 10n ** BigInt(6 - quote.decimals);
        trades.push({ wallet: payer, side, usdMicros: moved === null ? null : moved < 0n ? -moved : moved, at, tx: row.signature });
      }
      /* The history ended before the cap — or the cap was reached first, and the read is not whole. */
      if (complete || rows.length < asked) {
        complete = complete || rows.length < asked;
        break;
      }
      before = rows[rows.length - 1]!.signature;
    }
    return { trades, complete };
  } catch {
    return null;
  }
}
