/**
 * What each Token-2022 extension means for the person holding the asset.
 *
 * The registry below carries exactly two judgements per kind: one sentence a
 * holder can read, and whether the extension can change the outcome of a
 * transfer or the holder's control of the balance. Nothing here scores,
 * ranks or reassures — an extension nobody wrote semantics for still renders,
 * as its raw kind with a generic line, because a decoded fact without a
 * pretty sentence is still a fact, and hiding it would be the lie.
 */

import type { Extension } from "@solana-program/token-2022";
import type { SolanaExtensionFact } from "./types.ts";

type KindSemantics = Readonly<{
  meaning: string;
  affectsTransfers: boolean;
  /** True for kinds that live on token accounts, not on the mint itself. */
  accountScoped?: boolean;
}>;

/** Keyed by the generated client's `__kind` names — the on-chain vocabulary. */
const EXTENSION_SEMANTICS: Readonly<Record<string, KindSemantics>> = {
  TransferFeeConfig: {
    meaning:
      "Every transfer is taxed: the issuer takes a configured fee out of the amount, so the recipient receives less than was sent.",
    affectsTransfers: true,
  },
  PermanentDelegate: {
    meaning:
      "The issuer's delegate can move or burn tokens from any holder's account without the holder's approval — custody is shared with the issuer by construction.",
    affectsTransfers: true,
  },
  TransferHook: {
    meaning:
      "A separate program runs on every transfer and can add its own rules or refusals; what it does is that program's code, not this mint's data.",
    affectsTransfers: true,
  },
  DefaultAccountState: {
    meaning:
      "New token accounts can start frozen: receiving the token does not yet mean being able to move it until the issuer thaws the account.",
    affectsTransfers: true,
  },
  NonTransferable: {
    meaning: "Tokens cannot be transferred at all once received — this asset is bound to the account that holds it.",
    affectsTransfers: true,
  },
  PausableConfig: {
    meaning: "The issuer can pause the whole token: while paused, transfers stop for every holder at once.",
    affectsTransfers: true,
  },
  ConfidentialTransferMint: {
    meaning: "Confidential transfers are configured: amounts can move encrypted, under the issuer's auditor settings.",
    affectsTransfers: true,
  },
  ConfidentialMintBurn: {
    meaning: "The issuer can mint and burn confidentially — supply changes are not publicly readable per operation.",
    affectsTransfers: false,
  },
  ConfidentialTransferFee: {
    meaning: "Fees on confidential transfers are configured and collected under the issuer's fee authority.",
    affectsTransfers: true,
  },
  MintCloseAuthority: {
    meaning: "An authority may close this mint account entirely once its supply is zero.",
    affectsTransfers: false,
  },
  InterestBearingConfig: {
    meaning:
      "Displayed balances accrue interest by configuration; the on-chain raw amount and the shown amount differ by the accrual math.",
    affectsTransfers: false,
  },
  ScaledUiAmountConfig: {
    meaning:
      "Displayed balances are multiplied by an issuer-set factor that can change; the raw amount and the shown amount are different numbers.",
    affectsTransfers: false,
  },
  MetadataPointer: {
    meaning: "Points at the account that holds this token's metadata — identity comes from wherever this points.",
    affectsTransfers: false,
  },
  TokenMetadata: {
    meaning: "Name, symbol and URI are stored on the mint itself and controlled by the metadata update authority.",
    affectsTransfers: false,
  },
  GroupPointer: {
    meaning: "Points at a token-group definition this mint belongs to or defines.",
    affectsTransfers: false,
  },
  GroupMemberPointer: {
    meaning: "Points at this mint's membership record inside a token group.",
    affectsTransfers: false,
  },
  TokenGroup: { meaning: "This mint defines a token group.", affectsTransfers: false },
  TokenGroupMember: { meaning: "This mint is a member of a token group.", affectsTransfers: false },
  PermissionedBurn: {
    meaning: "A configured authority can burn tokens under permissioned rules.",
    affectsTransfers: true,
  },
  /* Account-scoped kinds. They belong to token accounts; a mint carrying one
     would itself be an anomaly worth showing rather than hiding. */
  TransferFeeAmount: { meaning: "Withheld transfer fees ledger.", affectsTransfers: false, accountScoped: true },
  TransferHookAccount: { meaning: "Transfer-hook per-account state.", affectsTransfers: false, accountScoped: true },
  ConfidentialTransferAccount: { meaning: "Confidential-transfer per-account state.", affectsTransfers: false, accountScoped: true },
  ConfidentialTransferFeeAmount: { meaning: "Confidential fee per-account ledger.", affectsTransfers: false, accountScoped: true },
  MemoTransfer: { meaning: "Incoming transfers to this account must carry a memo.", affectsTransfers: true, accountScoped: true },
  CpiGuard: { meaning: "Blocks certain cross-program actions on this account.", affectsTransfers: true, accountScoped: true },
  ImmutableOwner: { meaning: "The account's owner can never be changed.", affectsTransfers: false, accountScoped: true },
  NonTransferableAccount: { meaning: "Per-account marker of a non-transferable token.", affectsTransfers: true, accountScoped: true },
  PausableAccount: { meaning: "Per-account marker of a pausable token.", affectsTransfers: true, accountScoped: true },
  Uninitialized: { meaning: "An uninitialized extension slot.", affectsTransfers: false },
};

/** Kinds this module has real sentences for — exported so tests can diff the
 * client's vocabulary against ours and fail when the library learns a new
 * extension we have not looked at. */
export const KNOWN_EXTENSION_KINDS = Object.freeze(Object.keys(EXTENSION_SEMANTICS));

type JsonPrimitive = string | number | boolean | null;

function toJsonSafe(value: unknown): JsonPrimitive {
  if (value === null || value === undefined) return null;
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return value;
  if (value instanceof Uint8Array) return Buffer.from(value).toString("base64");
  return JSON.stringify(value, (_key, nested) => (typeof nested === "bigint" ? nested.toString() : nested));
}

function isOption(value: unknown): value is { __option: "Some"; value: unknown } | { __option: "None" } {
  return typeof value === "object" && value !== null && "__option" in value;
}

/**
 * Flatten one decoded extension's fields into JSON-safe primitives.
 *
 * Generic on purpose: field shapes come from the generated client, and a
 * hand-written per-kind mapping would silently drop whatever a future client
 * version adds. Nested structs flatten with dot keys; options unwrap to the
 * value or null; bigints become strings; byte arrays become base64.
 */
export function flattenExtensionFields(extension: Extension): Record<string, JsonPrimitive> {
  const out: Record<string, JsonPrimitive> = {};
  const walk = (prefix: string, value: unknown): void => {
    if (isOption(value)) {
      walk(prefix, value.__option === "Some" ? value.value : null);
      return;
    }
    if (
      typeof value === "object" &&
      value !== null &&
      !(value instanceof Uint8Array) &&
      !Array.isArray(value)
    ) {
      for (const [key, nested] of Object.entries(value)) {
        if (key === "__kind") continue;
        walk(prefix === "" ? key : `${prefix}.${key}`, nested);
      }
      return;
    }
    out[prefix] = toJsonSafe(value);
  };
  walk("", extension);
  return out;
}

/** The token program's own "no program here": the all-zero key. */
const ZERO_ADDRESS = "11111111111111111111111111111111";

/**
 * Two extensions describe a *capacity* whose current setting can be off, and
 * the generic sentence is false when it is.
 *
 * PYUSD is the case that found this: it carries `TransferHook` with the
 * all-zero program id and `TransferFeeConfig` at zero basis points, so the
 * shipped sentences told a holder that a program runs on every transfer and
 * that the recipient receives less than was sent — while the preflight, reading
 * the same bytes, correctly resolved no hook and a zero fee. Two readings of
 * one account, disagreeing.
 *
 * The configured-off sentence still says who can turn it back on, because
 * "not right now" and "cannot happen" are different facts and only one of them
 * is true here. `affectsTransfers` stays `true` for the same reason: the slot
 * and its authority exist.
 */
function refineMeaning(extension: Extension, base: string): string {
  if (extension.__kind === "TransferHook") {
    const programId = String((extension as { programId?: unknown }).programId ?? "");
    if (programId === "" || programId === ZERO_ADDRESS) {
      return "No transfer-hook program is set, so nothing extra runs on a transfer today; the hook authority can install one, and it would then run on every transfer.";
    }
    return base;
  }
  if (extension.__kind === "TransferFeeConfig") {
    const fee = extension as unknown as {
      olderTransferFee?: { transferFeeBasisPoints?: number; maximumFee?: bigint };
      newerTransferFee?: { transferFeeBasisPoints?: number; maximumFee?: bigint };
    };
    const configured = [fee.olderTransferFee, fee.newerTransferFee].some(
      (entry) => Number(entry?.transferFeeBasisPoints ?? 0) > 0 && BigInt(entry?.maximumFee ?? 0n) > 0n,
    );
    if (!configured) {
      return "A transfer fee is configured at zero, so the recipient currently receives the full amount; the fee authority can raise it, and the new rate applies from the epoch it names.";
    }
    return base;
  }
  return base;
}

/** Turn one decoded extension into a passport fact. Total — never throws. */
export function describeExtension(extension: Extension): SolanaExtensionFact {
  const kind = extension.__kind;
  const semantics = EXTENSION_SEMANTICS[kind];
  if (!semantics) {
    return {
      kind,
      provenance: "ONCHAIN_VERIFIED",
      meaning: `Extension "${kind}" is present on chain; this version has no written semantics for it yet.`,
      fields: flattenExtensionFields(extension),
      affectsTransfers: true,
    };
  }
  const meaning = refineMeaning(extension, semantics.meaning);
  return {
    kind,
    provenance: "ONCHAIN_VERIFIED",
    meaning: semantics.accountScoped
      ? `${meaning} (Account-scoped: normally lives on token accounts, observed here on the mint.)`
      : meaning,
    fields: flattenExtensionFields(extension),
    affectsTransfers: semantics.affectsTransfers,
  };
}
