/**
 * What a person put into «Кому» — typed, pasted or scanned — read once, on the
 * server, so a phone does not parse Solana Pay by itself (contract 1.22.0).
 *
 * Three things arrive in that field in practice: a wallet's address, a Solana
 * Pay transfer request (`solana:<recipient>?amount=&spl-token=&reference=…`,
 * the QR every wallet and shop shows) and a Ryntra payment link
 * (`https://ryntra.io/pay/<id>`, the link «Отримати» shares). They are told
 * apart here and nothing else is decided: whether the chain can pay the
 * address, whether a reference belongs to a Ryntra link, whether the link is
 * still open — those are reads, and the recipient check does them.
 *
 * Pure and total: no clock, no network, no throw.
 */

import { addressProblem, BASE58_PUBKEY, type AddressProblem } from "./address.ts";

/** The longest input read; a QR of a Solana Pay request is far below it. */
export const SEND_TARGET_MAX = 2_048;

export const SEND_TARGET_PROBLEMS = [
  "EMPTY",
  "NOT_AN_ADDRESS",
  "MISREAD_CHARACTER",
  "WRONG_LENGTH",
  /** A `solana:` request whose recipient, amount, token or reference is not well formed. */
  "REQUEST_INVALID",
  /** A Solana Pay *transaction* request (`solana:https://…`): the paying wallet asks a shop's server for the transaction — a wallet app pays it, a transfer cannot. */
  "REQUEST_UNSUPPORTED",
  /** A Ryntra payment-link address whose id cannot be one. */
  "LINK_INVALID",
] as const;
export type SendTargetProblem = (typeof SEND_TARGET_PROBLEMS)[number];

export type SendTargetInput = "address" | "solana-pay" | "pay-link";

export type SolanaPayAsk = Readonly<{
  /** Display units, exactly as the request states them; null when the request leaves the amount to the payer. */
  amount: string | null;
  /** The requested token, or null for SOL. */
  mint: string | null;
  references: readonly string[];
  label: string | null;
  message: string | null;
  memo: string | null;
}>;

export type SendTarget =
  | Readonly<{ kind: "address"; address: string }>
  | Readonly<{ kind: "solana-pay"; address: string; ask: SolanaPayAsk }>
  | Readonly<{ kind: "pay-link"; id: string }>
  | Readonly<{ kind: "invalid"; input: SendTargetInput; problem: SendTargetProblem }>;

const PUBLIC_ID = /^[1-9A-HJ-NP-Za-km-z]{14,20}$/;
/** Solana Pay's amount: a non-negative decimal with a leading digit, no sign, no exponent. Leading zeros are read (a link typed as `05` states them) and dropped. */
const PAY_AMOUNT = /^[0-9]+(\.[0-9]+)?$/;
const TEXT_MAX = 200;
/** The longest amount read: forty digits and a point are beyond any token's supply. */
const AMOUNT_MAX = 41;

/**
 * Read one input. `linkHosts` are the hosts whose `/pay/<id>` is a Ryntra
 * payment link (the deployment's own and `ryntra.io`); any other web address
 * is not something a transfer can be sent to.
 */
export function readSendTarget(value: string, linkHosts: readonly string[]): SendTarget {
  const trimmed = value.trim();
  if (trimmed === "") return { kind: "invalid", input: "address", problem: "EMPTY" };

  if (/^solana:/i.test(trimmed)) return readSolanaPay(trimmed.slice("solana:".length));

  if (/^https?:\/\//i.test(trimmed)) {
    let url: URL;
    try {
      url = new URL(trimmed);
    } catch {
      return { kind: "invalid", input: "address", problem: "NOT_AN_ADDRESS" };
    }
    const host = url.host.toLowerCase();
    const match = /^\/pay\/([^/]+)\/?$/.exec(url.pathname);
    if (!linkHosts.map((entry) => entry.toLowerCase()).includes(host) || !match) {
      return { kind: "invalid", input: "address", problem: "NOT_AN_ADDRESS" };
    }
    const id = decodeSafely(match[1]);
    return id !== null && PUBLIC_ID.test(id) ? { kind: "pay-link", id } : { kind: "invalid", input: "pay-link", problem: "LINK_INVALID" };
  }

  const problem: AddressProblem | null = addressProblem(trimmed);
  return problem === null ? { kind: "address", address: trimmed } : { kind: "invalid", input: "address", problem };
}

function readSolanaPay(rest: string): SendTarget {
  const [path, query = ""] = splitOnce(rest, "?");
  const recipient = decodeSafely(path);
  if (recipient === null) return { kind: "invalid", input: "solana-pay", problem: "REQUEST_INVALID" };
  /* A transaction request carries a URL where the recipient would be. */
  if (/^https?:/i.test(recipient)) return { kind: "invalid", input: "solana-pay", problem: "REQUEST_UNSUPPORTED" };
  if (!BASE58_PUBKEY.test(recipient)) return { kind: "invalid", input: "solana-pay", problem: "REQUEST_INVALID" };

  let params: URLSearchParams;
  try {
    params = new URLSearchParams(query);
  } catch {
    return { kind: "invalid", input: "solana-pay", problem: "REQUEST_INVALID" };
  }
  const single = (name: string): string | null | undefined => {
    const all = params.getAll(name);
    if (all.length > 1) return undefined;
    const entry = all[0];
    return entry === undefined || entry === "" ? null : entry;
  };
  const amount = single("amount");
  const mint = single("spl-token");
  const label = single("label");
  const message = single("message");
  const memo = single("memo");
  if ([amount, mint, label, message, memo].some((entry) => entry === undefined)) {
    return { kind: "invalid", input: "solana-pay", problem: "REQUEST_INVALID" };
  }
  if (amount !== null && ((amount as string).length > AMOUNT_MAX || !PAY_AMOUNT.test(amount as string))) return { kind: "invalid", input: "solana-pay", problem: "REQUEST_INVALID" };
  if (mint !== null && !BASE58_PUBKEY.test(mint as string)) return { kind: "invalid", input: "solana-pay", problem: "REQUEST_INVALID" };
  const references = params.getAll("reference");
  if (references.some((reference) => !BASE58_PUBKEY.test(reference)) || references.length > 8) {
    return { kind: "invalid", input: "solana-pay", problem: "REQUEST_INVALID" };
  }
  return {
    kind: "solana-pay",
    address: recipient,
    ask: {
      amount: amount === null ? null : canonicalAmount(amount as string),
      mint: (mint as string | null) ?? null,
      references,
      label: clip(label as string | null),
      message: clip(message as string | null),
      memo: clip(memo as string | null),
    },
  };
}

/** `05` → `5`, `007.50` → `7.50`, `00.5` → `0.5`: one way to write the same amount. */
function canonicalAmount(value: string): string {
  const [whole, fraction] = splitOnce(value, ".");
  const trimmed = whole.replace(/^0+(?=\d)/, "");
  return fraction === undefined ? trimmed : `${trimmed}.${fraction}`;
}

function splitOnce(value: string, separator: string): [string, string | undefined] {
  const index = value.indexOf(separator);
  return index === -1 ? [value, undefined] : [value.slice(0, index), value.slice(index + 1)];
}

function decodeSafely(value: string): string | null {
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}

function clip(value: string | null): string | null {
  if (value === null) return null;
  const tidy = value.replace(/\s+/g, " ").trim();
  if (tidy === "") return null;
  return tidy.length > TEXT_MAX ? `${tidy.slice(0, TEXT_MAX - 1)}…` : tidy;
}
