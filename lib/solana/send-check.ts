/**
 * «Перевірка» of a transfer, counted by the server (contract 1.22.0).
 *
 * The web's «Надіслати» card draws its Review from the plan answer on the
 * client: what leaves, the issuer's fee, what arrives, the network's fee, the
 * cost of opening the recipient's account; whether the wallet may be opened;
 * why not; and the list a person reads before confirming. A phone that drew
 * the same screen would have to repeat every one of those rules. So the plan
 * and adopt routes answer them beside the bundle, from the same functions the
 * card calls — `canSubmitSendAction`, `assessSendReadiness`,
 * `sendWarningCopy`, `sendReadinessCopy` — and in the web's own words, English
 * and Ukrainian, from the web's own catalogue. Amounts are exact decimals in
 * the token's units and in SOL; a client formats them and counts nothing.
 *
 * One line is said more exactly than the card says it: the cost of an account
 * the transfer opens is the sender's only for a token (`setup` — the
 * recipient's token account, paid on top), while for SOL sent to an address
 * with no account it is the least the transfer itself must carry (`minimum`),
 * never an extra cost.
 *
 * Pure: no clock, no network.
 */

import { sendReadinessCopy, sendWarningCopy } from "../../app/solana/workspace/send/send-copy.ts";
import { translateSolana } from "../../app/solana/workspace/i18n/catalog.ts";
import { exactDecimal } from "./amounts.ts";
import type { SolanaPolicyVerdict, SplTransferPreflight } from "./contracts.ts";
import { assessSendReadiness } from "./send-readiness.ts";
import { canSubmitSendAction, type SendSafetyVerdict } from "./send-safety.ts";
import type { SendSupportVerdict } from "./send-support.ts";
import type { TransferPlan } from "./transaction.ts";

export type SendCheckWords = Readonly<{ en: string; uk: string }>;

/** An account's rent: both figures, or both null when the server could not read it. */
export type SendCheckRent = Readonly<{ lamports: string; sol: string }> | Readonly<{ lamports: null; sol: null }>;

export type SendCheck = Readonly<{
  /** The asset sent: `mint` null for SOL. */
  asset: Readonly<{ mint: string | null; decimals: number }>;
  from: string;
  to: Readonly<{
    /** What was entered: a wallet, or a token account entered on purpose. */
    address: string;
    kind: "wallet" | "token-account";
    /** Whose money it becomes — for a token account, its recorded owner. */
    owner: string;
    /** The account that receives: the recipient's token account, or the wallet itself for SOL. */
    account: string;
    opensAccount: boolean;
  }>;
  /** «Надсилаєш». */
  send: Readonly<{ raw: string; amount: string }>;
  /** «Комісія емітента» — what the token's own transfer-fee extension keeps; null when it keeps nothing. */
  issuerFee: Readonly<{ raw: string; amount: string; basisPoints: number }> | null;
  /** «Отримувач отримає»; `less` when it is less than what leaves (the card says it only then). */
  receive: Readonly<{ raw: string; amount: string; less: boolean }>;
  /** «Комісія мережі (оцінка)» — the base fee and the priority fee. */
  networkFee: Readonly<{ lamports: string; sol: string }>;
  /** «Відкриття рахунку» — a token account opened for the recipient, paid by the sender on top; null when none opens. Its figures null: the rent could not be read (and the wallet stays closed). */
  setup: SendCheckRent | null;
  /** SOL to an address with no account yet: the least this transfer must carry (never an extra cost); null when it has one. Its figures null: unread. */
  minimum: SendCheckRent | null;
  /** The wallet may be opened for this exact Review. */
  signable: boolean;
  /** Why a Review the safety verdict would open is not ready — the card's line under the Review; null otherwise. */
  blocked: (SendCheckWords & Readonly<{ code: string }>) | null;
  /** «Прочитай перед підтвердженням»: each finding once, in the card's order; `stops` when it is a reason the transfer cannot happen. */
  warnings: readonly (SendCheckWords & Readonly<{ code: string; stops: boolean }>)[];
}>;

/** The card's fallback when the safety verdict closes the wallet and no finding says why. */
export const SEND_NOT_SENDABLE = "NOT_SENDABLE";

export type SendCheckInput = Readonly<{
  plan: TransferPlan;
  preflight: SplTransferPreflight;
  verdict: SolanaPolicyVerdict;
  support: SendSupportVerdict;
  safety: SendSafetyVerdict;
  reviewProof: Readonly<{ status: "SIGNED" | "UNSIGNED" }>;
}>;

const english = (text: string) => text;
const ukrainian = (text: string) => translateSolana("uk", text);

function sol(lamports: bigint): string {
  return exactDecimal(lamports.toString(), 9);
}

function digits(value: string | null | undefined): bigint {
  return value !== null && value !== undefined && /^\d+$/.test(value) ? BigInt(value) : 0n;
}

/** A figure the server read, or both null for one it could not — never a zero standing in for an unknown. */
function rentOrUnknown(value: string | null | undefined): SendCheckRent {
  return value !== null && value !== undefined && /^\d+$/.test(value) ? { lamports: value, sol: sol(BigInt(value)) } : { lamports: null, sol: null };
}

export function buildSendCheck(input: SendCheckInput): SendCheck {
  const { plan, preflight } = input;
  const native = plan.actionKind === "NATIVE_SOL";
  const decimals = plan.decimals;

  const signingOpen = canSubmitSendAction({ network: plan.network, safety: input.safety });
  const readiness = assessSendReadiness({
    plan,
    preflight,
    verdict: input.verdict,
    support: input.support,
    reviewProof: input.reviewProof,
    requireReviewProof: signingOpen,
  });

  const seen = new Set<string>();
  const warnings: (SendCheckWords & { code: string; stops: boolean })[] = [];
  for (const finding of [...input.safety.findings, ...input.support.findings]) {
    if (finding.outcome === "PASS" || seen.has(finding.code)) continue;
    seen.add(finding.code);
    const en = sendWarningCopy(finding.code, english);
    if (en === null) continue;
    warnings.push({ code: finding.code, stops: finding.outcome !== "REVIEW", en, uk: sendWarningCopy(finding.code, ukrainian) ?? en });
  }
  if (!signingOpen && warnings.length === 0) {
    const line = "This transfer cannot be sent.";
    warnings.push({ code: SEND_NOT_SENDABLE, stops: true, en: english(line), uk: ukrainian(line) });
  }

  const feeRaw = preflight.transferFee.feeRaw;
  const opens = plan.createsRecipientAccount;

  return {
    asset: { mint: native ? null : plan.mint, decimals },
    from: plan.sender,
    to: {
      address: plan.recipient,
      kind: plan.recipientKind === "EXISTING_TOKEN_ACCOUNT" ? "token-account" : "wallet",
      owner: plan.recipientOwner,
      account: plan.recipientTokenAccount,
      opensAccount: plan.createsRecipientAccount,
    },
    send: { raw: plan.amountRaw, amount: exactDecimal(plan.amountRaw, decimals) },
    issuerFee: feeRaw !== "0" ? { raw: feeRaw, amount: exactDecimal(feeRaw, decimals), basisPoints: preflight.transferFee.basisPoints } : null,
    receive: {
      raw: preflight.estimatedReceivedRaw,
      amount: exactDecimal(preflight.estimatedReceivedRaw, decimals),
      less: preflight.estimatedReceivedRaw !== plan.amountRaw,
    },
    networkFee: (() => {
      const total = digits(plan.baseFeeLamports) + digits(plan.priorityFeeLamports);
      return { lamports: total.toString(), sol: sol(total) };
    })(),
    setup: opens && !native ? rentOrUnknown(plan.ataRentLamports) : null,
    minimum: opens && native ? rentOrUnknown(plan.ataRentLamports) : null,
    signable: signingOpen && readiness.ready,
    blocked:
      signingOpen && !readiness.ready
        ? { code: readiness.code, en: sendReadinessCopy(readiness.code, english), uk: sendReadinessCopy(readiness.code, ukrainian) }
        : null,
    warnings,
  };
}
