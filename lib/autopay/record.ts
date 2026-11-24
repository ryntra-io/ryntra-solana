/**
 * An autopay as the book keeps it and the screen reads it: public addresses, the schedule's numbers as
 * strings, the book's state and each window's payment. Never a key. `autopayOf` turns a record back into the terms the
 * executor builds and signs from; a record that does not read back whole is not one the executor works.
 *
 * Pure.
 */

import { PublicKey } from "@solana/web3.js";

import { ssaAddress } from "../mandate/ssa.ts";
import type { Autopay } from "./enable.ts";
import { AUTOPAY_VAULT_FIRST, AUTOPAY_VAULT_LAST, type AutopayNetwork } from "./policy.ts";
import { AUTOPAY_COINS, AUTOPAY_EVERY, COUNT_MAX, endsAt, type AutopayCoin, type AutopayEvery } from "./schedule.ts";
import type { AutopayStatus } from "./signer.server.ts";

/** What happened to one window's payment: on its way, landed, refused or failed on chain, or missed. */
export const PAYMENT_STATES = ["sending", "paid", "failed", "missed"] as const;
export type PaymentState = (typeof PAYMENT_STATES)[number];

export type PaymentRow = Readonly<{
  window: number;
  state: PaymentState;
  signature: string | null;
  at: string;
  /** The executor's claims of this window so far; only the latest may sign. */
  attempts?: number;
  /** On its way: unsigned — when the claim lapses; signed — when the chain is read for it again. ISO; null — settled. */
  checkAt?: string | null;
  /** On its way and signed: the last block height its blockhash is good for. */
  validHeight?: number | null;
}>;

export type AutopayRecord = Readonly<{
  id: string;
  network: AutopayNetwork;
  owner: string;
  agent: string;
  settings: string;
  vault: string;
  vaultIndex: number;
  policy: string;
  policySeed: string;
  coin: AutopayCoin;
  recipient: string;
  /** The contact's name or the `.skr` name the person chose the recipient by; null — an address typed as it is. */
  label: string | null;
  /** One payment, the coin's base units. */
  amount: string;
  every: AutopayEvery;
  count: number;
  /** Unix seconds. */
  startAt: number;
  endsAt: number;
  status: AutopayStatus;
  createdAt: string;
  updatedAt: string;
  payments: readonly PaymentRow[];
}>;

/** The longest name of a recipient a record keeps — a contact's or a `.skr` name. */
export const LABEL_MAX = 64;

const ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const STATUSES: readonly AutopayStatus[] = ["working", "stopped", "ended"];
const isRecord = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const text = (value: unknown): string | null => (typeof value === "string" ? value : null);
const address = (value: unknown): string | null => (typeof value === "string" && ADDRESS.test(value) ? value : null);
const whole = (value: unknown): number | null => (typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null);

function paymentOf(raw: unknown): PaymentRow | null {
  if (!isRecord(raw)) return null;
  const window = whole(raw.window);
  const state = raw.state as PaymentState;
  if (window === null || !(PAYMENT_STATES as readonly string[]).includes(state)) return null;
  return {
    window,
    state,
    signature: text(raw.signature),
    at: text(raw.at) ?? "",
    attempts: whole(raw.attempts) ?? 0,
    checkAt: text(raw.checkAt),
    validHeight: whole(raw.validHeight),
  };
}

/** A record of the store's answer, or null when any field is not what the book writes. */
export function recordOf(raw: unknown): AutopayRecord | null {
  if (!isRecord(raw)) return null;
  const id = typeof raw.id === "string" && UUID.test(raw.id) ? raw.id : null;
  const network = raw.network === "devnet" || raw.network === "mainnet" ? raw.network : null;
  const owner = address(raw.owner);
  const agent = address(raw.agent);
  const settings = address(raw.settings);
  const vault = address(raw.vault);
  const policy = address(raw.policy);
  const recipient = address(raw.recipient);
  const vaultIndex = whole(raw.vaultIndex);
  const policySeed = typeof raw.policySeed === "string" && /^\d{1,20}$/.test(raw.policySeed) ? raw.policySeed : null;
  const coin = (AUTOPAY_COINS as readonly string[]).includes(raw.coin as string) ? (raw.coin as AutopayCoin) : null;
  const every = (AUTOPAY_EVERY as readonly string[]).includes(raw.every as string) ? (raw.every as AutopayEvery) : null;
  const amount = typeof raw.amount === "string" && /^[1-9]\d{0,19}$/.test(raw.amount) ? raw.amount : null;
  const count = whole(raw.count);
  const startAt = whole(raw.startAt);
  const ends = whole(raw.endsAt);
  const status = STATUSES.includes(raw.status as AutopayStatus) ? (raw.status as AutopayStatus) : null;
  if (!id || !network || !owner || !agent || !settings || !vault || !policy || !recipient || vaultIndex === null || !policySeed || !coin || !every || !amount || count === null || startAt === null || ends === null || !status) return null;
  if (vaultIndex < AUTOPAY_VAULT_FIRST || vaultIndex > AUTOPAY_VAULT_LAST || count < 1 || count > COUNT_MAX) return null;
  const payments = Array.isArray(raw.payments) ? raw.payments.map(paymentOf).filter((row): row is PaymentRow => row !== null) : [];
  return {
    id,
    network,
    owner,
    agent,
    settings,
    vault,
    vaultIndex,
    policy,
    policySeed,
    coin,
    recipient,
    label: typeof raw.label === "string" && raw.label.length >= 1 && raw.label.length <= LABEL_MAX ? raw.label : null,
    amount,
    every,
    count,
    startAt,
    endsAt: ends,
    status,
    createdAt: text(raw.createdAt) ?? "",
    updatedAt: text(raw.updatedAt) ?? "",
    payments,
  };
}

/** The record an autopay becomes once the person's transactions landed. */
export function recordFrom(input: Readonly<{ id: string; autopay: Autopay; label: string | null; at: string }>): AutopayRecord {
  const { autopay } = input;
  const { terms } = autopay;
  return {
    id: input.id,
    network: terms.network,
    owner: terms.human.toBase58(),
    agent: terms.agent.toBase58(),
    settings: autopay.settings.toBase58(),
    vault: autopay.vault.toBase58(),
    vaultIndex: autopay.vaultIndex,
    policy: autopay.policy.toBase58(),
    policySeed: autopay.policySeed.toString(),
    coin: terms.schedule.coin,
    recipient: terms.recipient.toBase58(),
    label: input.label,
    amount: terms.schedule.amount.toString(),
    every: terms.schedule.every,
    count: terms.schedule.count,
    startAt: Number(terms.schedule.startAt),
    endsAt: Number(endsAt(terms.schedule)),
    status: "working",
    createdAt: input.at,
    updatedAt: input.at,
    payments: [],
  };
}

/** The terms and accounts a record stands for, checked against the addresses they derive; null when it does not read back whole. */
export function autopayOf(record: AutopayRecord): Autopay | null {
  try {
    const settings = new PublicKey(record.settings);
    const vault = ssaAddress.vault(settings, record.vaultIndex);
    const policySeed = BigInt(record.policySeed);
    const policy = ssaAddress.policy(settings, policySeed);
    if (!vault.equals(new PublicKey(record.vault)) || !policy.equals(new PublicKey(record.policy))) return null;
    const schedule = { coin: record.coin, amount: BigInt(record.amount), every: record.every, count: record.count, startAt: BigInt(record.startAt) };
    if (Number(endsAt(schedule)) !== record.endsAt) return null;
    return {
      terms: { network: record.network, human: new PublicKey(record.owner), agent: new PublicKey(record.agent), recipient: new PublicKey(record.recipient), schedule },
      settings,
      vaultIndex: record.vaultIndex,
      vault,
      policy,
      policySeed,
    };
  } catch {
    return null;
  }
}

/** The windows whose payment was made or tried — never asked for again. */
export const doneWindows = (record: Pick<AutopayRecord, "payments">): ReadonlySet<number> => new Set(record.payments.filter((row) => row.state !== "missed").map((row) => row.window));

/** A claim nothing was ever sent for, whose time is up: its window may be claimed again (or, once closed, is missed). */
export const lapsed = (row: PaymentRow, nowMs: number): boolean => row.state === "sending" && !row.signature && !!row.checkAt && Date.parse(row.checkAt) <= nowMs;

/** The windows the executor does not claim now: every row but a missed one and a lapsed claim. */
export const takenWindows = (payments: readonly PaymentRow[], nowMs: number): ReadonlySet<number> =>
  new Set(payments.filter((row) => row.state !== "missed" && !lapsed(row, nowMs)).map((row) => row.window));

/** What a record has paid so far: the landed payments and their sum, the coin's base units. */
export function paidOf(record: Pick<AutopayRecord, "payments" | "amount">): Readonly<{ count: number; total: bigint }> {
  const count = record.payments.filter((row) => row.state === "paid").length;
  return { count, total: BigInt(record.amount) * BigInt(count) };
}
