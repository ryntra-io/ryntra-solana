/**
 * What a receipt this browser keeps says in words: its kind, the one line of
 * what moved, how it ended and when. Pure — read from the receipt's own signed
 * facts, never from anything around it — so the receipts page and Home say a
 * receipt the same way.
 */

import type { SolanaWalletAction } from "../../../../lib/solana/action-ledger.ts";
import { displayAmount } from "../../../../lib/solana/amounts.ts";
import { crossSwapReceiptSummary, launchTradeReceiptSummary, receiptMatchesAction, type StoredReceiptView } from "../../../../lib/solana/receipt-view.ts";

export function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

export function outcomeOf(receipt: Record<string, unknown>): Record<string, unknown> | null {
  return record(receipt.outcome);
}

/**
 * The swap facts, reassembled from the chunks the receipt stores them in.
 *
 * `buildSwapReceiptFacts` writes one JSON document and the receipt carries it
 * split across four `observedEffects` descriptions, each tagged `#n/4` in its
 * `sourceRef`. Anything unexpected — a missing chunk, a re-ordering, a
 * document that will not parse — returns null and the caller keeps the
 * literal status. This never invents a reading.
 */
function swapFacts(outcome: Record<string, unknown> | null): Record<string, unknown> | null {
  const effects = Array.isArray(outcome?.observedEffects) ? outcome.observedEffects.map(record) : [];
  const chunks: { index: number; body: string }[] = [];
  for (const effect of effects) {
    const ref = typeof effect?.sourceRef === "string" ? effect.sourceRef : "";
    const body = typeof effect?.description === "string" ? effect.description : "";
    if (!ref.startsWith("ryntra.solana.swap-receipt.facts@")) continue;
    const position = /#(\d+)\/(\d+)$/.exec(ref);
    if (!position) continue;
    chunks.push({ index: Number(position[1]), body });
  }
  if (chunks.length === 0) return null;
  chunks.sort((left, right) => left.index - right.index);
  try {
    return record(JSON.parse(chunks.map((chunk) => chunk.body).join("")));
  } catch {
    return null;
  }
}

/**
 * What a swap that went right is allowed to be called.
 *
 * `OUTPUT_MISMATCH` fires whenever the fill differs from the quote by a single
 * raw unit, which is every honest swap — a quote is an estimate and the fill is
 * the fill — so `MATCHED` is unreachable here and every customer receipt was
 * headed *Deviation recorded*. The promise a swap makes is the **minimum**, not
 * the quote, and the receipt should say whether that promise was kept.
 *
 * Softened only when both structural conditions hold and nothing else deviated:
 * the minimum was met, and the only codes present are the two that carry no
 * consequence for the person — the fill differing from the estimate, and our own
 * failure to read the provider's copy of a transaction the chain already
 * confirmed independently. A fee mismatch, an input mismatch, a provider
 * signature mismatch or a missed minimum all keep the literal status, because
 * each of those is something a reader must not be soothed about.
 *
 * The signed JSON is untouched: `DEVIATION_RECORDED` and the full deviation
 * list remain exactly where an auditor looks for them, and *Verify receipt*
 * still shows them. Only the sentence a person reads changes.
 */
const CONSEQUENCE_FREE_DEVIATIONS = new Set(["OUTPUT_MISMATCH", "PROVIDER_EVIDENCE_UNAVAILABLE"]);

export function settledLabel(
  outcome: Record<string, unknown> | null,
  text: (value: string) => string,
): string | null {
  if (outcome?.status !== "DEVIATION_RECORDED") return null;
  const facts = swapFacts(outcome);
  const reconciliation = record(facts?.reconciliation);
  if (reconciliation?.minimumMet !== true) return null;
  const deviations = Array.isArray(reconciliation.deviations) ? reconciliation.deviations : null;
  if (!deviations || !deviations.every((code) => CONSEQUENCE_FREE_DEVIATIONS.has(String(code)))) return null;

  const settled = text("Settled");
  let delta: bigint;
  let quoted: bigint;
  try {
    delta = BigInt(String(reconciliation.outputDeltaRaw));
    quoted = BigInt(String(record(facts?.quote)?.outputRaw));
  } catch {
    return settled;
  }
  if (delta === 0n || quoted <= 0n) return settled;

  const share = (Number(delta < 0n ? -delta : delta) / Number(quoted)) * 100;
  const shown = share < 0.01 ? "<0.01" : share.toFixed(2);
  return delta < 0n
    ? `${settled} · ${shown}% ${text("below the quote, above your minimum")}`
    : `${settled} · ${shown}% ${text("above the quote")}`;
}

export function outcomeLabel(status: unknown, text: (value: string) => string): string {
  if (status === "MATCHED") return text("Matched");
  if (status === "DEVIATION_RECORDED") return text("Deviation recorded");
  if (status === "FAILED") return text("Failed");
  return text("Receipt");
}


/**
 * The signed facts of a bridge receipt, put back together.
 *
 * The issuer splits the facts JSON across numbered observed effects, each one
 * tagged `…#n/N` in its `sourceRef`, so reassembling them is deterministic
 * rather than a guess. Done defensively on purpose: a receipt whose shape this
 * does not recognise yields `null` and every caller falls back to what it
 * showed before, because a receipts page that throws is worse than a receipts
 * page that is terse.
 */
function bridgeFacts(receipt: Record<string, unknown>): Record<string, unknown> | null {
  const outcome = record(receipt.outcome);
  const effects = Array.isArray(outcome?.observedEffects) ? outcome.observedEffects.map(record) : [];
  const chunks: { at: number; body: string }[] = [];
  for (const effect of effects) {
    const ref = String(effect?.sourceRef ?? "");
    if (!ref.includes("ryntra.solana.bridge-receipt.facts@")) continue;
    const numbered = /#(\d+)\/(\d+)$/.exec(ref);
    if (!numbered) continue;
    chunks.push({ at: Number(numbered[1]), body: String(effect?.description ?? "") });
  }
  if (chunks.length === 0) return null;
  chunks.sort((left, right) => left.at - right.at);
  try {
    return record(JSON.parse(chunks.map((chunk) => chunk.body).join("")));
  } catch {
    return null;
  }
}

/**
 * The one line a person actually reads on a bridge receipt.
 *
 * Its id is not that line. An `outcome_solana_bridge_…` id was the primary
 * identifier on this screen in production on 2026-09-04, above a status word
 * and nothing else — no amount, no direction, no chains. That is internal text
 * on a customer page, where it does not belong, and it is also simply
 * useless: a person with three bridge receipts could not tell which was which.
 *
 * The chain names are proper nouns and stay in both locales.
 */
function bridgeLine(receipt: Record<string, unknown>): string | null {
  const facts = bridgeFacts(receipt);
  if (facts === null) return null;
  const amounts = record(facts.amounts);
  const raw =
    typeof amounts?.mintedRaw === "string"
      ? amounts.mintedRaw
      : typeof amounts?.burnedRaw === "string"
        ? amounts.burnedRaw
        : null;
  if (raw === null) return null;
  const lane = facts.direction === "BASE_TO_SOLANA" ? "Base → Solana" : "Solana → Base";
  return `${displayAmount(raw, 6)} USDC · ${lane}`;
}

/**
 * Which kind of receipt this is.
 *
 * Bridge receipts were titled `Send receipt` in production, because the only
 * test here was whether a registry ref mentioned a swap and a bridge mentions
 * none. A bridge and a send were therefore indistinguishable on the one screen
 * whose job is to tell a person what happened.
 */
export type ReceiptKind = "bridge" | "launch" | "swap" | "send";

export function receiptKindOf(receipt: Record<string, unknown>): ReceiptKind {
  /* Asked before the two below, because a cross-chain receipt pins the same
     Solana adapter a send does and would otherwise be titled `Send receipt` —
     the exact defect that made bridges and sends indistinguishable here in
     production on 2026-09-04, one lane later. */
  if (crossSwapReceiptSummary(receipt) !== null) return "bridge";
  if (String(receipt.id ?? "").startsWith("outcome_solana_bridge_") || bridgeFacts(receipt) !== null) return "bridge";
  const registry = record(receipt.registry);
  const refs = Array.isArray(registry?.refs) ? registry.refs.map(record) : [];
  const joined = refs.map((entry) => String(entry?.ref ?? "")).join(" ").toLowerCase();
  /* A launch's trade pins Meteora's launch adapter, not a swap's: asked first, or it would read as a send. */
  if (joined.includes("meteora-launch")) return "launch";
  return joined.includes("swap") ? "swap" : "send";
}

const KIND_LABEL: Readonly<Record<ReceiptKind, string>> = { bridge: "Bridge receipt", launch: "Launch trade receipt", swap: "Swap receipt", send: "Send receipt" };

export function receiptLabel(receipt: Record<string, unknown>, text: (value: string) => string): string {
  return text(KIND_LABEL[receiptKindOf(receipt)]);
}

function movement(movement: SolanaWalletAction["out"]): string | null {
  if (!movement || movement.decimals === null) return movement?.symbol ?? null;
  const amount = displayAmount(movement.amountRaw, movement.decimals);
  return movement.symbol ? `${amount} ${movement.symbol}` : amount;
}

/**
 * The one line a person reads on a cross-chain receipt.
 *
 * Read from the receipt's own signed facts rather than from the History row
 * beside it, so a receipt opened on a device whose Activity has not loaded still
 * says what it is. Chain names are proper nouns and stay in both locales.
 */
function crossSwapLine(receipt: Record<string, unknown>): string | null {
  const summary = crossSwapReceiptSummary(receipt);
  if (!summary) return null;
  const leg = (side: { amountRaw: string; symbol: string | null; decimals: number | null } | null): string | null => {
    if (!side || side.decimals === null) return side?.symbol ?? null;
    const amount = displayAmount(side.amountRaw, side.decimals);
    return side.symbol ? `${amount} ${side.symbol}` : amount;
  };
  const sent = leg(summary.sent);
  const received = leg(summary.received);
  const lane = `${summary.from} → ${summary.to}`;
  if (sent && received) return `${sent} → ${received} · ${lane}`;
  return sent ? `${sent} · ${lane}` : lane;
}

/** When a receipt says its operation settled; the moment this device kept it only when the receipt names none. */
export function receiptTime(receipt: Record<string, unknown>, storedAt: string): string {
  const created = typeof receipt.createdAt === "string" ? receipt.createdAt : null;
  return created && !Number.isNaN(Date.parse(created)) ? created : storedAt;
}

/** A launch's trade from its receipt's own facts: what was spent, what arrived. */
function launchTradeLine(receipt: Record<string, unknown>): string | null {
  const summary = launchTradeReceiptSummary(receipt);
  if (!summary) return null;
  const leg = (side: { amountRaw: string; symbol: string; decimals: number }) => `${displayAmount(side.amountRaw, side.decimals)} ${side.symbol}`;
  return `${leg(summary.spent)} → ${leg(summary.received)}`;
}

export function operationLine(action: SolanaWalletAction | null, receipt: Record<string, unknown>, text: (value: string) => string) {
  const cross = crossSwapLine(receipt);
  if (cross) return cross;
  const launch = launchTradeLine(receipt);
  if (launch) return launch;
  const bridge = bridgeLine(receipt);
  if (bridge) return bridge;
  if (!action) return text("Details not available");
  const out = movement(action.out);
  const incoming = movement(action.in);
  if (action.lane === "SWAP" || action.lane === "CROSS_SWAP") {
    if (out && incoming) return `${out} → ${incoming}`;
    return out ?? incoming ?? text("Details not available");
  }
  return out ?? incoming ?? text("Details not available");
}

/** A receipt in one glance — Home's «Остання квитанція»: what it is, what moved, how it ended and when. */
export type ReceiptGlance = Readonly<{
  kind: ReceiptKind;
  line: string;
  status: "completed" | "failed" | "unknown";
  /** The operation happened, and the receipt recorded something the reader must not be soothed about. */
  deviation: boolean;
  time: string;
}>;

/**
 * How a receipt ended, in the card's words — the receipts page's own verdict.
 * Every recorded outcome is final. A deviation is recorded only for an
 * operation that landed, so it is done: with no consequence for the person
 * (`settledLabel`) it reads as done and nothing more; any other — a missed
 * minimum, a fee or input mismatch, a bridge's — happened and says so. Only a
 * receipt with no outcome at all is unknown.
 */
export function receiptStatusOf(outcome: Record<string, unknown> | null): Readonly<{ status: ReceiptGlance["status"]; deviation: boolean }> {
  if (outcome?.status === "MATCHED") return { status: "completed", deviation: false };
  if (outcome?.status === "FAILED") return { status: "failed", deviation: false };
  if (outcome?.status === "DEVIATION_RECORDED") return { status: "completed", deviation: settledLabel(outcome, (value) => value) === null };
  return { status: "unknown", deviation: false };
}

export function receiptGlance(row: StoredReceiptView, actions: readonly SolanaWalletAction[], text: (value: string) => string): ReceiptGlance {
  const receipt = row.receipt as Record<string, unknown>;
  const action = actions.find((candidate) => receiptMatchesAction(row, candidate)) ?? null;
  return { kind: receiptKindOf(receipt), line: operationLine(action, receipt, text), ...receiptStatusOf(outcomeOf(receipt)), time: receiptTime(receipt, row.storedAt) };
}
