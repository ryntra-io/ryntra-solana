/**
 * The intent check — what an agent (or a person) said a transaction would do, against what its simulation shows it
 * does. The case it exists for: an agent asked to send 4 SOL that signs away a quarter of a million dollars of
 * tokens (Lobstar Wilde, February 2026), or one whose memory was poisoned into paying an address it was never asked
 * to pay (ElizaOS, 2025). A scanner looks for what is malicious; this looks for what was not asked for.
 *
 * Deterministic and small on purpose: a typed intent, or one line in a fixed grammar (English or Ukrainian) that
 * reads into the same type. No model reads the line — a model can be talked into anything; this cannot.
 */

import { parseHumanAmount } from "../solana/amounts.ts";
import { mintOfSymbol } from "./known.ts";

const ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

/** `mint: null` is SOL. Amounts are plain decimals in the asset's own units. */
export type WardIntent =
  | Readonly<{ kind: "transfer"; to: string; amount: string; mint: string | null }>
  | Readonly<{ kind: "swap"; give: Readonly<{ mint: string | null; amount: string }>; get: Readonly<{ mint: string | null; min: string | null }> }>;

export type IntentRead = Readonly<{ ok: true; intent: WardIntent }> | Readonly<{ ok: false; why: string }>;

const SEND = "(?:send|transfer|pay|give|надішли|надіслати|відправ|відправити|переказати|переказ|заплати|сплати)";
const SWAP = "(?:swap|exchange|convert|trade|sell|обміняй|обміняти|обмін|продай|продати|конвертуй)";
const AMOUNT = "(\\d+(?:[.,]\\d+)?)";
const ASSET = "([A-Za-z]{2,10}|[1-9A-HJ-NP-Za-km-z]{32,44})";
const TO = "(?:to|на|до|для|→|->)";
const FOR = "(?:for|to|into|на|в|у|за|→|->)";

function asset(text: string): Readonly<{ ok: true; mint: string | null }> | Readonly<{ ok: false }> {
  if (ADDRESS.test(text) && text.length >= 32) return { ok: true, mint: text };
  const mint = mintOfSymbol(text);
  return mint === undefined ? { ok: false } : { ok: true, mint };
}

const amountOf = (text: string): string => text.replace(",", ".");

/**
 * One line, read into an intent: «send 4 SOL to <address>», «swap 1 SOL for USDC», «надіслати 25 USDC на <адреса>»,
 * «обміняти 0.5 SOL на USDC». Symbols: SOL, USDC, USDT, PYUSD; any other asset by its mint address.
 */
export function readIntentText(line: string): IntentRead {
  const text = line.trim().replace(/\s+/g, " ");
  if (text.length === 0) return { ok: false, why: "The intent is empty." };
  if (text.length > 280) return { ok: false, why: "The intent is longer than one line." };
  const send = new RegExp(`^${SEND} ${AMOUNT} ${ASSET} ${TO} ([1-9A-HJ-NP-Za-km-z]{32,44})\\.?$`, "iu").exec(text);
  if (send) {
    const what = asset(send[2]);
    if (!what.ok) return { ok: false, why: `«${send[2]}» is not an asset this check can name; use its mint address.` };
    return { ok: true, intent: { kind: "transfer", to: send[3], amount: amountOf(send[1]), mint: what.mint } };
  }
  const swap = new RegExp(`^${SWAP} ${AMOUNT} ${ASSET} ${FOR} (?:at least ${AMOUNT} |щонайменше ${AMOUNT} )?${ASSET}\\.?$`, "iu").exec(text);
  if (swap) {
    const give = asset(swap[2]);
    const get = asset(swap[5]);
    if (!give.ok) return { ok: false, why: `«${swap[2]}» is not an asset this check can name; use its mint address.` };
    if (!get.ok) return { ok: false, why: `«${swap[5]}» is not an asset this check can name; use its mint address.` };
    const min = swap[3] ?? swap[4] ?? null;
    return { ok: true, intent: { kind: "swap", give: { mint: give.mint, amount: amountOf(swap[1]) }, get: { mint: get.mint, min: min === null ? null : amountOf(min) } } };
  }
  return { ok: false, why: "The line does not read as «send 4 SOL to <address>» or «swap 1 SOL for USDC»." };
}

/** The raw amount of a decimal in an asset's units, or null where it does not fit them. */
export function rawOf(amount: string, decimals: number): bigint | null {
  const parsed = parseHumanAmount(amount, decimals);
  return parsed.ok ? BigInt(parsed.raw) : null;
}

export type IntentFinding = Readonly<{
  code: "INTENT_MATCH" | "INTENT_AMOUNT_OVER" | "INTENT_AMOUNT_UNDER" | "INTENT_RECIPIENT" | "INTENT_ASSET" | "INTENT_NOT_RECEIVED" | "INTENT_UNREADABLE";
  mint?: string | null;
  declaredRaw?: bigint;
  actualRaw?: bigint;
  holders?: readonly string[];
}>;

export type IntentEvidence = Readonly<{
  signer: string;
  /** Net change per holder and asset (`mint: null` is SOL). */
  changes: readonly Readonly<{ holder: string; mint: string | null; raw: bigint }>[];
  /** What the transaction may spend in SOL on itself — the fee and the rent it locks — beyond any declared amount. */
  costLamports: bigint;
  decimalsOf: (mint: string | null) => number | null;
  /** Token accounts by address, so a declared token-account recipient is matched to its holder. */
  ownerOfAccount: (address: string) => string | null;
}>;

/** SOL a transaction may lose to rounding in a simulated fee beyond the stated cost (0.00001 SOL). */
const SOL_SLACK = 10_000n;

/**
 * Compare a declared intent with the simulated changes. Every difference is its own finding; agreement on every point
 * is one `INTENT_MATCH`.
 */
export function compareIntent(intent: WardIntent, evidence: IntentEvidence): readonly IntentFinding[] {
  const { signer, changes } = evidence;
  const mine = (mint: string | null) => changes.filter((change) => change.holder === signer && change.mint === mint).reduce((sum, change) => sum + change.raw, 0n);
  const spentOf = (mint: string | null) => {
    const net = mine(mint);
    return net < 0n ? -net : 0n;
  };
  const findings: IntentFinding[] = [];
  const allowance = (mint: string | null) => (mint === null ? evidence.costLamports + SOL_SLACK : 0n);
  const declaredMints = intent.kind === "transfer" ? [intent.mint] : [intent.give.mint];

  const giveMint = intent.kind === "transfer" ? intent.mint : intent.give.mint;
  const giveAmount = intent.kind === "transfer" ? intent.amount : intent.give.amount;
  const giveDecimals = evidence.decimalsOf(giveMint);
  const declaredRaw = giveDecimals === null ? null : rawOf(giveAmount, giveDecimals);
  if (declaredRaw === null) return [{ code: "INTENT_UNREADABLE", mint: giveMint }];

  const spent = spentOf(giveMint);
  if (spent > declaredRaw + allowance(giveMint)) findings.push({ code: "INTENT_AMOUNT_OVER", mint: giveMint, declaredRaw, actualRaw: spent });
  else if (intent.kind === "transfer" && spent + (giveMint === null ? SOL_SLACK : 0n) < declaredRaw) {
    findings.push({ code: "INTENT_AMOUNT_UNDER", mint: giveMint, declaredRaw, actualRaw: spent });
  }

  /* Every other asset the signer loses is one nobody declared. SOL beyond the fee and rent counts too. */
  const lost = new Set(changes.filter((change) => change.holder === signer && change.raw < 0n).map((change) => change.mint));
  for (const mint of lost) {
    if (declaredMints.includes(mint)) continue;
    const amount = spentOf(mint);
    if (amount > allowance(mint)) findings.push({ code: "INTENT_ASSET", mint, actualRaw: amount });
  }

  if (intent.kind === "transfer") {
    /* Who gains what the signer gave. A declared token account counts as its holder. */
    const declaredHolder = evidence.ownerOfAccount(intent.to) ?? intent.to;
    const gainers = changes.filter((change) => change.holder !== signer && change.mint === giveMint && change.raw > 0n);
    const others = gainers.filter((change) => change.holder !== declaredHolder && change.holder !== intent.to);
    const reached = gainers.some((change) => change.holder === declaredHolder || change.holder === intent.to);
    if (others.length > 0 || (!reached && spent > allowance(giveMint))) {
      findings.push({ code: "INTENT_RECIPIENT", mint: giveMint, holders: [...new Set(others.map((change) => change.holder))] });
    }
  } else {
    const getDecimals = evidence.decimalsOf(intent.get.mint);
    const gain = mine(intent.get.mint);
    const minRaw = intent.get.min === null || getDecimals === null ? 1n : rawOf(intent.get.min, getDecimals) ?? 1n;
    if (gain < minRaw) findings.push({ code: "INTENT_NOT_RECEIVED", mint: intent.get.mint, declaredRaw: minRaw, actualRaw: gain > 0n ? gain : 0n });
  }

  return findings.length === 0 ? [{ code: "INTENT_MATCH" }] : findings;
}
