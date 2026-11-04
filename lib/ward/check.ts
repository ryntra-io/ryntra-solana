/**
 * The pre-sign check (CITY-152, phase 1; working name «ward»): one transaction — or one payment link — in, one of
 * three words out (`allow` · `warn` · `block`) with the reasons that put it there.
 *
 * What is read, in order:
 * 1. the bytes themselves — every program called, every instruction that hands over control (`scan.ts`);
 * 2. the simulation of those exact bytes against the chain now, diffed account by account against the chain before
 *    it (`effects.ts`) — who loses what, who gains it, which accounts change hands, which gain a delegate;
 * 3. every wallet that gains: Ryntra's own threat list, a look-alike of an address the signer knows, the security
 *    source the engine already reads, and whether the address has any history at all (`threats.ts`);
 * 4. every token the signer receives: the Token-2022 powers its mint carries (permanent delegate, transfer hook,
 *    frozen accounts, pause, fee) and its authorities, read straight from the mint; its market facts from the
 *    gateway where it answers;
 * 5. what the agent said it was doing, against all of the above (`intent.ts`).
 *
 * It holds no key, signs nothing, sends nothing and keeps nothing: every read is injected, and none of them writes.
 * There is no score and no word for «safe»: `allow` means only that nothing known stands against the transaction
 * and that what it does was read. A reading that did not happen is named as `unknown` — never a quiet pass.
 */

import { getBase58Encoder } from "@solana/kit";

import type { TokenRiskReading } from "../solana/risk-facts.ts";
import type { RecipientCheck } from "../solana/recipient-check.server.ts";
import { encodeAddress, isWalletState, readMint, readTokenAccount, U64_MAX, type AccountState, type MintRead } from "./accounts.ts";
import {
  WARD_CORE_UNKNOWNS,
  WARD_LEVEL_RANK,
  WARD_REASONS,
  type WardCheck,
  type WardHolder,
  type WardInput,
  type WardLevel,
  type WardNetwork,
  type WardReasonCode,
  type WardVerdict,
} from "./codes.ts";
import { feeOf, holderKind, readEffects, type BalanceChange, type Effects } from "./effects.ts";
import { compareIntent, readIntentText, rawOf, type IntentFinding, type WardIntent } from "./intent.ts";
import { COMPUTE_BUDGET_PROGRAM, KNOWN_MINTS, KNOWN_PROGRAMS, programLabel, TOKEN_PROGRAMS, WRAPPED_SOL_MINT } from "./known.ts";
import { ACCOUNT_AUTHORITY_TYPES, scanInstructions, type AuthorityEvent, type ScannedInstruction } from "./scan.ts";
import { looksLike, THREATS, threatOf, type ThreatEntry } from "./threats.ts";
import { accountKeysOf, decodeLookupTable, isWritableIndex, readWire, signersOf, type WireMessage } from "./wire.ts";

/* ---------------------------------------------------------------- shapes */

export type WardRequest = Readonly<{
  transaction?: string;
  link?: string;
  signer?: string;
  intent?: WardIntent;
  intentText?: string;
  known?: readonly string[];
  network?: WardNetwork;
}>;

export type WardReason = Readonly<{
  code: WardReasonCode;
  check: WardCheck;
  level: WardLevel;
  /** One short line a person reads first. */
  line: string;
  /** The rest, for the person who opens it. */
  detail: string | null;
  /** The addresses the reason is about. */
  accounts: readonly string[];
  /** Where the fact came from. */
  source: string;
}>;

export type WardChange = Readonly<{
  holder: string;
  kind: WardHolder;
  mint: string | null;
  symbol: string | null;
  decimals: number | null;
  /** Signed, in the asset's smallest units. */
  raw: string;
}>;

export type WardResult = Readonly<{
  schema: "ryntra.ward.check";
  schemaVersion: "1.0.0";
  verdict: WardVerdict;
  line: string;
  reasons: readonly WardReason[];
  /** How many readings did not happen. */
  notRead: number;
  input: Readonly<{
    kind: WardInput;
    network: WardNetwork;
    version: "legacy" | "v0" | null;
    signer: string | null;
    signed: boolean;
    programs: readonly Readonly<{ id: string; label: string | null }>[];
  }>;
  effects: Readonly<{
    simulated: boolean;
    changes: readonly WardChange[];
    feeLamports: string | null;
    rentLamports: string | null;
  }>;
  intent: WardIntent | null;
  checkedAt: string;
}>;

export type WardSimulation =
  | Readonly<{
      state: "ran";
      err: string | null;
      logs: readonly string[];
      /** The accounts asked for, after the transaction; `null` for one that does not exist after it. */
      after: ReadonlyMap<string, AccountState | null>;
      inner: readonly Readonly<{ index: number; instructions: readonly Readonly<{ programIndex: number; accounts: readonly number[]; data: Uint8Array }>[] }>[];
    }>
  | Readonly<{ state: "unavailable"; why: string }>;

export type WardSecurity = Readonly<{
  state: "answered" | "unsupported" | "unavailable";
  sanctioned: boolean | null;
  band: "low" | "medium" | "high" | "critical" | null;
}>;

export type WardReads = Readonly<{
  /** Accounts now, in base64 terms; `null` for an account that does not exist. The whole answer null when the chain did not answer. */
  accounts: (addresses: readonly string[]) => Promise<ReadonlyMap<string, AccountState | null> | null>;
  simulate: (args: Readonly<{ wireBase64: string; addresses: readonly string[] }>) => Promise<WardSimulation>;
  /** Whether an address has any transaction behind it; null when not read. */
  history?: (address: string) => Promise<"none" | "some" | null>;
  security?: (address: string) => Promise<WardSecurity | null>;
  tokenFacts?: (mint: string) => Promise<TokenRiskReading>;
  /** The link classifier the transfer builder uses (`/api/v1/money/recipient`). */
  recipient?: (to: string, mint: string | null, from: string | null) => Promise<RecipientCheck | null>;
  epoch?: () => Promise<bigint | null>;
  threats?: readonly ThreatEntry[];
  now?: () => Date;
}>;

/** Input the check cannot read at all — the route answers it as a validation error, not as a verdict. */
export class WardInputError extends Error {}

/** How many recipients one check asks about; the rest are listed, not read. */
export const WARD_MAX_RECIPIENTS = 4;
/** How many received tokens one check asks the market gateway about. */
export const WARD_MAX_TOKEN_FACTS = 3;
/**
 * How long a source beside the chain (the security source, a recipient's history, the market gateway) may take. One
 * that does not answer in time is named as not read: a slow source never holds the verdict back.
 */
export const WARD_SOURCE_TIMEOUT_MS = 4_000;

function inTime<T>(read: Promise<T>, fallback: T, ms: number = WARD_SOURCE_TIMEOUT_MS): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<T>((resolve) => {
    timer = setTimeout(() => resolve(fallback), ms);
  });
  return Promise.race([read.catch(() => fallback), late]).finally(() => clearTimeout(timer));
}

/* ---------------------------------------------------------------- words */

const short = (address: string) => `${address.slice(0, 4)}…${address.slice(-4)}`;

function symbolOf(mint: string | null): string {
  if (mint === null) return "SOL";
  return KNOWN_MINTS[mint]?.symbol ?? short(mint);
}

function decimalsOf(mint: string | null, mints: ReadonlyMap<string, MintRead | null>): number | null {
  if (mint === null || mint === WRAPPED_SOL_MINT) return 9;
  return mints.get(mint)?.decimals ?? KNOWN_MINTS[mint]?.decimals ?? null;
}

function amountText(raw: bigint, decimals: number | null): string {
  if (decimals === null) return `${raw} units`;
  const negative = raw < 0n;
  const value = negative ? -raw : raw;
  const scale = 10n ** BigInt(decimals);
  const whole = value / scale;
  const fraction = (value % scale).toString().padStart(decimals, "0").replace(/0+$/, "");
  return `${negative ? "-" : ""}${whole.toLocaleString("en-US")}${fraction ? `.${fraction.slice(0, 9)}` : ""}`;
}

class Reasons {
  private readonly list: WardReason[] = [];
  private readonly seen = new Set<string>();
  add(code: WardReasonCode, line: string, detail: string | null, accounts: readonly string[], source: string, level?: WardLevel): void {
    const key = `${code}|${accounts.join(",")}`;
    if (this.seen.has(key)) return;
    this.seen.add(key);
    const spec = WARD_REASONS[code];
    /* Bounded to the published shape: a long list is cut, never sent past what a client was promised. */
    const clip = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);
    this.list.push({
      code,
      check: spec.check,
      level: level ?? spec.level,
      line: clip(line, 512),
      detail: detail === null ? null : clip(detail, 2_048),
      accounts: [...new Set(accounts)].slice(0, 64),
      source: clip(source, 256),
    });
  }
  has(code: WardReasonCode, account?: string): boolean {
    return this.list.some((reason) => reason.code === code && (account === undefined || reason.accounts.includes(account)));
  }
  sorted(): readonly WardReason[] {
    return this.list
      .map((reason, at) => ({ reason, at }))
      .sort((a, b) => WARD_LEVEL_RANK[a.reason.level] - WARD_LEVEL_RANK[b.reason.level] || a.at - b.at)
      .map(({ reason }) => reason)
      .slice(0, 128);
  }
}

/* ---------------------------------------------------------------- the verdict */

export function verdictOf(reasons: readonly WardReason[]): WardVerdict {
  if (reasons.some((reason) => reason.level === "block")) return "block";
  if (reasons.some((reason) => reason.level === "warn" || (reason.level === "unknown" && WARD_CORE_UNKNOWNS.has(reason.code)))) return "warn";
  return "allow";
}

/** The one line: the heaviest reason's, or — with none against it — the plain statement of that and nothing more. */
export function lineOf(verdict: WardVerdict, reasons: readonly WardReason[]): string {
  if (verdict === "allow") return "Nothing known stands against this transaction.";
  const top = reasons.find((reason) => reason.level === (verdict === "block" ? "block" : "warn")) ?? reasons.find((reason) => reason.level === "unknown");
  return top?.line ?? "Look before you sign.";
}

/* ---------------------------------------------------------------- reading */

const SIMULATION_SOURCE = "Simulation of these exact bytes against the chain now";
const BYTES_SOURCE = "The transaction's own instructions";
const CHAIN_SOURCE = "The chain, read now";

function computeBudget(instructions: readonly ScannedInstruction[]): { limit: number | null; price: bigint | null } {
  let limit: number | null = null;
  let price: bigint | null = null;
  for (const ix of instructions) {
    if (ix.inner || ix.program !== COMPUTE_BUDGET_PROGRAM) continue;
    const data = ix.data;
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    if (data[0] === 2 && data.length >= 5) limit = view.getUint32(1, true);
    if (data[0] === 3 && data.length >= 9) price = view.getBigUint64(1, true);
  }
  return { limit, price };
}

const UNLIMITED_FLOOR = 1n << 63n;

function authorityReasons(reasons: Reasons, events: readonly AuthorityEvent[], effects: Effects | null, signer: string, before: ReadonlyMap<string, AccountState | null> | null): void {
  const fundedWallet = (address: string) => {
    const state = before?.get(address) ?? null;
    return state !== null && isWalletState(state) && state.lamports > 0n;
  };
  const ownerChanged = (account: string, program: string, source: string) =>
    reasons.add(
      "OWNER_CHANGED",
      account === signer ? "Hands your wallet to another program — for good." : `Hands the wallet ${short(account)} to another program.`,
      `The account ${account} would be owned by ${programLabel(program) ?? program} instead of the System program. Its balance would not move now, but whoever controls that program could move it at any time, and an owner change cannot be undone. This is how a drain disguised as a plain signature took about $3 million on Solana in December 2025.`,
      [account, program],
      source,
    );
  const delegate = (account: string, to: string, amount: bigint, source: string, balance: bigint | null) => {
    const unlimited = amount >= UNLIMITED_FLOOR;
    reasons.add(
      unlimited ? "DELEGATE_UNLIMITED" : "DELEGATE_SET",
      unlimited ? `Lets ${short(to)} take all of this token from you, at any time.` : `Lets ${short(to)} move some of your tokens without asking.`,
      unlimited
        ? `The token account ${account} would name ${to} as its delegate with no limit (${amount === U64_MAX ? "the largest amount there is" : amount.toString()}). A delegate moves tokens without another signature from you.`
        : `The token account ${account} would name ${to} as its delegate for ${amount.toString()} of its smallest units${balance !== null && amount >= balance && balance > 0n ? " — all it holds" : ""}. A delegate moves them without another signature from you.`,
      [account, to],
      source,
    );
  };

  for (const event of events) {
    switch (event.kind) {
      case "assign":
        if (event.account === signer || fundedWallet(event.account)) ownerChanged(event.account, event.program, BYTES_SOURCE);
        break;
      case "nonce-advance":
        if (event.first) {
          reasons.add(
            "DURABLE_NONCE",
            "This signature never expires — it can be sent at any time later.",
            `The first instruction advances the durable nonce ${event.nonce}. An ordinary signature lapses within about a minute; this one stays valid until the nonce moves, so whoever holds it can send it whenever they choose. Drainers collect such signatures to use later.`,
            [event.nonce],
            BYTES_SOURCE,
          );
        }
        break;
      case "nonce-authorize":
        if (event.to !== signer) {
          reasons.add("NONCE_AUTHORITY_CHANGED", `Gives control of a nonce account to ${short(event.to)}.`, `The nonce account ${event.nonce} would answer to ${event.to}.`, [event.nonce, event.to], BYTES_SOURCE);
        }
        break;
      case "token-set-authority": {
        if (event.current !== signer) break;
        if (event.authorityType === ACCOUNT_AUTHORITY_TYPES.owner && event.to !== null && event.to !== signer) {
          reasons.add(
            "TOKEN_OWNER_CHANGED",
            `Gives one of your token accounts to ${short(event.to)}.`,
            `The token account ${event.account} would belong to ${event.to}, with everything in it now and later.`,
            [event.account, event.to],
            BYTES_SOURCE,
          );
        } else if (event.authorityType === ACCOUNT_AUTHORITY_TYPES.close && event.to !== null && event.to !== signer) {
          reasons.add("CLOSE_AUTHORITY_CHANGED", `Lets ${short(event.to)} close one of your token accounts.`, `The token account ${event.account} would name ${event.to} as the one who may close it and take its rent.`, [event.account, event.to], BYTES_SOURCE);
        } else if (event.authorityType !== ACCOUNT_AUTHORITY_TYPES.owner && event.authorityType !== ACCOUNT_AUTHORITY_TYPES.close && event.to !== null && event.to !== signer) {
          reasons.add("MINT_AUTHORITY_CHANGED", `Hands a power over a token you control to ${short(event.to)}.`, `The mint ${event.account} would give its authority of type ${event.authorityType} to ${event.to}.`, [event.account, event.to], BYTES_SOURCE);
        }
        break;
      }
      case "token-approve":
        if (event.owner === signer && event.delegate !== signer) {
          const balance = readTokenAccount(before?.get(event.source) ?? null)?.amount ?? null;
          delegate(event.source, event.delegate, event.amount, BYTES_SOURCE, balance);
        }
        break;
      case "token-close":
        if (event.owner === signer && event.destination !== signer) {
          reasons.add("CLOSE_TO_OTHER", `Closes your token account and sends what it holds to ${short(event.destination)}.`, `The token account ${event.account} would be closed and its SOL sent to ${event.destination}, not to you.`, [event.account, event.destination], BYTES_SOURCE);
        }
        break;
      case "stake-authorize":
        if (event.authority === signer && event.to !== signer) {
          reasons.add("STAKE_AUTHORITY_CHANGED", `Gives control of your stake to ${short(event.to)}.`, `The stake account ${event.stake} would answer to ${event.to}, who could then withdraw it.`, [event.stake, event.to], BYTES_SOURCE);
        }
        break;
      case "upgrade-authority":
        if (event.current === signer && event.to !== null && event.to !== signer) {
          reasons.add("UPGRADE_AUTHORITY_CHANGED", `Gives the right to change your program to ${short(event.to)}.`, `The program data ${event.programData} would name ${event.to} as its upgrade authority.`, [event.programData, event.to], BYTES_SOURCE);
        }
        break;
      default:
        break;
    }
  }

  if (!effects) return;
  for (const change of effects.ownerChanges) {
    if (change.token) {
      if (change.from === signer && !reasons.has("TOKEN_OWNER_CHANGED", change.account)) {
        reasons.add("TOKEN_OWNER_CHANGED", `Gives one of your token accounts to ${short(change.to)}.`, `The token account ${change.account} would belong to ${change.to}, with everything in it now and later.`, [change.account, change.to], SIMULATION_SOURCE);
      }
    } else if ((change.account === signer || fundedWallet(change.account)) && !reasons.has("OWNER_CHANGED", change.account)) {
      ownerChanged(change.account, change.to, SIMULATION_SOURCE);
    }
  }
  for (const change of effects.delegates) {
    if (change.holder !== signer || change.delegate === signer) continue;
    if (reasons.has("DELEGATE_UNLIMITED", change.account) || reasons.has("DELEGATE_SET", change.account)) continue;
    delegate(change.account, change.delegate, change.amount, SIMULATION_SOURCE, change.balance);
  }
  for (const change of effects.closers) {
    if (change.holder !== signer || reasons.has("CLOSE_AUTHORITY_CHANGED", change.account)) continue;
    reasons.add("CLOSE_AUTHORITY_CHANGED", `Lets ${short(change.closer)} close one of your token accounts.`, `The token account ${change.account} would name ${change.closer} as the one who may close it and take its rent.`, [change.account, change.closer], SIMULATION_SOURCE);
  }
}

type Recipient = Readonly<{ address: string; kind: WardHolder }>;

async function recipientReasons(
  reasons: Reasons,
  args: Readonly<{
    recipients: readonly Recipient[];
    signer: string | null;
    declared: string | null;
    known: readonly string[];
    before: ReadonlyMap<string, AccountState | null> | null;
    reads: WardReads;
    threats: readonly ThreatEntry[];
  }>,
): Promise<void> {
  const { reads, threats } = args;
  const programs = args.recipients.filter((recipient) => recipient.kind === "program").map((recipient) => recipient.address);
  if (programs.length > 0) {
    reasons.add(
      "RECIPIENT_PROGRAM",
      programs.length === 1 ? "Value goes to a program's account (a pool or a vault)." : `Value goes to ${programs.length} programs' accounts (pools or vaults).`,
      "These accounts belong to programs rather than to people; a swap or a deposit pays into them by design. They are named here, not judged.",
      programs,
      SIMULATION_SOURCE,
    );
  }
  const wallets = args.recipients.filter((recipient) => recipient.kind === "wallet").map((recipient) => recipient.address);
  const references = [
    ...(args.signer ? [{ address: args.signer, as: "your own address" }] : []),
    ...(args.declared ? [{ address: args.declared, as: "the address the agent named" }] : []),
    ...args.known.map((address) => ({ address, as: "an address you know" })),
    ...threats.map((entry) => ({ address: entry.address, as: `an address on Ryntra's threat list (${entry.kind})` })),
  ];
  const unread: string[] = [];
  const asked = wallets.slice(0, WARD_MAX_RECIPIENTS);
  await Promise.all(
    asked.map(async (address) => {
      const threat = threatOf(address, threats);
      if (threat) {
        reasons.add("RECIPIENT_KNOWN_THREAT", `Pays an address known to drain wallets: ${short(address)}.`, `${address} is on Ryntra's threat list as a ${threat.kind} (${threat.source}, added ${threat.addedAt}).`, [address], "Ryntra's threat list");
      }
      const twin = references.find((reference) => looksLike(address, reference.address));
      if (twin) {
        reasons.add(
          "RECIPIENT_LOOKALIKE",
          `Pays ${short(address)}, which looks like ${twin.as} but is not it.`,
          `${address} shares its first and last characters with ${twin.address} (${twin.as}). Addresses ground to look alike are how address poisoning works — a Phantom user lost $264,000 that way in February 2026.`,
          [address, twin.address],
          "Comparison with the addresses this check was given",
        );
      }
      const [security, history] = await Promise.all([
        reads.security ? inTime(reads.security(address), null) : Promise.resolve(null),
        args.known.includes(address)
          ? Promise.resolve<"some">("some")
          : args.before?.has(address) && args.before.get(address) === null
            ? Promise.resolve<"none">("none")
            : reads.history
              ? inTime(reads.history(address), null)
              : Promise.resolve(null),
      ]);
      if (security?.state === "answered" || security?.state === "unsupported") {
        if (security.sanctioned) {
          reasons.add("RECIPIENT_SANCTIONED", `Pays an address on a sanctions list: ${short(address)}.`, `The security source lists ${address} as sanctioned.`, [address], "The engine's address security source");
        } else if (security.band === "high" || security.band === "critical") {
          reasons.add("RECIPIENT_FLAGGED", `The security source flags ${short(address)} (${security.band}).`, `The security source the engine reads rates ${address} in its ${security.band} band.`, [address], "The engine's address security source");
        }
      } else if (reads.security) {
        unread.push(address);
      }
      if (history === "none") {
        reasons.add(
          "RECIPIENT_NEW",
          `Pays a brand-new address: ${short(address)}.`,
          `${address} has no transaction behind it. A first payment to an address nobody has used is where most mistakes and most scams land — check it with the person you are paying.`,
          [address],
          CHAIN_SOURCE,
        );
      } else if (history === null) {
        unread.push(address);
      }
    }),
  );
  const unasked = wallets.slice(WARD_MAX_RECIPIENTS);
  const missing = [...new Set([...unread, ...unasked])];
  if (missing.length > 0) {
    reasons.add(
      "RECIPIENT_UNREAD",
      `${missing.length === 1 ? "One recipient was" : `${missing.length} recipients were`} not fully read.`,
      "The security source or the address's history did not answer for these, so whether they are new or flagged is not known.",
      missing,
      "The engine's address security source and the chain",
    );
  }
}

async function tokenReasons(
  reasons: Reasons,
  args: Readonly<{ received: readonly string[]; sent: readonly string[]; mints: ReadonlyMap<string, MintRead | null>; effects: Effects | null; signer: string | null; reads: WardReads }>,
): Promise<void> {
  const { mints, reads } = args;
  const lookups: string[] = [];
  for (const mint of args.received) {
    const read = mints.get(mint) ?? null;
    const name = symbolOf(mint);
    if (!read) {
      reasons.add("TOKEN_UNREAD", `The token you receive (${name}) could not be read.`, `The mint ${mint} did not answer, so what its issuer can do to holders is not known.`, [mint], CHAIN_SOURCE);
      continue;
    }
    const issuer = KNOWN_MINTS[mint]?.issuer ?? null;
    const issued = (level: WardLevel): WardLevel => (issuer ? "info" : level);
    const arrival = args.effects?.arrivals.find((entry) => entry.mint === mint && entry.holder === args.signer) ?? null;
    if (read.nonTransferable) {
      reasons.add("TOKEN_NON_TRANSFERABLE", `${name} can never be moved once you hold it.`, `The mint ${mint} is non-transferable: what arrives cannot be sold or sent.`, [mint], CHAIN_SOURCE);
    }
    if (read.paused === true) {
      reasons.add("TOKEN_PAUSED", `${name} is paused right now — nobody can move it.`, `The mint ${mint} has every transfer paused by its issuer.`, [mint], CHAIN_SOURCE);
    } else if (read.paused === false) {
      reasons.add("TOKEN_PAUSABLE", `${name}'s issuer can pause it for every holder.`, `The mint ${mint} carries a pause switch${issuer ? `, held by ${issuer} under its published terms` : ""}.`, [mint], CHAIN_SOURCE, issued("warn"));
    }
    if (arrival?.frozen) {
      reasons.add("TOKEN_FROZEN_ON_ARRIVAL", `${name} would arrive frozen — you could not move it.`, `New accounts of the mint ${mint} start frozen${read.freezeAuthority ? `, and only ${read.freezeAuthority} can thaw them` : ""}.`, [mint, arrival.account], SIMULATION_SOURCE);
    }
    if (read.permanentDelegate) {
      reasons.add(
        "TOKEN_PERMANENT_DELEGATE",
        `${name}'s issuer can take it back from you at any time.`,
        `The mint ${mint} names ${read.permanentDelegate} as its permanent delegate: it can move or burn any holder's balance without their signature${issuer ? ` — ${issuer}'s compliance power, written in its terms` : ""}.`,
        [mint, read.permanentDelegate],
        CHAIN_SOURCE,
        issued("warn"),
      );
    }
    if (read.transferHook) {
      reasons.add("TOKEN_TRANSFER_HOOK", `Every move of ${name} runs another program that can stop it.`, `The mint ${mint} calls ${read.transferHook} on every transfer; that program can refuse your sale.`, [mint, read.transferHook], CHAIN_SOURCE);
    }
    if (read.freezeAuthority && !arrival?.frozen) {
      reasons.add("TOKEN_FREEZE_AUTHORITY", `${name}'s issuer can freeze your account.`, `${read.freezeAuthority} can freeze any holder's account of ${mint}${issuer ? ` — ${issuer}, under its published terms` : ""}. A frozen account cannot sell.`, [mint, read.freezeAuthority], CHAIN_SOURCE, issued("warn"));
    }
    if (read.mintAuthority) {
      reasons.add("TOKEN_MINT_AUTHORITY", `${name}'s supply can still grow.`, `${read.mintAuthority} can mint more of ${mint}${issuer ? ` — ${issuer}, as its issuer` : ""}, diluting what you hold.`, [mint, read.mintAuthority], CHAIN_SOURCE, issued("warn"));
    }
    if (read.transferFeeBps !== null && read.transferFeeBps > 0) {
      reasons.add("TOKEN_TRANSFER_FEE", `${name} takes ${(read.transferFeeBps / 100).toFixed(2).replace(/\.?0+$/, "")}% of every transfer.`, `The mint ${mint} charges ${read.transferFeeBps} basis points on each move of it.`, [mint], CHAIN_SOURCE, read.transferFeeBps >= 100 ? "warn" : "info");
    }
    if (!issuer) lookups.push(mint);
  }
  for (const mint of args.sent) {
    if (args.received.includes(mint)) continue;
    const read = mints.get(mint) ?? null;
    if (read?.transferFeeBps) {
      reasons.add("TOKEN_TRANSFER_FEE", `The recipient gets ${(read.transferFeeBps / 100).toFixed(2).replace(/\.?0+$/, "")}% less ${symbolOf(mint)}.`, `The mint ${mint} takes ${read.transferFeeBps} basis points of every transfer.`, [mint], CHAIN_SOURCE, "info");
    }
  }
  if (!reads.tokenFacts) return;
  const asked = lookups.slice(0, WARD_MAX_TOKEN_FACTS);
  const facts = await Promise.all(asked.map((mint) => inTime(reads.tokenFacts!(mint), null)));
  const unread: string[] = [];
  facts.forEach((reading, at) => {
    const mint = asked[at];
    if (!reading || reading.state !== "READ") {
      unread.push(mint);
      return;
    }
    const plain = reading.facts.holders?.concentration_plain_accounts ?? null;
    const top1 = plain ? Number(plain.top1) : null;
    const top5 = plain ? Number(plain.top5) : null;
    const creator = reading.facts.creator_holds ? Number(reading.facts.creator_holds.share) : null;
    const notes: string[] = [];
    if (top1 !== null && top1 >= 0.2) notes.push(`one holder has ${(top1 * 100).toFixed(1)}% of the supply`);
    else if (top5 !== null && top5 >= 0.5) notes.push(`five holders have ${(top5 * 100).toFixed(1)}% of the supply`);
    if (creator !== null && creator >= 0.1) notes.push(`its creator still holds ${(creator * 100).toFixed(1)}%`);
    if (notes.length > 0) {
      reasons.add("TOKEN_CONCENTRATED", `${symbolOf(mint)} is held by a few — they can move its price alone.`, `${notes.join("; ")}.`, [mint], reading.facts.source.label);
    }
    if (!plain) unread.push(mint);
  });
  if (unread.length > 0) {
    reasons.add("TOKEN_FACTS_UNREAD", "Who holds the token you receive was not read.", "The market gateway did not answer for its holders and creator, so how concentrated the token is stays unknown.", unread, "Ryntra's market-data gateway");
  }
}

function intentReasons(reasons: Reasons, findings: readonly IntentFinding[], intent: WardIntent, mints: ReadonlyMap<string, MintRead | null>, source: string): void {
  for (const finding of findings) {
    const mint = finding.mint ?? null;
    const name = symbolOf(mint);
    const decimals = decimalsOf(mint, mints);
    const declared = finding.declaredRaw !== undefined ? amountText(finding.declaredRaw, decimals) : null;
    const actual = finding.actualRaw !== undefined ? amountText(finding.actualRaw, decimals) : null;
    switch (finding.code) {
      case "INTENT_MATCH":
        reasons.add("INTENT_MATCH", "Does what the agent said it would.", "The simulated changes match the declared intent: the amount, the asset and the recipient.", [], source);
        break;
      case "INTENT_AMOUNT_OVER":
        reasons.add(
          "INTENT_AMOUNT_OVER",
          `Sends ${actual} ${name} — the agent said ${declared}.`,
          `The declared intent was ${declared} ${name}; the transaction would take ${actual} ${name} from you. An agent that misread a decimal sent about a quarter of a million dollars instead of 4 SOL this way (Lobstar Wilde, February 2026).`,
          mint ? [mint] : [],
          source,
        );
        break;
      case "INTENT_AMOUNT_UNDER":
        reasons.add("INTENT_AMOUNT_UNDER", `Sends ${actual} ${name}, not the ${declared} the agent said.`, `The declared intent was ${declared} ${name}; the transaction moves less.`, mint ? [mint] : [], source);
        break;
      case "INTENT_ASSET":
        reasons.add("INTENT_ASSET", `Also takes ${actual} ${name}, which the agent never mentioned.`, `The declared intent names no ${name}, yet the transaction would take ${actual} of it from you.`, mint ? [mint] : [], source);
        break;
      case "INTENT_RECIPIENT": {
        const holders = finding.holders ?? [];
        const to = intent.kind === "transfer" ? intent.to : null;
        reasons.add(
          "INTENT_RECIPIENT",
          holders.length > 0 ? `Pays ${short(holders[0])}, not the address the agent named.` : "Does not pay the address the agent named.",
          `The declared recipient was ${to ?? "not named"}; the ${name} goes to ${holders.length > 0 ? holders.slice(0, 5).join(", ") + (holders.length > 5 ? ` and ${holders.length - 5} more` : "") : "someone else"}. A poisoned agent memory redirected payments exactly this way (ElizaOS research, 2025).`,
          [...holders, ...(to ? [to] : [])],
          source,
        );
        break;
      }
      case "INTENT_NOT_RECEIVED":
        reasons.add("INTENT_NOT_RECEIVED", `You would not receive the ${name} the agent said.`, `The declared intent expects at least ${declared} ${name}; the simulation shows ${actual ?? "0"} arriving.`, mint ? [mint] : [], source);
        break;
      case "INTENT_UNREADABLE":
        reasons.add("INTENT_UNREADABLE", "The agent's stated amount could not be read in that token's units.", `The amount does not fit ${name}'s decimals, or the token was not read.`, mint ? [mint] : [], "The declared intent");
        break;
    }
  }
}

/* ---------------------------------------------------------------- the two paths */

function finish(args: {
  reasons: Reasons;
  kind: WardInput;
  network: WardNetwork;
  message: WireMessage | null;
  signer: string | null;
  programs: readonly string[];
  simulated: boolean;
  changes: readonly BalanceChange[];
  mints: ReadonlyMap<string, MintRead | null>;
  fee: bigint | null;
  rent: bigint | null;
  intent: WardIntent | null;
  now: Date;
}): WardResult {
  const reasons = args.reasons.sorted();
  const verdict = verdictOf(reasons);
  return {
    schema: "ryntra.ward.check",
    schemaVersion: "1.0.0",
    verdict,
    line: lineOf(verdict, reasons),
    reasons,
    notRead: reasons.filter((reason) => reason.level === "unknown").length,
    input: {
      kind: args.kind,
      network: args.network,
      version: args.message ? (args.message.version === 0 ? "v0" : "legacy") : null,
      signer: args.signer,
      signed: (args.message?.signed ?? 0) > 0,
      programs: args.programs.slice(0, 64).map((id) => ({ id, label: programLabel(id) })),
    },
    effects: {
      simulated: args.simulated,
      changes: args.changes.slice(0, 128).map((change) => ({
        holder: change.holder,
        kind: change.kind,
        mint: change.mint,
        symbol: change.mint === null ? "SOL" : (KNOWN_MINTS[change.mint]?.symbol ?? null),
        decimals: decimalsOf(change.mint, args.mints),
        raw: change.raw.toString(),
      })),
      feeLamports: args.fee === null ? null : args.fee.toString(),
      rentLamports: args.rent === null ? null : args.rent.toString(),
    },
    intent: args.intent,
    checkedAt: args.now.toISOString(),
  };
}

function readIntent(request: WardRequest, reasons: Reasons): WardIntent | null {
  if (request.intent) return request.intent;
  if (!request.intentText) return null;
  const read = readIntentText(request.intentText);
  if (read.ok) return read.intent;
  reasons.add("INTENT_UNREADABLE", "The agent's stated intent could not be read.", read.why, [], "The declared intent");
  return null;
}

async function readMints(reads: WardReads, mints: readonly string[]): Promise<Map<string, MintRead | null>> {
  const out = new Map<string, MintRead | null>();
  const wanted = [...new Set(mints)].filter((mint) => mint !== WRAPPED_SOL_MINT);
  if (wanted.length === 0) return out;
  const [states, epoch] = await Promise.all([reads.accounts(wanted).catch(() => null), reads.epoch ? reads.epoch().catch(() => null) : Promise.resolve(null)]);
  for (const mint of wanted) out.set(mint, states ? readMint(states.get(mint) ?? null, epoch) : null);
  return out;
}

async function checkTransaction(request: WardRequest & { transaction: string }, reads: WardReads, network: WardNetwork, now: Date): Promise<WardResult> {
  const wire = readWire(request.transaction);
  if (!wire.ok) throw new WardInputError(wire.why);
  const message = wire.message;
  const reasons = new Reasons();
  const intent = readIntent(request, reasons);

  /* The lookup tables first: without them a v0 message's keys are only partly known. */
  const tables = new Map<string, readonly string[]>();
  if (message.lookups.length > 0) {
    const states = await reads.accounts(message.lookups.map((lookup) => lookup.table)).catch(() => null);
    for (const lookup of message.lookups) {
      const state = states?.get(lookup.table) ?? null;
      const addresses = state ? decodeLookupTable(state.data, encodeAddress) : null;
      if (addresses) tables.set(lookup.table, addresses);
    }
    const missing = message.lookups.filter((lookup) => !tables.has(lookup.table)).map((lookup) => lookup.table);
    if (missing.length > 0) {
      reasons.add("LOOKUPS_UNREAD", "Part of this transaction's account list could not be read.", "The address lookup tables it loads did not answer, so the accounts they hold were not checked.", missing, CHAIN_SOURCE);
    }
  }
  const keys = accountKeysOf(message, tables);
  const signers = signersOf(message);
  const signer = request.signer ?? signers[0] ?? null;
  if (!signer) throw new WardInputError("The transaction names no signer.");
  if (request.signer && !signers.includes(request.signer)) {
    reasons.add("TX_SIGNER_ABSENT", "This wallet does not sign this transaction.", `${request.signer} is not among the transaction's signers; it is judged as that wallet anyway.`, [request.signer], BYTES_SOURCE);
  }

  const top: ScannedInstruction[] = message.instructions.map((ix, index) => ({
    program: keys[ix.programIndex] ?? "",
    accounts: ix.accountIndices.map((at) => keys[at] ?? null),
    data: ix.data,
    index,
    inner: false,
  }));
  const topPrograms = new Set(top.map((ix) => ix.program));
  const writable = [...new Set(keys.filter((key, index): key is string => key !== null && isWritableIndex(message, index) && !topPrograms.has(key)))].slice(0, 64);
  const budget = computeBudget(top);
  const fee = feeOf(message.header.signers, budget.limit, budget.price);

  const [before, simulation] = await Promise.all([
    reads.accounts(writable).catch(() => null),
    reads.simulate({ wireBase64: message.wireBase64, addresses: writable }).catch((failure): WardSimulation => ({ state: "unavailable", why: failure instanceof Error ? failure.message : String(failure) })),
  ]);

  const inner: ScannedInstruction[] =
    simulation.state === "ran"
      ? simulation.inner.flatMap((group) =>
          group.instructions.map((ix) => ({ program: keys[ix.programIndex] ?? "", accounts: ix.accounts.map((at) => keys[at] ?? null), data: ix.data, index: group.index, inner: true })),
        )
      : [];
  const events = scanInstructions([...top, ...inner]);
  const programs = [...new Set([...top, ...inner].map((ix) => ix.program).filter((program) => program !== ""))];

  let effects: Effects | null = null;
  if (simulation.state === "unavailable") {
    reasons.add("SIMULATION_UNAVAILABLE", "What this transaction does could not be simulated.", `The chain did not answer the simulation (${simulation.why}). Only its instructions were read.`, [], SIMULATION_SOURCE);
  } else if (simulation.err !== null) {
    const logs = simulation.logs.filter((line) => /error|failed|insufficient/i.test(line)).slice(0, 3).join(" ");
    reasons.add("SIMULATION_FAILED", "This transaction fails as it stands — it would not go through.", `The simulation stopped with ${simulation.err}${logs ? `: ${logs}` : ""}. Nothing would move, but whoever built it may build another.`, [], SIMULATION_SOURCE);
  } else if (!before) {
    reasons.add("SIMULATION_UNAVAILABLE", "What this transaction changes could not be compared.", "The accounts as they stand now did not answer, so the simulation has nothing to be compared against.", [], CHAIN_SOURCE);
  } else if (writable.some((address) => !simulation.after.has(address))) {
    /* A simulation that ran but did not report the accounts it was asked for shows nothing — which is not «nothing moves». */
    reasons.add("SIMULATION_UNAVAILABLE", "What this transaction changes could not be read from its simulation.", "The simulation ran but did not report the accounts it was asked for, so nothing could be compared.", [], SIMULATION_SOURCE);
  } else {
    effects = readEffects({ signer, writable, before, after: simulation.after });
  }

  authorityReasons(reasons, events, effects, signer, before);

  /* Several balances emptied in one signature is a sweep, whatever else it claims to be. */
  if (effects) {
    const lost = effects.changes.filter((change) => change.holder === signer && change.raw < 0n && !(change.mint === null && -change.raw <= fee + effects!.rentLamports + 10_000n));
    if (lost.length >= 3) {
      reasons.add("SWEEPS_ASSETS", `Takes ${lost.length} different assets from you at once.`, "A transaction that empties several balances in one signature is how drainers sweep a wallet.", lost.map((change) => change.mint ?? WRAPPED_SOL_MINT), SIMULATION_SOURCE);
    }
  }

  /* Who gains: the simulation's holders, or — where it did not run — the transfers the instructions name. */
  const recipients: Recipient[] = [];
  const pushRecipient = (address: string) => {
    if (address === signer || recipients.some((recipient) => recipient.address === address)) return;
    recipients.push({ address, kind: holderKind(address, signer, effects?.wallets) });
  };
  if (effects) {
    for (const change of effects.changes) if (change.holder !== signer && change.raw > 0n) pushRecipient(change.holder);
  } else {
    for (const event of events) {
      if (event.kind === "system-transfer" && event.from === signer) pushRecipient(event.to);
      if (event.kind === "token-transfer" && event.owner === signer) {
        pushRecipient(readTokenAccount(before?.get(event.destination) ?? null)?.owner ?? event.destination);
      }
    }
  }
  const declared = intent?.kind === "transfer" ? intent.to : null;
  await recipientReasons(reasons, { recipients, signer, declared, known: request.known ?? [], before, reads, threats: reads.threats ?? THREATS });

  /* Tokens: every one the signer receives, sends, or names. */
  const received = effects ? effects.changes.filter((change) => change.holder === signer && change.raw > 0n && change.mint !== null).map((change) => change.mint!) : [];
  const sent = effects ? effects.changes.filter((change) => change.holder === signer && change.raw < 0n && change.mint !== null).map((change) => change.mint!) : [];
  const named = [
    ...events.flatMap((event) => (event.kind === "token-transfer" || event.kind === "token-approve") && event.mint ? [event.mint] : []),
    ...(intent ? (intent.kind === "transfer" ? [intent.mint] : [intent.give.mint, intent.get.mint]) : []).filter((mint): mint is string => mint !== null),
  ];
  const mints = await readMints(reads, [...received, ...sent, ...named]);
  await tokenReasons(reasons, { received: [...new Set(received)], sent: [...new Set(sent)], mints, effects, signer, reads });

  if (intent) {
    if (!effects) {
      reasons.add("INTENT_UNCHECKED", "Whether it does what the agent said could not be checked.", "Without a simulation there is nothing to compare the declared intent with.", [], "The declared intent");
    } else {
      const findings = compareIntent(intent, {
        signer,
        changes: effects.changes,
        costLamports: fee + effects.rentLamports,
        decimalsOf: (mint) => decimalsOf(mint, mints),
        ownerOfAccount: (address) => effects!.tokenAccounts.get(address)?.owner ?? null,
      });
      intentReasons(reasons, findings, intent, mints, SIMULATION_SOURCE);
    }
  }

  const unknownPrograms = programs.filter((program) => !KNOWN_PROGRAMS[program]);
  if (unknownPrograms.length > 0) {
    reasons.add(
      "PROGRAMS_UNKNOWN",
      unknownPrograms.length === 1 ? "Calls one program Ryntra does not name." : `Calls ${unknownPrograms.length} programs Ryntra does not name.`,
      "Not knowing a program is not a finding against it; what it does is read from the simulation above.",
      unknownPrograms,
      BYTES_SOURCE,
    );
  }

  return finish({
    reasons,
    kind: "transaction",
    network,
    message,
    signer,
    programs,
    simulated: effects !== null,
    changes: effects?.changes ?? [],
    mints,
    fee,
    rent: effects ? effects.rentLamports : null,
    intent,
    now,
  });
}

const PROBLEM_LINES: Readonly<Record<string, string>> = {
  LINK_PAID: "This payment link is already paid.",
  LINK_EXPIRED: "This payment link has expired.",
  LINK_UNCONFIRMED: "Whether this link is already paid could not be read.",
  LINK_NOT_FOUND: "No Ryntra payment link has this address.",
  LINK_MISMATCH: "The request does not match the payment link it claims to be.",
};

async function checkLink(request: WardRequest & { link: string }, reads: WardReads, network: WardNetwork, now: Date): Promise<WardResult> {
  const text = request.link.trim();
  const reasons = new Reasons();
  const intent = readIntent(request, reasons);
  const signer = request.signer ?? null;
  const notRead = (detail: string): WardResult => {
    reasons.add("LINK_NOT_READ", "This link asks a server for its transaction — paste the transaction itself.", detail, [], "The link");
    return finish({ reasons, kind: "link", network, message: null, signer, programs: [], simulated: false, changes: [], mints: new Map(), fee: null, rent: null, intent, now });
  };
  if (/^(solana-action:|solana:https?:)/i.test(text)) {
    return notRead("A Solana Pay transaction request or an action link names a server that builds the transaction for your wallet. This check does not call that server on your behalf; the transaction it returns is what to check.");
  }
  if (!reads.recipient) throw new WardInputError("Links are not read on this deployment.");
  const mint = intent?.kind === "transfer" ? intent.mint : null;
  const check = await reads.recipient(text, mint, signer).catch(() => null);
  if (!check) return notRead("The chain did not answer for this link's recipient.");
  if (check.problem === "EMPTY" || check.problem === "NOT_AN_ADDRESS" || check.problem === "MISREAD_CHARACTER" || check.problem === "WRONG_LENGTH" || check.problem === "REQUEST_INVALID" || check.problem === "LINK_INVALID") {
    if (/^https?:\/\//i.test(text)) return notRead("This web address is not a Ryntra payment link; an action link builds its transaction on a server, and that transaction is what to check.");
    throw new WardInputError("This is not a Solana transaction, address or payment link.");
  }
  if (check.problem === "REQUEST_UNSUPPORTED" || check.problem === "REFERENCE_UNSUPPORTED") {
    return notRead("This request carries a reference or a memo that a plain transfer cannot pay; the wallet that pays it builds the transaction, and that transaction is what to check.");
  }
  const recipient = check.destination?.owner ?? check.address;
  const askedMint = check.asset.mint;
  const mints = await readMints(reads, [askedMint, ...(intent?.kind === "transfer" && intent.mint ? [intent.mint] : [])].filter((value): value is string => value !== null));

  if (check.problem && PROBLEM_LINES[check.problem]) {
    reasons.add(check.problem === "LINK_MISMATCH" ? "RECIPIENT_REFUSED" : "RECIPIENT_LINK", PROBLEM_LINES[check.problem], `The payment link's own state: ${check.problem}.`, recipient ? [recipient] : [], "Ryntra's payment links", check.problem === "LINK_MISMATCH" ? "block" : "warn");
  } else if (check.problem === "MINT_UNREADABLE") {
    reasons.add("TOKEN_UNREAD", "The token this link asks for could not be read.", "The mint did not answer.", askedMint ? [askedMint] : [], CHAIN_SOURCE);
  } else if (check.problem === "RECIPIENT_UNREADABLE") {
    reasons.add("RECIPIENT_UNREAD", "The recipient could not be read.", "The chain did not answer for the recipient's account.", recipient ? [recipient] : [], CHAIN_SOURCE);
  } else if (check.problem && check.problem !== "SELF") {
    reasons.add("RECIPIENT_REFUSED", "This address cannot receive this payment — the money would be lost.", `The transfer builder refuses this recipient: ${check.problem}. It is a program, a mint, or an account of another token.`, recipient ? [recipient] : [], "The transfer builder's own recipient check");
  }

  if (recipient && check.problem !== "SELF") {
    await recipientReasons(reasons, { recipients: [{ address: recipient, kind: check.destination ? "wallet" : holderKind(recipient, signer ?? "") }], signer, declared: intent?.kind === "transfer" ? intent.to : null, known: request.known ?? [], before: null, reads, threats: reads.threats ?? THREATS });
  }
  await tokenReasons(reasons, { received: [], sent: askedMint ? [askedMint] : [], mints, effects: null, signer, reads });

  /* What the link asks for, as the changes it would make; the intent is compared with those. */
  const changes: BalanceChange[] = [];
  const decimals = decimalsOf(askedMint, mints);
  const askedRaw = check.asked?.amount && decimals !== null ? rawOf(check.asked.amount, decimals) : check.link?.amount ? BigInt(check.link.amount.raw) : null;
  if (recipient && askedRaw !== null) {
    const payer = signer ?? "you";
    changes.push({ holder: payer, kind: "you", mint: askedMint, raw: -askedRaw }, { holder: recipient, kind: check.destination ? "wallet" : holderKind(recipient, payer), mint: askedMint, raw: askedRaw });
  }
  if (intent) {
    if (intent.kind !== "transfer") {
      reasons.add("INTENT_ASSET", "A payment link cannot do what the agent said (a swap).", "The declared intent is a swap; a payment link only pays.", [], "The declared intent");
    } else if (!recipient) {
      reasons.add("INTENT_UNCHECKED", "Whether it does what the agent said could not be checked.", "The link's recipient was not read.", [], "The declared intent");
    } else {
      const payer = signer ?? "you";
      const intentDecimals = decimalsOf(intent.mint, mints);
      const declaredRaw = intentDecimals === null ? null : rawOf(intent.amount, intentDecimals);
      const raw = askedRaw ?? (intent.mint === askedMint ? declaredRaw : null);
      const synthetic = raw === null ? [] : [
        { holder: payer, mint: askedMint, raw: -raw },
        { holder: recipient, mint: askedMint, raw },
      ];
      const findings = compareIntent(intent, { signer: payer, changes: synthetic, costLamports: 0n, decimalsOf: (value) => decimalsOf(value, mints), ownerOfAccount: () => null });
      intentReasons(reasons, findings, intent, mints, "The link's own terms");
    }
  }

  return finish({ reasons, kind: "link", network, message: null, signer, programs: [], simulated: false, changes, mints, fee: null, rent: null, intent, now });
}

/** Check one transaction or one link. Throws `WardInputError` only for input that is neither. */
export async function checkWard(request: WardRequest, reads: WardReads): Promise<WardResult> {
  const now = (reads.now ?? (() => new Date()))();
  const network = request.network ?? "mainnet";
  if (request.transaction) return checkTransaction({ ...request, transaction: request.transaction }, reads, network, now);
  if (request.link) return checkLink({ ...request, link: request.link }, reads, network, now);
  throw new WardInputError("Paste a transaction (base64) or a link.");
}


/* ---------------------------------------------------------------- one bare address (CITY-166) */

/** A token's mint, judged as the token a person would come to hold. */
export type WardTokenResult = Readonly<{
  schema: "ryntra.ward.token";
  schemaVersion: "1.0.0";
  verdict: WardVerdict;
  line: string;
  reasons: readonly WardReason[];
  notRead: number;
  mint: string;
  /** Ryntra's own name for a mint it knows; never the token's self-chosen name. */
  symbol: string | null;
  program: MintRead["program"];
  network: WardNetwork;
  checkedAt: string;
}>;

export type WardAddressResult =
  | Readonly<{ subject: "token"; result: WardTokenResult }>
  | Readonly<{ subject: "address"; result: WardResult }>
  /** The chain did not answer for the address: nothing is judged, and nothing read is never a pass. */
  | Readonly<{ subject: "unread" }>;

const ADDRESS_BYTES = getBase58Encoder();

function isAddress(text: string): boolean {
  if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(text)) return false;
  try {
    return ADDRESS_BYTES.encode(text).length === 32;
  } catch {
    return false;
  }
}

/**
 * One bare address, as a chat pastes it (CITY-166, the Telegram bot): a token's mint — a «CA» — is judged as the token
 * a person would come to hold, with the same token reasons a transaction gets for what arrives; any other address is
 * judged as the recipient a person would pay, by the link path. `known` are addresses the asker has seen (a chat's
 * recent ones): a look-alike of one of them is how address poisoning reaches a group. Reads only, like the rest.
 */
export async function checkWardAddress(
  request: Readonly<{ address: string; known?: readonly string[]; network?: WardNetwork }>,
  reads: WardReads,
): Promise<WardAddressResult> {
  const now = (reads.now ?? (() => new Date()))();
  const network = request.network ?? "mainnet";
  const address = request.address.trim();
  if (!isAddress(address)) throw new WardInputError("This is not a Solana address.");
  const known = (request.known ?? []).filter((entry) => entry !== address);
  const states = await reads.accounts([address]).catch(() => null);
  if (!states) return { subject: "unread" };
  const state = states.get(address) ?? null;
  /* The epoch only decides which transfer fee is in force: asked for a token's account alone. */
  const epoch = state && TOKEN_PROGRAMS.has(state.owner) && reads.epoch ? await reads.epoch().catch(() => null) : null;
  const mint = readMint(state, epoch);
  if (!mint) return { subject: "address", result: await checkLink({ link: address, known }, reads, network, now) };

  const reasons = new Reasons();
  /* A mint ground to look like another one the asker has seen is how a fake «CA» passes for the real token. */
  const twin = known.find((entry) => looksLike(address, entry));
  if (twin) {
    reasons.add(
      "RECIPIENT_LOOKALIKE",
      `${short(address)} looks like ${short(twin)} but is another token.`,
      `The mint ${address} shares its first and last characters with ${twin}, an address the asker has seen. Addresses ground to look alike are how a fake token passes for the real one.`,
      [address, twin],
      "Comparison with the addresses this check was given",
    );
  }
  /* Without a transaction there is no arrival to simulate; a mint whose new accounts start frozen says it itself. */
  if (mint.frozenByDefault) {
    const name = symbolOf(address);
    reasons.add("TOKEN_FROZEN_ON_ARRIVAL", `${name} arrives frozen — a new holder could not move it.`, `New accounts of the mint ${address} start frozen${mint.freezeAuthority ? `, and only ${mint.freezeAuthority} can thaw them` : ""}.`, [address], CHAIN_SOURCE);
  }
  await tokenReasons(reasons, { received: [address], sent: [], mints: new Map([[address, mint]]), effects: null, signer: null, reads });
  const sorted = reasons.sorted();
  const verdict = verdictOf(sorted);
  return {
    subject: "token",
    result: {
      schema: "ryntra.ward.token",
      schemaVersion: "1.0.0",
      verdict,
      line: verdict === "allow" ? "Nothing known stands against this token." : lineOf(verdict, sorted),
      reasons: sorted,
      notRead: sorted.filter((reason) => reason.level === "unknown").length,
      mint: address,
      symbol: KNOWN_MINTS[address]?.symbol ?? null,
      program: mint.program,
      network,
      checkedAt: now.toISOString(),
    },
  };
}
