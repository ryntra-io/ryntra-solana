import type { SplTransferPreflight } from "./contracts.ts";
import { SOLANA_LANE_STATE_ENV, resolveSolanaLaneState } from "./lane-state.ts";
import type { SolanaNetwork } from "./rpc.ts";
/* Values from `send-kinds.ts` only, and everything else as a type.
 *
 * This module is imported by the Send console, which runs in the browser. Any
 * value pulled from the canary policy, the transaction builder or the
 * wallet-modification checker drags their dependencies along with it, and one
 * of those reaches `node:crypto` — which webpack cannot resolve for a client
 * bundle, so the page returns 500 with nothing failing in any test. */
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  COMPUTE_BUDGET_PROGRAM_ID,
  LIGHTHOUSE_PROGRAM_ID,
  MEMO_PROGRAM_ID,
  SYSTEM_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
} from "./send-kinds.ts";
import type { SendSupportVerdict } from "./send-support.ts";

/**
 * The gate between a reviewed transaction and a wallet prompt, owned by the
 * server.
 *
 * What stood here before were two gates, neither of which was about the
 * transfer in front of it: an action-kind allowlist admitting exactly
 * `TOKEN_ATA_CREATE` on mainnet, and the `RYN-SOL-M1B` owner-canary envelope
 * allowlisting one recipient, one amount and one program set. Both were
 * correct for the single canary they were written for, and together they
 * refuse every ordinary transfer — which is precisely what the production Send
 * screen showed.
 *
 * This does not widen an allowlist. It decides from what this exact transfer
 * was proven to be: a supported capability, a green simulation of the exact
 * bytes, a priced fee, a visible rent cost, programs whose semantics are
 * written down, an issuer-signed Review, and an operator stop that is open.
 *
 * The client cannot weaken any of it. Nothing here reads a value the browser
 * posted; every input is something the server itself established.
 */

export const SEND_SAFETY_DECISIONS = ["ALLOW", "REVIEW", "BLOCK", "PAUSE", "UNKNOWN"] as const;
export type SendSafetyDecision = (typeof SEND_SAFETY_DECISIONS)[number];

export type SendSafetyFinding = Readonly<{
  code: string;
  outcome: "PASS" | "REVIEW" | "BLOCK" | "PAUSE" | "UNKNOWN";
  detail: string;
}>;

export type SendSafetyVerdict = Readonly<{
  decision: SendSafetyDecision;
  findings: readonly SendSafetyFinding[];
}>;

export const SEND_STATE_ENV = SOLANA_LANE_STATE_ENV.SEND;

/**
 * The deployment's emergency stop for Send.
 *
 * Missing, blank, misspelled or any other value reads as `PAUSED`. A stop that
 * opens when its own configuration is wrong is not a stop, and this one is the
 * single switch that halts every value-moving Send without a deploy.
 *
 * The rule now lives in `lane-state.ts`, because Swap and Bridge need the same
 * one: each used to be closed by something that was never a product control —
 * an admin session, an owner-canary policy — and opening them to ordinary
 * wallets without giving them a stop of their own would have left two
 * value-moving lanes closeable only by a deploy. Send's own name and meaning
 * are unchanged.
 */
export function resolveSendState(
  env: Record<string, string | undefined> = process.env,
): "OPEN" | "PAUSED" {
  return resolveSolanaLaneState("SEND", env);
}

/**
 * Programs whose semantics this product has written down and can reconcile.
 *
 * A message invoking anything else is refused — not because the program is
 * suspect, but because nothing here can say what it did, and a receipt that
 * cannot explain its own transaction is worse than no receipt.
 */
const SUPPORTED_PROGRAMS: readonly string[] = [
  SYSTEM_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  MEMO_PROGRAM_ID,
  COMPUTE_BUDGET_PROGRAM_ID,
  LIGHTHOUSE_PROGRAM_ID,
];

/**
 * The owner policy the server evaluates, replacing the one the browser used to
 * post alongside its request.
 *
 * A policy a client supplies is not a policy: the same request that asks for a
 * transfer would carry the rules the transfer is judged by. This one is built
 * here, from a constant, and the request has no field to override it.
 *
 * It deliberately no longer decides transfer *structure*. A permanent
 * delegate, a default-frozen mint and a transfer hook used to be refusals in
 * this object, expressed as booleans with no explanation attached. They are
 * now findings on the capability verdict, which names the authority, says what
 * it can do and shows it above the wallet button — the same facts, decided
 * once, in the place that can explain them.
 */
export function serverSendPolicy(network: SolanaNetwork) {
  return {
    schema: "ryntra.solana.owner-policy",
    schemaVersion: "0.1.0",
    allowedNetworks: [network],
    allowedMints: "ANY",
    allowedTokenPrograms: ["SPL_TOKEN", "TOKEN_2022"],
    acceptPermanentDelegate: true,
    transferHookAllowlist: "NONE_ALLOWED",
    maxFeeBasisPoints: null,
    maxFeeRaw: null,
    recipientAllowlist: "ANY",
    maxAmountRaw: null,
    maxEvidenceAgeSeconds: 300,
    acceptDefaultFrozenAccounts: true,
    requireHumanApproval: false,
  } as const;
}

export type SendSafetyInput = Readonly<{
  network: SolanaNetwork;
  state: "OPEN" | "PAUSED";
  support: Pick<SendSupportVerdict, "decision">;
  simulation: SplTransferPreflight["simulation"];
  baseFeeLamports: string | null;
  ataRentLamports: string | null;
  createsRecipientAccount: boolean;
  programs: readonly string[];
  reviewProof: Readonly<{ status: "SIGNED" | "UNSIGNED" }>;
  requireReviewProof: boolean;
  /**
   * Whether this deployment can record that these exact bytes crossed the
   * submit boundary. Only a durable multi-writer store can, and without it the
   * "submitted once" guarantee does not exist.
   */
  settlementStore: "DURABLE_MULTI_WRITER" | "NOT_DURABLE";
  /**
   * Whether a second, distinct RPC operator is configured to read the outcome
   * back. The receipt's independence is the whole point of the read-back, and
   * one operator cannot check itself.
   */
  independentReadback: boolean;
}>;

function finding(
  code: string,
  outcome: SendSafetyFinding["outcome"],
  detail: string,
): SendSafetyFinding {
  return { code, outcome, detail };
}

/** `PAUSE > BLOCK > UNKNOWN > REVIEW > ALLOW`. The stop outranks everything. */
function decide(findings: readonly SendSafetyFinding[]): SendSafetyDecision {
  if (findings.some((entry) => entry.outcome === "PAUSE")) return "PAUSE";
  if (findings.some((entry) => entry.outcome === "BLOCK")) return "BLOCK";
  if (findings.some((entry) => entry.outcome === "UNKNOWN")) return "UNKNOWN";
  if (findings.some((entry) => entry.outcome === "REVIEW")) return "REVIEW";
  return "ALLOW";
}

export function evaluateSendSafety(input: SendSafetyInput): SendSafetyVerdict {
  const findings: SendSafetyFinding[] = [];

  findings.push(
    input.state === "OPEN"
      ? finding("EMERGENCY_STOP", "PASS", "The deployment's Send stop is open.")
      : finding(
          "EMERGENCY_STOP",
          "PAUSE",
          "Sending is paused for this deployment. No transaction can be signed until the operator reopens it.",
        ),
  );

  findings.push(
    finding("NETWORK", "PASS", `This transfer is pinned to Solana ${input.network} and no cluster is substituted for it.`),
  );

  switch (input.support.decision) {
    case "SUPPORTED":
      findings.push(finding("CAPABILITY", "PASS", "Every fact this transfer depends on is understood and reconcilable."));
      break;
    case "REVIEW_REQUIRED":
      findings.push(
        finding(
          "CAPABILITY",
          "REVIEW",
          "This transfer carries named risks a person must weigh. They are shown before the wallet opens, and the wallet confirmation is the authorization.",
        ),
      );
      break;
    case "BLOCKED":
      findings.push(finding("CAPABILITY", "BLOCK", "This transfer cannot succeed as built, so no wallet prompt is opened."));
      break;
    case "UNKNOWN":
      findings.push(
        finding(
          "CAPABILITY",
          "UNKNOWN",
          "Something about this asset has no written semantics here, so what the transfer would do is not established.",
        ),
      );
      break;
  }

  if (input.simulation.status !== "PRESENT") {
    findings.push(
      finding("SIMULATION", "UNKNOWN", `The exact message was not simulated: ${input.simulation.reason}`),
    );
  } else if (!input.simulation.succeeded) {
    findings.push(
      finding(
        "SIMULATION",
        "BLOCK",
        `The exact message failed simulation${input.simulation.error ? `: ${input.simulation.error}` : "."}`,
      ),
    );
  } else {
    findings.push(finding("SIMULATION", "PASS", "The exact bytes simulated successfully against current chain state."));
  }

  findings.push(
    input.baseFeeLamports === null
      ? finding("FEE_PRICED", "UNKNOWN", "The cluster did not price these exact message bytes, so the network fee is not known.")
      : finding("FEE_PRICED", "PASS", `The network fee is priced at ${input.baseFeeLamports} lamports for these exact bytes.`),
  );

  if (input.createsRecipientAccount) {
    findings.push(
      input.ataRentLamports === null
        ? finding(
            "RENT_VISIBLE",
            "UNKNOWN",
            "This transfer creates the recipient's account and the rent it costs did not read, so the sender cannot see what they are paying.",
          )
        : finding(
            "RENT_VISIBLE",
            "PASS",
            `Creating the recipient's account costs ${input.ataRentLamports} lamports of rent, paid by the sender and shown before signing.`,
          ),
    );
  }

  const unsupported = input.programs.filter((program) => !SUPPORTED_PROGRAMS.includes(program));
  findings.push(
    unsupported.length === 0
      ? finding("PROGRAMS_SUPPORTED", "PASS", "Every program this message invokes has written semantics here.")
      : finding(
          "PROGRAMS_SUPPORTED",
          "BLOCK",
          `This message invokes ${unsupported.join(", ")}, which this product cannot explain or reconcile.`,
        ),
  );

  /* Both of these used to be discovered by the submit route, after the wallet
     had already been opened and a person had already approved a transaction.
     A deployment that cannot record the submit boundary, or cannot read the
     outcome back from a second operator, cannot complete this action — and the
     honest place to say so is before the signature, not after it. */
  findings.push(
    input.settlementStore === "DURABLE_MULTI_WRITER"
      ? finding("SETTLEMENT_STORE", "PASS", "This deployment can record that these exact bytes were submitted once.")
      : finding(
          "SETTLEMENT_STORE",
          "UNKNOWN",
          "This deployment cannot durably record a submission, so one transfer could not be proven to have been submitted only once.",
        ),
  );

  findings.push(
    input.independentReadback
      ? finding("INDEPENDENT_READBACK", "PASS", "A second Solana operator is configured to read this transfer's outcome back.")
      : finding(
          "INDEPENDENT_READBACK",
          "UNKNOWN",
          "Only one Solana operator is configured, so the outcome could not be confirmed by anyone but the endpoint that submitted it.",
        ),
  );

  if (input.requireReviewProof) {
    findings.push(
      input.reviewProof.status === "SIGNED"
        ? finding("REVIEW_PROOF", "PASS", "The exact Review bundle is bound to this deployment's signing key.")
        : finding(
            "REVIEW_PROOF",
            "BLOCK",
            "This deployment requires an issuer-signed Review and could not produce one, so the reviewed bytes cannot be proven to be the signed bytes.",
          ),
    );
  }

  return { decision: decide(findings), findings: Object.freeze(findings) };
}

/**
 * Whether a signed transaction may be submitted.
 *
 * `REVIEW` reaches the wallet on purpose: a named risk is one a person can
 * weigh, and their wallet confirmation over the exact inspected bytes is the
 * authorization. `BLOCK`, `UNKNOWN` and `PAUSE` never do.
 */
export function canSubmitSendAction(args: {
  network: SolanaNetwork;
  safety: Pick<SendSafetyVerdict, "decision">;
}): boolean {
  return args.safety.decision === "ALLOW" || args.safety.decision === "REVIEW";
}
