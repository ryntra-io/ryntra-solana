/**
 * What a Solana address is, defined once.
 *
 * This rule existed twice in effect and nowhere by name: the transfer schema
 * carried the regex, and every surface that collects an address carried
 * nothing — so a value that could never be an address travelled to the network,
 * was read against the chain, and came back as a schema refusal that named no
 * field. The founder hit exactly that: a recipient beginning `wallet-` produced
 * "The transfer proposal or policy was not accepted."
 *
 * So the shape lives here, with no imports, and the schema consumes it. One
 * definition is the point — this repository has recorded, more than once, that
 * two lists which must agree eventually disagree in silence.
 *
 * Base58 omits `0`, `O`, `I` and `l` deliberately, because those are the four
 * characters people mistake for each other when copying a key by eye.
 */
export const BASE58_PUBKEY = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

export type ParsedAddress = Readonly<{ ok: true; address: string }> | Readonly<{ ok: false; reason: string }>;

/** The three mistakes of `parseSolanaAddress`, as codes a client says in its own words (contract 1.22.0). */
export const ADDRESS_PROBLEMS = ["EMPTY", "NOT_AN_ADDRESS", "MISREAD_CHARACTER", "WRONG_LENGTH"] as const;
export type AddressProblem = (typeof ADDRESS_PROBLEMS)[number];

/**
 * The same verdict as {@link parseSolanaAddress}, in the same order, as a code:
 * null for an address. Kept beside the sentences so the two cannot drift.
 */
export function addressProblem(value: string): AddressProblem | null {
  const trimmed = value.trim();
  if (trimmed === "") return "EMPTY";
  if (BASE58_PUBKEY.test(trimmed)) return null;
  if (/[^1-9A-HJ-NP-Za-km-z0OIl]/.test(trimmed)) return "NOT_AN_ADDRESS";
  if (/[0OIl]/.test(trimmed)) return "MISREAD_CHARACTER";
  return "WRONG_LENGTH";
}

/**
 * A typed string → an address, or a sentence saying why it is not one.
 *
 * The refusals separate the three mistakes people actually make, because
 * "invalid address" sends someone hunting the wrong thing: a wrong-length key
 * is usually a truncated paste, and a `0`/`O`/`I`/`l` is usually a key that was
 * read off a screen rather than copied.
 */
export function parseSolanaAddress(value: string, field = "Solana address"): ParsedAddress {
  const trimmed = value.trim();
  if (trimmed === "") {
    return {
      ok: false,
      reason: `Enter the ${field} — 32 to 44 base58 characters, copied from the wallet that owns it.`,
    };
  }
  if (BASE58_PUBKEY.test(trimmed)) {
    return { ok: true, address: trimmed };
  }
  /* Order is the useful part. A character base58 never uses at all means this
     was never an address; a 0/O/I/l means it probably is one, misread. Testing
     the confusables first would answer `wallet-opuATvsQx…` with "contains I,
     which base58 does not use", which reads as a near miss and sends the reader
     hunting one character in a string that is not an address in the first
     place. So the definite failure is reported before the likely typo. */
  const foreign = trimmed.match(/[^1-9A-HJ-NP-Za-km-z0OIl]/);
  if (foreign) {
    const shown = foreign[0] === " " ? "a space" : `"${foreign[0]}"`;
    return {
      ok: false,
      reason: `That is not a ${field} — it contains ${shown}, and base58 uses only digits and letters.`,
    };
  }
  const confusable = trimmed.match(/[0OIl]/);
  if (confusable) {
    return {
      ok: false,
      reason: `That ${field} contains "${confusable[0]}", which base58 leaves out — 0, O, I and l are excluded because they are the characters people misread. Copy the key rather than retyping it.`,
    };
  }
  return {
    ok: false,
    reason: `A ${field} is 32 to 44 base58 characters; that one is ${trimmed.length}. A short one is usually a truncated paste.`,
  };
}
