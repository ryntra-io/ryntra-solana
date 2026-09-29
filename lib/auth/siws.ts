import { getAddressEncoder, isAddress } from "@solana/kit";
import { verifyAsync } from "@noble/ed25519";

/**
 * Sign In With Solana — the server's half.
 *
 * The message follows the Sign In With Solana specification (Phantom / Solana
 * Foundation, the `solana:signIn` Wallet Standard feature), whose text format
 * is EIP-4361's with a Solana address:
 *
 *   <domain> wants you to sign in with your Solana account:
 *   <address>
 *
 *   <statement>
 *
 *   URI: <uri>
 *   Version: 1
 *   Chain ID: solana:mainnet
 *   Nonce: <nonce>
 *   Issued At: <iso>
 *   Expiration Time: <iso>
 *
 * The server builds it, the wallet shows and signs it, the server parses the
 * signed bytes back and checks every field against what it issued — domain,
 * URI, address, chain, nonce, issue and expiry times — before the Ed25519
 * signature is verified against the address itself. A wallet that supports
 * `solana:signIn` constructs the same text from the input fields; one that
 * only supports `solana:signMessage` signs the text verbatim. Either way the
 * bytes the server verifies are the bytes the person saw.
 *
 * Addresses are case-sensitive base58 and are never normalized: two spellings
 * are two keys. No transaction is involved anywhere in this file.
 */

export const SIWS_VERSION = "1";
export const SIWS_CHAIN = "solana:mainnet";
export const SIWS_STATEMENT = "Sign in to Ryntra. This proves you control this wallet and moves nothing.";
export const SIWS_TTL_MS = 5 * 60 * 1000;

export type SiwsAction = "prove" | "signin" | "link";
export function siwsStatement(action: SiwsAction = "prove", locale: "en" | "uk" = "en"): string {
  if (action === "prove") return SIWS_STATEMENT;
  if (action === "link") return locale === "uk"
    ? "Прив'яжіть цей гаманець до облікового запису Ryntra, у який виконано вхід. Це не переміщує кошти й не дозволяє торгувати від вашого імені."
    : "Link this wallet to your signed-in Ryntra account. This does not move funds or allow trading on your behalf.";
  return locale === "uk"
    ? "Підтвердьте вхід у Ryntra. Це повідомлення не переміщує кошти й не дозволяє торгувати від вашого імені."
    : "Confirm sign-in to Ryntra. This message does not move funds or allow trading on your behalf.";
}

export type SiwsInput = Readonly<{
  domain: string;
  address: string;
  statement: string;
  uri: string;
  version: string;
  chainId: string;
  nonce: string;
  issuedAt: string;
  expirationTime: string;
}>;

export type SiwsFields = Readonly<{
  domain: string;
  address: string;
  statement: string | null;
  uri: string | null;
  version: string | null;
  chainId: string | null;
  nonce: string | null;
  issuedAt: string | null;
  expirationTime: string | null;
  notBefore: string | null;
  requestId: string | null;
  resources: readonly string[] | null;
}>;

export function buildSiwsInput(input: Readonly<{ domain: string; uri: string; address: string; nonce: string; now: number; action?: SiwsAction; locale?: "en" | "uk" }>): SiwsInput {
  return {
    domain: input.domain,
    address: input.address,
    statement: siwsStatement(input.action, input.locale),
    uri: input.uri,
    version: SIWS_VERSION,
    chainId: SIWS_CHAIN,
    nonce: input.nonce,
    issuedAt: new Date(input.now).toISOString(),
    expirationTime: new Date(input.now + SIWS_TTL_MS).toISOString(),
  };
}

/** The exact text a wallet signs; identical to what `solana:signIn` builds from the input. */
export function siwsMessageText(input: SiwsInput): string {
  const lines = [
    `${input.domain} wants you to sign in with your Solana account:`,
    input.address,
    "",
    input.statement,
    "",
    `URI: ${input.uri}`,
    `Version: ${input.version}`,
    `Chain ID: ${input.chainId}`,
    `Nonce: ${input.nonce}`,
    `Issued At: ${input.issuedAt}`,
    `Expiration Time: ${input.expirationTime}`,
  ];
  return lines.join("\n");
}

/* The grammar of the wallet-standard reference parser, kept identical so a
   message a wallet built is read the way the wallet built it. */
const DOMAIN = "(?<domain>[^\\n]+?) wants you to sign in with your Solana account:\\n";
const ADDRESS = "(?<address>[^\\n]+)(?:\\n|$)";
const STATEMENT = "(?:\\n(?<statement>[\\S\\s]*?)(?:\\n|$))??";
const URI = "(?:\\nURI: (?<uri>[^\\n]+))?";
const VERSION = "(?:\\nVersion: (?<version>[^\\n]+))?";
const CHAIN_ID = "(?:\\nChain ID: (?<chainId>[^\\n]+))?";
const NONCE = "(?:\\nNonce: (?<nonce>[^\\n]+))?";
const ISSUED_AT = "(?:\\nIssued At: (?<issuedAt>[^\\n]+))?";
const EXPIRATION_TIME = "(?:\\nExpiration Time: (?<expirationTime>[^\\n]+))?";
const NOT_BEFORE = "(?:\\nNot Before: (?<notBefore>[^\\n]+))?";
const REQUEST_ID = "(?:\\nRequest ID: (?<requestId>[^\\n]+))?";
const RESOURCES = "(?:\\nResources:(?<resources>(?:\\n- [^\\n]+)*))?";
const MESSAGE = new RegExp(`^${DOMAIN}${ADDRESS}${STATEMENT}${URI}${VERSION}${CHAIN_ID}${NONCE}${ISSUED_AT}${EXPIRATION_TIME}${NOT_BEFORE}${REQUEST_ID}${RESOURCES}\\n*$`);

export function parseSiwsMessage(text: string): SiwsFields | null {
  if (text.length > 4_096) return null;
  const match = MESSAGE.exec(text);
  const g = match?.groups;
  if (!g || !g.domain || !g.address) return null;
  return {
    domain: g.domain,
    address: g.address,
    statement: g.statement ?? null,
    uri: g.uri ?? null,
    version: g.version ?? null,
    chainId: g.chainId ?? null,
    nonce: g.nonce ?? null,
    issuedAt: g.issuedAt ?? null,
    expirationTime: g.expirationTime ?? null,
    notBefore: g.notBefore ?? null,
    requestId: g.requestId ?? null,
    resources: g.resources ? g.resources.split("\n- ").slice(1) : null,
  };
}

export type SiwsVerification =
  | Readonly<{ ok: true; address: string }>
  | Readonly<{ ok: false; reason:
      | "unparseable" | "domain" | "uri" | "address" | "version" | "chain" | "nonce"
      | "statement" | "not_yet_valid" | "expired" | "issued_at" | "signature" | "extra_fields" }>;

function parseTime(value: string | null): number | null {
  if (!value) return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

/**
 * Verify a signed message against what this server issued.
 *
 * `signedMessage` is what the wallet actually signed (from `solana:signIn`
 * output, or the text itself for `solana:signMessage`); `signature` the
 * 64-byte Ed25519 signature; `expected` the input the server built for this
 * nonce. Every bound is checked before the curve is asked.
 */
export async function verifySiws(input: Readonly<{
  signedMessage: Uint8Array;
  signature: Uint8Array;
  expected: Readonly<{ domain: string; uri: string; nonce: string; address: string; action?: SiwsAction; locale?: "en" | "uk" }>;
  now: number;
}>): Promise<SiwsVerification> {
  const text = new TextDecoder().decode(input.signedMessage);
  const fields = parseSiwsMessage(text);
  if (!fields) return { ok: false, reason: "unparseable" };
  if (fields.domain !== input.expected.domain) return { ok: false, reason: "domain" };
  if (fields.uri !== input.expected.uri) return { ok: false, reason: "uri" };
  if (fields.address !== input.expected.address || !isAddress(fields.address)) return { ok: false, reason: "address" };
  if (fields.version !== SIWS_VERSION) return { ok: false, reason: "version" };
  if (fields.chainId !== SIWS_CHAIN) return { ok: false, reason: "chain" };
  if (fields.nonce !== input.expected.nonce) return { ok: false, reason: "nonce" };
  if (fields.statement !== siwsStatement(input.expected.action, input.expected.locale)) return { ok: false, reason: "statement" };
  if (fields.notBefore !== null || fields.requestId !== null || fields.resources !== null) return { ok: false, reason: "extra_fields" };
  const issuedAt = parseTime(fields.issuedAt);
  const expiresAt = parseTime(fields.expirationTime);
  if (issuedAt === null || issuedAt > input.now + 60_000) return { ok: false, reason: "issued_at" };
  if (expiresAt === null || expiresAt <= input.now) return { ok: false, reason: "expired" };
  if (expiresAt - issuedAt > SIWS_TTL_MS + 1_000) return { ok: false, reason: "expired" };
  if (input.signature.length !== 64) return { ok: false, reason: "signature" };
  const publicKey = new Uint8Array(getAddressEncoder().encode(fields.address as Parameters<ReturnType<typeof getAddressEncoder>["encode"]>[0]));
  let valid = false;
  try {
    valid = await verifyAsync(input.signature, input.signedMessage, publicKey);
  } catch {
    valid = false;
  }
  return valid ? { ok: true, address: fields.address } : { ok: false, reason: "signature" };
}
