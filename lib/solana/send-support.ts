import type { SplTransferPreflight } from "./contracts.ts";
import type { SendAccountState } from "./send-inventory.ts";
import { TOKEN_2022_PROGRAM_ID, type SendActionKind } from "./send-kinds.ts";
import type { SolanaAssetPassport } from "./types.ts";

/**
 * Whether this exact transfer is one the product can build, explain and
 * reconcile.
 *
 * "Any token" is a promise about selection, not about execution. A person may
 * choose anything their wallet holds; whether it can actually move is a
 * separate question decided here, from fresh mint and account facts, with four
 * honest answers rather than a boolean.
 *
 * The answer this module exists for is `UNKNOWN`. An extension with no written
 * semantics in this repository is not a passing extension — the absence of a
 * rule is not a rule — and treating it as one is how a wallet ends up signing a
 * transaction whose effects nobody here can predict or reconcile.
 *
 * Pure and total: no network, no clock, no throw. The server, the UI and the
 * receipt all read the same verdict, so the sentence a person is shown is the
 * sentence the gate acted on.
 */

export const SEND_SUPPORT_DECISIONS = [
  "SUPPORTED",
  "REVIEW_REQUIRED",
  "BLOCKED",
  "UNKNOWN",
] as const;
export type SendSupportDecision = (typeof SEND_SUPPORT_DECISIONS)[number];

export type SendSupportOutcome = "PASS" | "REVIEW" | "BLOCK" | "UNKNOWN";

export type SendSupportFinding = Readonly<{
  code: string;
  outcome: SendSupportOutcome;
  detail: string;
}>;

export type SendSupportVerdict = Readonly<{
  decision: SendSupportDecision;
  findings: readonly SendSupportFinding[];
}>;

export type SendSupportInput = Readonly<{
  actionKind: SendActionKind;
  tokenProgram: "SPL_TOKEN" | "TOKEN_2022" | "SYSTEM";
  /** Extension kinds this product has no written semantics for. */
  unsupportedKinds: readonly string[];
  freezeAuthority: string | null;
  permanentDelegate: string | null;
  /** State of every account the transfer will draw from. */
  sourceStates: readonly SendAccountState[];
  destination: Readonly<{ createsAccount: boolean; state: SendAccountState | null }>;
  transferHook: Readonly<{ programId: string | null; extraAccountsResolved: boolean }> | null;
  transferFeeBasisPoints: number | null;
  paused: boolean;
  nonTransferable: boolean;
  defaultAccountStateFrozen: boolean;
  confidentialTransfer: Readonly<{ configured: boolean; proofRequired: boolean }> | null;
  /** `true` requires a memo, `"UNREADABLE"` means the requirement would not read. */
  memoTransferRequired: boolean | "UNREADABLE";
  /** Extensions that are recorded as evidence and change nothing about transfer. */
  informationalExtensions: readonly string[];
}>;

function finding(code: string, outcome: SendSupportOutcome, detail: string): SendSupportFinding {
  return { code, outcome, detail };
}

function fieldText(
  passport: SolanaAssetPassport,
  kind: string,
  field: string,
): string | null {
  const extension = passport.extensions.find((entry) => entry.kind === kind);
  if (!extension) return null;
  const value = extension.fields[field];
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

/**
 * Turn what has already been read into the classifier's input.
 *
 * Nothing is decoded twice: the preflight owns the structural blockers, the
 * fee configuration and the hook program, the passport owns the authorities
 * and the extension list, and the caller supplies the account states it just
 * read. Native SOL passes no passport and no preflight, which is the honest
 * shape — it has no mint, so it has no mint facts.
 */
export function sendSupportInputFromFacts(args: {
  actionKind: SendActionKind;
  passport: SolanaAssetPassport | null;
  preflight: SplTransferPreflight | null;
  sourceStates: readonly SendAccountState[];
  destination: Readonly<{ createsAccount: boolean; state: SendAccountState | null }>;
  transferHookExtraAccountsResolved: boolean;
  memoTransferRequired: boolean | "UNREADABLE";
  /**
   * Structural mint facts for callers that hold the decoded extensions but no
   * preflight — the transaction builder, which decodes them to emit the right
   * instruction and would otherwise have to build a preview it does not need.
   */
  structural?: Readonly<{
    nonTransferable: boolean;
    paused: boolean;
    defaultAccountStateFrozen: boolean;
    hookProgramId: string | null;
    transferFeeBasisPoints: number | null;
  }>;
}): SendSupportInput {
  const { passport, preflight, structural } = args;
  const blockers = preflight?.structuralBlockers ?? [];
  const hookProgramId = structural?.hookProgramId ?? preflight?.hookProgramId ?? null;
  const confidential = passport?.extensions.some(
    (entry) => entry.kind === "ConfidentialTransferMint",
  );

  return {
    actionKind: args.actionKind,
    tokenProgram:
      passport === null
        ? "SYSTEM"
        : passport.identity.programId === TOKEN_2022_PROGRAM_ID
          ? "TOKEN_2022"
          : "SPL_TOKEN",
    unsupportedKinds: passport?.unsupportedKinds ?? [],
    freezeAuthority: passport?.identity.freezeAuthority.value ?? null,
    permanentDelegate: passport === null ? null : fieldText(passport, "PermanentDelegate", "delegate"),
    sourceStates: args.sourceStates,
    destination: args.destination,
    transferHook:
      hookProgramId === null
        ? null
        : { programId: hookProgramId, extraAccountsResolved: args.transferHookExtraAccountsResolved },
    transferFeeBasisPoints: structural?.transferFeeBasisPoints ?? preflight?.transferFee.basisPoints ?? null,
    paused: structural?.paused ?? blockers.includes("PAUSED"),
    nonTransferable: structural?.nonTransferable ?? blockers.includes("NON_TRANSFERABLE"),
    defaultAccountStateFrozen:
      structural?.defaultAccountStateFrozen ?? blockers.includes("DEFAULT_ACCOUNT_STATE_FROZEN"),
    /* Configured is a fact; whether a proof is required for *this* transfer is
       decided by the account's own confidential state, which this packet does
       not read. Treating "configured" as "proof required" would block every
       ordinary transparent transfer of such a mint, so the proof question is
       answered only where it is actually read. */
    confidentialTransfer: confidential ? { configured: true, proofRequired: false } : null,
    memoTransferRequired: args.memoTransferRequired,
    informationalExtensions:
      passport?.extensions.filter((entry) => !entry.affectsTransfers).map((entry) => entry.kind) ?? [],
  };
}

/**
 * `BLOCK > UNKNOWN > REVIEW > PASS`.
 *
 * Unknown outranks review on purpose. A reviewed risk is one a person can weigh
 * because it is named; an unknown one cannot be weighed at all, so it must not
 * be reachable by adding a warning next to it.
 */
function decide(findings: readonly SendSupportFinding[]): SendSupportDecision {
  if (findings.some((entry) => entry.outcome === "BLOCK")) return "BLOCKED";
  if (findings.some((entry) => entry.outcome === "UNKNOWN")) return "UNKNOWN";
  if (findings.some((entry) => entry.outcome === "REVIEW")) return "REVIEW_REQUIRED";
  return "SUPPORTED";
}

export function classifySendSupport(input: SendSupportInput): SendSupportVerdict {
  const findings: SendSupportFinding[] = [];

  findings.push(
    finding(
      "ACTION_KIND",
      "PASS",
      `This is a ${input.actionKind} action under ${input.tokenProgram}, and the lifecycle builds, simulates and reconciles that shape.`,
    ),
  );

  if (input.nonTransferable) {
    findings.push(
      finding(
        "NON_TRANSFERABLE",
        "BLOCK",
        "This mint is non-transferable by construction. No transfer of it can succeed, so no wallet prompt is opened.",
      ),
    );
  }

  if (input.paused) {
    findings.push(
      finding(
        "PAUSED",
        "BLOCK",
        "The issuer has paused this mint. Transfers fail while it stays paused; the capability returns when it is unpaused.",
      ),
    );
  }

  const frozenSources = input.sourceStates.filter((state) => state === "FROZEN").length;
  if (frozenSources > 0) {
    findings.push(
      finding(
        "SOURCE_FROZEN",
        "BLOCK",
        `${frozenSources} of the accounts this transfer would draw from ${frozenSources === 1 ? "is" : "are"} frozen and cannot be spent.`,
      ),
    );
  }
  const unknownSources = input.sourceStates.filter((state) => state === "UNKNOWN").length;
  if (unknownSources > 0) {
    findings.push(
      finding(
        "SOURCE_STATE_UNREADABLE",
        "UNKNOWN",
        "At least one source account's state would not read, so whether it can be spent is not established.",
      ),
    );
  }

  if (input.destination.state === "FROZEN") {
    findings.push(
      finding(
        "DESTINATION_FROZEN",
        "BLOCK",
        "The destination token account is frozen, so it cannot receive this transfer.",
      ),
    );
  }

  if (input.defaultAccountStateFrozen) {
    if (input.destination.createsAccount) {
      findings.push(
        finding(
          "DEFAULT_ACCOUNT_STATE_FROZEN",
          "BLOCK",
          "This mint freezes new accounts by default, so the account this transfer would create could not receive it. The recipient needs an account the issuer has already thawed.",
        ),
      );
    } else {
      findings.push(
        finding(
          "DEFAULT_ACCOUNT_STATE_FROZEN",
          "REVIEW",
          "This mint freezes new accounts by default. The destination already exists and is thawed, so this transfer can proceed — a future one to a new account could not.",
        ),
      );
    }
  }

  if (input.confidentialTransfer?.configured) {
    findings.push(
      input.confidentialTransfer.proofRequired
        ? finding(
            "CONFIDENTIAL_TRANSFER_PROOF_REQUIRED",
            "BLOCK",
            "This mint's confidential-transfer state requires proof material this packet does not produce. A transparent transfer is not assumed in its place.",
          )
        : finding(
            "CONFIDENTIAL_TRANSFER_CONFIGURED",
            "REVIEW",
            "This mint supports confidential transfers. This transaction is a transparent transfer and its amounts are public on chain.",
          ),
    );
  }

  if (input.transferHook && input.transferHook.programId !== null) {
    findings.push(
      input.transferHook.extraAccountsResolved
        ? finding(
            "TRANSFER_HOOK",
            "REVIEW",
            `Every transfer of this mint calls hook program ${input.transferHook.programId}, whose extra accounts were resolved for this exact amount and pinned into the reviewed transaction.`,
          )
        : finding(
            "HOOK_ACCOUNTS_UNAVAILABLE",
            "BLOCK",
            `Hook program ${input.transferHook.programId} runs on every transfer of this mint, and its required extra accounts did not resolve. Signing without them would sign a transaction whose effects are not known here.`,
          ),
    );
  }

  if (input.permanentDelegate !== null) {
    findings.push(
      finding(
        "PERMANENT_DELEGATE",
        "REVIEW",
        `${input.permanentDelegate} is a permanent delegate on this mint and can move or burn any holder's balance at any time, including after this transfer lands.`,
      ),
    );
  }

  if (input.freezeAuthority !== null) {
    findings.push(
      finding(
        "FREEZE_AUTHORITY",
        "REVIEW",
        `${input.freezeAuthority} can freeze any account holding this asset, including the recipient's, after this transfer settles.`,
      ),
    );
  }

  if (input.transferFeeBasisPoints !== null && input.transferFeeBasisPoints > 0) {
    findings.push(
      finding(
        "TRANSFER_FEE",
        "PASS",
        `This mint withholds ${input.transferFeeBasisPoints} basis points on transfer. The exact fee is computed per instruction and the recipient's actual credit is stated before signing.`,
      ),
    );
  }

  if (input.memoTransferRequired === "UNREADABLE") {
    findings.push(
      finding(
        "MEMO_REQUIREMENT_UNREADABLE",
        "BLOCK",
        "The destination's memo requirement would not read, so whether this transfer needs an accompanying memo is not established.",
      ),
    );
  } else if (input.memoTransferRequired) {
    findings.push(
      finding(
        "MEMO_TRANSFER_REQUIRED",
        "REVIEW",
        "The destination account only accepts transfers accompanied by a memo. One is added immediately before the transfer and is shown in Review.",
      ),
    );
  }

  for (const kind of input.unsupportedKinds) {
    findings.push(
      finding(
        "UNKNOWN_EXTENSION",
        "UNKNOWN",
        `This mint carries the ${kind} extension, which has no written transfer semantics in this product. Its effect on this transfer is not established, so no wallet prompt is opened.`,
      ),
    );
  }

  if (input.informationalExtensions.length > 0) {
    findings.push(
      finding(
        "INFORMATIONAL_EXTENSIONS",
        "PASS",
        `Recorded as account evidence without changing this transfer: ${[...input.informationalExtensions].join(", ")}.`,
      ),
    );
  }

  return { decision: decide(findings), findings: Object.freeze(findings) };
}
