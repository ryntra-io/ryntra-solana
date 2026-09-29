/**
 * Shapes for the Solana Asset Passport — the evidence layer's vocabulary.
 *
 * Two axes are deliberately separate and must never merge:
 *
 * - the **evidence envelope** (lib/solana/evidence.ts) answers "how do we
 *   know, from where, and how fresh" — FRESH/STALE/UNKNOWN/…;
 * - **provenance** answers "what kind of claim is this" — read from the
 *   chain, declared by an issuer, derived by us, or not decodable at all.
 *
 * A single "trust score" collapsing both is the thing this product refuses
 * to ship. Every field carries its own label instead.
 */

export const SOLANA_PROVENANCE = [
  /** Read directly from on-chain account state this session observed. */
  "ONCHAIN_VERIFIED",
  /** Someone's statement about themselves (issuer metadata, off-chain JSON). */
  "DECLARED",
  /** Computed by Ryntra from onchain inputs; the inputs carry their own labels. */
  "DERIVED",
  /** Two sources answered and disagree; neither is silently preferred. */
  "CONFLICTING",
  /** No source could answer. Different from a source that failed. */
  "UNKNOWN",
  /** Present on chain but not decodable by this version; reported, not guessed. */
  "UNSUPPORTED",
] as const;

export type SolanaProvenance = (typeof SOLANA_PROVENANCE)[number];

/** A single passport fact: the value, its provenance, and a human line. */
export type PassportFact<T> = Readonly<{
  value: T;
  provenance: SolanaProvenance;
  /** One sentence a holder reads. Never marketing, never "safe". */
  meaning: string;
}>;

export const TOKEN_PROGRAM_KINDS = ["SPL_TOKEN", "TOKEN_2022", "NOT_A_MINT"] as const;
export type TokenProgramKind = (typeof TOKEN_PROGRAM_KINDS)[number];

/** Base58 program ids, pinned. These are consensus constants, not config. */
export const SPL_TOKEN_PROGRAM_ID = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
export const TOKEN_2022_PROGRAM_ID = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";

export type MintAuthorityFact = PassportFact<string | null>;

/** The identity block — who this asset structurally is. */
export type SolanaMintIdentity = Readonly<{
  mint: string;
  programKind: TokenProgramKind;
  programId: string;
  decimals: PassportFact<number>;
  supply: PassportFact<string>;
  /** `null` value = authority revoked/absent, which is itself a fact. */
  mintAuthority: MintAuthorityFact;
  freezeAuthority: MintAuthorityFact;
  isInitialized: PassportFact<boolean>;
}>;

/**
 * One decoded (or honestly not-decoded) Token-2022 extension.
 *
 * `kind` is the extension's name as the official generated client reports it;
 * an extension the client knows but this module has no semantics for still
 * renders — with `provenance: "ONCHAIN_VERIFIED"` and a generic meaning — and
 * an extension nobody can decode renders as `UNSUPPORTED` with its raw kind.
 */
export type SolanaExtensionFact = Readonly<{
  kind: string;
  provenance: SolanaProvenance;
  /** What this extension lets someone do, in holder language. */
  meaning: string;
  /** Decoded fields, JSON-safe, exactly as read. Empty when undecodable. */
  fields: Readonly<Record<string, string | number | boolean | null>>;
  /**
   * True when the extension can change the outcome of a transfer or the
   * holder's control of the balance — the reason this product exists. This is
   * a structural flag, not a risk score.
   */
  affectsTransfers: boolean;
}>;

/** The assembled passport. Every field is a labeled fact, not a verdict. */
export type SolanaAssetPassport = Readonly<{
  schema: "ryntra.solana.asset-passport";
  schemaVersion: "0.1.0";
  network: "mainnet" | "devnet";
  identity: SolanaMintIdentity;
  extensions: readonly SolanaExtensionFact[];
  /** Kinds present on chain that this version could not decode. */
  unsupportedKinds: readonly string[];
  /** ISO-8601 observation moment plus the endpoint that answered. */
  observedAt: string;
  source: Readonly<{ ref: string; label: string }>;
}>;
