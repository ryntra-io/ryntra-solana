/**
 * x402 V2 on Solana — the wire, as facts and as checks.
 *
 * This module is the only place in the hub that knows what the protocol looks
 * like on the network. It holds three things and nothing else: the published
 * facts (header names, scheme names, chain ids, client packages, the two
 * facilitators), the builder for the requirements a seller answers `402` with,
 * and the verifier that reads a presented authorization back against those
 * requirements.
 *
 * ## What it deliberately cannot do
 *
 * There is no signer, no key, no facilitator credential and no network call
 * here or in anything it imports. A `PAYMENT-REQUIRED` body is a quote; a
 * verified `PAYMENT-SIGNATURE` is a *locally admissible* authorization and not
 * a settlement. Settlement is the facilitator's `/verify` and `/settle`, behind
 * the port in `./facilitator.ts`, and Ryntra holds no credential for either —
 * that is the owner's key, after this merges.
 *
 * ## The order of the checks is the security property
 *
 * `verifyPaymentAuthorization` refuses in a fixed order: version, then scheme,
 * then network, then asset, then recipient, then amount, then resource, then
 * freshness. Each earlier question makes a later one meaningless. A payload for
 * another chain is not an amount problem, and reporting it as one is how a
 * wrong-network payload gets "fixed" by adjusting the amount. The same reason
 * the route engine puts provider capability before owner permission.
 *
 * ## No V1
 *
 * V1 spelled the payload header `X-PAYMENT`. It is listed here only so a
 * request carrying it is refused by name rather than ignored into a 402 loop:
 * a V1 client that keeps re-sending a header nobody reads is a client that
 * never learns why.
 */

import { createHash } from "node:crypto";

import { canonicalJson } from "../../guard/canonical-json.ts";
import { SOLANA_CAIP2 } from "../../solana/chain-ids.ts";

/** Base-58, 32 bytes' worth of characters. Mints and addresses, never names. */
const BASE58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
/** Base units, as whole digits. An amount with a dot is a display string. */
const BASE_UNITS = /^(?:0|[1-9]\d*)$/;
const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;

export const X402_VERSION = 2 as const;

/**
 * The three V2 headers, spelled as the specification spells them.
 *
 * Header names are case-insensitive on the wire; these constants are the
 * canonical spelling this product writes and the one its tests read, so a
 * rename is a failing test rather than a silent 402 nobody can satisfy.
 */
export const X402_HEADERS = Object.freeze({
  /** Seller → buyer, on the `402`: what paying would have to look like. */
  requirements: "PAYMENT-REQUIRED",
  /** Buyer → seller: the signed authorization. */
  authorization: "PAYMENT-SIGNATURE",
  /** Seller → buyer, beside the resource: what the facilitator reported. */
  response: "PAYMENT-RESPONSE",
});

/** V1's payload header. Present so it can be refused by name, never read. */
export const X402_V1_AUTHORIZATION_HEADER = "X-PAYMENT";

/**
 * The two schemes. `exact` is the one Ryntra sells under.
 *
 * `upto` exists on the wire and the CDP facilitator supports it, but a seller
 * that offers it is offering a range, and a range without a declared upper cap
 * is an open authorization. The hub therefore treats `upto` as declarable by a
 * *provider Ryntra buys from* and never as something Ryntra offers, and the
 * procurement policy refuses it unless a cap is present.
 */
export const X402_SCHEMES = ["exact", "upto"] as const;

export type X402Scheme = (typeof X402_SCHEMES)[number];

/**
 * The two Solana chain ids, re-exported from the one data-only module that
 * owns them. A CAIP-2 Solana id is the first 32 characters of the genesis
 * blockhash — a fact about the chain rather than a name anyone can squat, which
 * is why the hub keys everything by it and treats `"mainnet"` as a label.
 */
export const X402_SOLANA_NETWORKS = Object.freeze({
  mainnet: SOLANA_CAIP2.mainnet,
  devnet: SOLANA_CAIP2.devnet,
});

export const X402_SOLANA_NETWORK_IDS: readonly string[] = Object.freeze([
  SOLANA_CAIP2.mainnet,
  SOLANA_CAIP2.devnet,
]);

export function isSolanaNetwork(network: string): boolean {
  return X402_SOLANA_NETWORK_IDS.includes(network);
}

/** CAIP-19 for an SPL mint. Derived, never typed — the same rule `assetRefFor` follows. */
export function splAssetRef(network: string, mint: string): string {
  return `${network}/token:${mint}`;
}

/**
 * The client packages the specification names, pinned to the version published
 * when this was written.
 *
 * They are recorded rather than installed, and the distinction is the point.
 * Every byte these packages produce is produced on the **buyer's** side: the
 * payload is signed by the buyer's own wallet, which is not Ryntra's and never
 * will be. On the seller's side the same work is a facilitator call, and the
 * facilitator has no client in this repository because Ryntra holds no
 * credential for one. So the dependency arrives with the owner's key, together
 * with the first real settle, and recording the names and versions here is what
 * makes that a known step rather than a discovery.
 *
 * `@x402/express` is named by the specification and is deliberately absent:
 * this product is Next.js route handlers, and a framework adapter for another
 * framework is not a dependency, it is a mistake with a lockfile entry.
 */
export const X402_CLIENT_PACKAGES: readonly Readonly<{
  name: string;
  version: string;
  role: string;
}>[] = Object.freeze([
  Object.freeze({ name: "@x402/core", version: "2.28.0", role: "protocol types, requirement and payload encoding" }),
  Object.freeze({ name: "@x402/svm", version: "2.28.0", role: "the Solana side of the `exact` scheme" }),
  Object.freeze({ name: "@x402/fetch", version: "2.28.0", role: "the buying client, in the agent's own runtime" }),
]);

export const X402_PACKAGE_SOURCE = Object.freeze({
  url: "https://www.npmjs.com/package/@x402/core",
  observedAt: "2026-10-26",
});

/* ─── Facilitators ─────────────────────────────────────────────────────────── */

export const X402_FACILITATORS = ["COINBASE_CDP", "PAYAI"] as const;

export type X402Facilitator = (typeof X402_FACILITATORS)[number];

export type FacilitatorDeclaration = Readonly<{
  id: X402Facilitator;
  label: string;
  operator: string;
  schemes: readonly X402Scheme[];
  networks: readonly string[];
  /** Whether Ryntra holds a credential for it. It holds none, anywhere. */
  ryntraCredential: "NONE";
  source: Readonly<{ url: string; observedAt: string }>;
  limitations: readonly string[];
}>;

/**
 * Coinbase CDP.
 *
 * Read 2026-10-22 for the owner's x402 review and recorded there: it supports
 * Solana with both `exact` and `upto`, and its published price is free to a
 * thousand transactions a month and $0.001 each after that.
 */
export const COINBASE_CDP_FACILITATOR: FacilitatorDeclaration = Object.freeze({
  id: "COINBASE_CDP",
  label: "Coinbase CDP facilitator",
  operator: "Coinbase",
  schemes: Object.freeze(["exact", "upto"] as const),
  networks: Object.freeze([SOLANA_CAIP2.mainnet, SOLANA_CAIP2.devnet]),
  ryntraCredential: "NONE",
  source: Object.freeze({
    url: "https://docs.cdp.coinbase.com/x402/welcome",
    observedAt: "2026-10-22",
  }),
  limitations: Object.freeze([
    "A CDP API key is the owner's to create and to hold. Nothing in this repository stores one, asks for one, or can call `/verify` or `/settle` without it.",
    "Its own report is a facilitator assertion: it establishes that value moved and says nothing about whether the resource was served.",
    "The published price was read on the date above and is not re-checked by any code here.",
  ]),
});

/**
 * PayAI.
 *
 * The owner's review found it in Solana's own facilitator table with no
 * published tariff. That absence is recorded rather than filled in: a price
 * nobody published is not a price this file may invent.
 */
export const PAYAI_FACILITATOR: FacilitatorDeclaration = Object.freeze({
  id: "PAYAI",
  label: "PayAI facilitator",
  operator: "PayAI",
  schemes: Object.freeze(["exact"] as const),
  networks: Object.freeze([SOLANA_CAIP2.mainnet]),
  ryntraCredential: "NONE",
  source: Object.freeze({
    url: "https://solana.com/developers/guides/advanced/x402",
    observedAt: "2026-10-22",
  }),
  limitations: Object.freeze([
    "Listed in Solana's facilitator table with no published tariff, so no price is declared here.",
    "Only `exact` is declared, because only `exact` was found published. `upto` is absent rather than assumed.",
    "Devnet support was not found published, so no devnet route resolves through it.",
  ]),
});

export const FACILITATOR_DECLARATIONS: readonly FacilitatorDeclaration[] = Object.freeze([
  COINBASE_CDP_FACILITATOR,
  PAYAI_FACILITATOR,
]);

const FACILITATORS_BY_ID = new Map(FACILITATOR_DECLARATIONS.map((entry) => [entry.id, entry]));

/** Look one up, or `null`. Callers turn `null` into a named refusal. */
export function facilitatorDeclaration(id: string): FacilitatorDeclaration | null {
  return FACILITATORS_BY_ID.get(id as X402Facilitator) ?? null;
}

/**
 * Ryntra does not run a facilitator, and this constant is why that is a
 * decision rather than an omission.
 *
 * Solana describes the facilitator as an architectural role that a resource
 * server may fill itself. Filling it means the party with the interest in the
 * payment is the party verifying it, which is self-attestation whoever owns it
 * — the same reason `SELF_HOSTED_X402` carries an `UNVERIFIED_ASSERTION`
 * ceiling in the route engine.
 */
export const RYNTRA_RUNS_A_FACILITATOR = false as const;

/* ─── Digests ──────────────────────────────────────────────────────────────── */

/**
 * Two local hash domains, and the reason they are not in
 * `AGENT_HASH_DOMAINS_V2`.
 *
 * That table covers Agent Control's **artifacts** — intents, passports,
 * receipts — each of which a verifier can be handed on its own. These two cover
 * wire records of one sale: the quote a seller issued and the claim a buyer
 * presented. They are bindings inside one interaction, never artifacts someone
 * carries away, and giving them artifact domains would let a quote be replayed
 * where an artifact digest belongs. The commerce receipt is the artifact of
 * this family, and it already has its domain over there.
 */
export const X402_HASH_DOMAINS = Object.freeze({
  requirements: "ryntra.solana.x402.payment-requirements.v2",
  claim: "ryntra.solana.x402.payment-claim.v2",
});

export type X402HashDomain = (typeof X402_HASH_DOMAINS)[keyof typeof X402_HASH_DOMAINS];

/** The exact bytes a digest covers: the domain line, one `\n`, canonical JSON. */
export function x402Preimage(domain: X402HashDomain, value: unknown): string {
  return `${domain}\n${canonicalJson(value)}`;
}

export function x402Digest(domain: X402HashDomain, value: unknown): string {
  return `0x${createHash("sha256").update(x402Preimage(domain, value), "utf8").digest("hex")}`;
}

/* ─── Requirements ─────────────────────────────────────────────────────────── */

export const X402_WIRE_REFUSALS = [
  "REQUIREMENTS_NETWORK_NOT_SOLANA",
  "REQUIREMENTS_ASSET_MALFORMED",
  "REQUIREMENTS_RECIPIENT_MALFORMED",
  "REQUIREMENTS_AMOUNT_MALFORMED",
  "REQUIREMENTS_AMOUNT_ZERO",
  "REQUIREMENTS_RESOURCE_NOT_HTTPS",
  "REQUIREMENTS_SCHEME_UNKNOWN",
  "REQUIREMENTS_SCHEME_NOT_SUPPORTED_BY_FACILITATOR",
  "REQUIREMENTS_FACILITATOR_UNKNOWN",
  "REQUIREMENTS_FACILITATOR_NETWORK_UNDECLARED",
  "REQUIREMENTS_TIMEOUT_OUT_OF_RANGE",
  "REQUIREMENTS_NONCE_MALFORMED",
  "REQUIREMENTS_EXPIRY_MALFORMED",
  "REQUIREMENTS_EXPIRY_NOT_AFTER_ISSUE",
  "AUTHORIZATION_HEADER_IS_V1",
  "AUTHORIZATION_HEADER_MISSING",
  "AUTHORIZATION_NOT_BASE64_JSON",
  "AUTHORIZATION_SHAPE_UNREADABLE",
  "AUTHORIZATION_VERSION_NOT_V2",
  "AUTHORIZATION_SCHEME_MISMATCH",
  "AUTHORIZATION_NETWORK_MISMATCH",
  "AUTHORIZATION_ASSET_MISMATCH",
  "AUTHORIZATION_RECIPIENT_MISMATCH",
  "AUTHORIZATION_AMOUNT_MISMATCH",
  "AUTHORIZATION_AMOUNT_ABOVE_CAP",
  "AUTHORIZATION_UPTO_WITHOUT_CAP",
  "AUTHORIZATION_RESOURCE_MISMATCH",
  "AUTHORIZATION_RESOURCE_DIGEST_MISMATCH",
  "AUTHORIZATION_NONCE_MISMATCH",
  "AUTHORIZATION_EXPIRED",
  "AUTHORIZATION_PAYER_MALFORMED",
  "AUTHORIZATION_SIGNATURE_MALFORMED",
] as const;

export type X402WireRefusal = (typeof X402_WIRE_REFUSALS)[number];

export class X402WireError extends Error {
  readonly reasonCode: X402WireRefusal;

  constructor(reasonCode: X402WireRefusal, detail: string) {
    super(`${reasonCode}: ${detail}`);
    this.name = "X402WireError";
    this.reasonCode = reasonCode;
  }
}

/**
 * How long a seller may wait on a facilitator, in seconds.
 *
 * The floor is one second rather than zero: a seller who would rather reconcile
 * an unknown settlement than hold a request open is making a legitimate choice,
 * and a zero would mean every sale timed out before it began. The ceiling is
 * two minutes, because beyond that the buyer's connection decides the outcome
 * rather than the facilitator.
 */
export const X402_TIMEOUT_SECONDS = Object.freeze({ min: 1, max: 120 });

export type X402PaymentRequirements = Readonly<{
  x402Version: typeof X402_VERSION;
  scheme: X402Scheme;
  /** CAIP-2. */
  network: string;
  /** The SPL mint, base-58. */
  asset: string;
  /** CAIP-19 over the same mint, derived rather than supplied. */
  assetRef: string;
  assetSymbol: string;
  decimals: number;
  /** Base units. For `exact`, the amount; for `upto`, the ceiling. */
  maxAmountRequired: string;
  payTo: string;
  /** The absolute `https` URL this quote is for. */
  resource: string;
  /** A digest over what is being sold, so a quote cannot be moved to another resource. */
  resourceDigest: string;
  description: string;
  mimeType: string;
  maxTimeoutSeconds: number;
  facilitator: X402Facilitator;
  nonce: string;
  issuedAt: string;
  expiresAt: string;
  /** Where a buyer goes when a payment settles and the resource does not arrive. */
  refund: Readonly<{ kind: "SELLER_REVIEW"; reference: string }>;
  requirementsDigest: string;
  limitations: readonly string[];
}>;

export const X402_REQUIREMENTS_LIMITATIONS: readonly string[] = Object.freeze([
  "This is a quote, not a charge. Nothing is held, reserved or taken until a facilitator settles an authorization the buyer signed.",
  "Ryntra holds no key and no facilitator credential: the buyer's own wallet signs, and the facilitator the owner configures is the only party that can settle.",
  "A settled payment is not a delivered service. The two are separate observations and this sale keeps them apart.",
]);

export type BuildPaymentRequirementsInput = Readonly<{
  scheme: X402Scheme;
  network: string;
  asset: string;
  assetSymbol: string;
  decimals: number;
  maxAmountRequired: string;
  payTo: string;
  resource: string;
  /** Whatever identifies the deliverable: the service id and its inputs. */
  resourceDescriptor: unknown;
  description: string;
  mimeType: string;
  maxTimeoutSeconds: number;
  facilitator: X402Facilitator;
  nonce: string;
  refundReference: string;
  now: Date;
  /** How long the quote stands. Bounded by `X402_TIMEOUT_SECONDS`. */
  validForSeconds: number;
}>;

/**
 * Build one quote, refusing at the first fact it cannot state.
 *
 * Every refusal is the seller's own mistake rather than the buyer's — this runs
 * before a `402` is written — and each is named so a misconfigured service
 * fails at the first request instead of issuing quotes nobody can satisfy.
 */
export function buildPaymentRequirements(
  input: BuildPaymentRequirementsInput,
): X402PaymentRequirements {
  if (!X402_SCHEMES.includes(input.scheme)) {
    throw new X402WireError("REQUIREMENTS_SCHEME_UNKNOWN", String(input.scheme));
  }
  if (!isSolanaNetwork(input.network)) {
    throw new X402WireError(
      "REQUIREMENTS_NETWORK_NOT_SOLANA",
      `${input.network} is not one of the two Solana chain ids this hub sells on`,
    );
  }
  if (!BASE58.test(input.asset)) {
    throw new X402WireError("REQUIREMENTS_ASSET_MALFORMED", `${input.asset} is not a base-58 mint`);
  }
  if (!BASE58.test(input.payTo)) {
    throw new X402WireError("REQUIREMENTS_RECIPIENT_MALFORMED", `${input.payTo} is not an address`);
  }
  if (!BASE_UNITS.test(input.maxAmountRequired)) {
    throw new X402WireError(
      "REQUIREMENTS_AMOUNT_MALFORMED",
      "an amount is whole base units as digits, never a decimal display string",
    );
  }
  if (BigInt(input.maxAmountRequired) === 0n) {
    throw new X402WireError("REQUIREMENTS_AMOUNT_ZERO", "a free resource does not answer 402");
  }

  let resourceUrl: URL;
  try {
    resourceUrl = new URL(input.resource);
  } catch {
    throw new X402WireError("REQUIREMENTS_RESOURCE_NOT_HTTPS", `${input.resource} is not a URL`);
  }
  if (resourceUrl.protocol !== "https:") {
    throw new X402WireError(
      "REQUIREMENTS_RESOURCE_NOT_HTTPS",
      `${resourceUrl.protocol} is not https, and a priced resource is not served in the clear`,
    );
  }

  const facilitator = facilitatorDeclaration(input.facilitator);
  if (!facilitator) {
    throw new X402WireError("REQUIREMENTS_FACILITATOR_UNKNOWN", String(input.facilitator));
  }
  if (!facilitator.schemes.includes(input.scheme)) {
    throw new X402WireError(
      "REQUIREMENTS_SCHEME_NOT_SUPPORTED_BY_FACILITATOR",
      `${facilitator.label} publishes no ${input.scheme}`,
    );
  }
  if (!facilitator.networks.includes(input.network)) {
    throw new X402WireError(
      "REQUIREMENTS_FACILITATOR_NETWORK_UNDECLARED",
      `${facilitator.label} declares no ${input.network}`,
    );
  }

  if (
    !Number.isInteger(input.maxTimeoutSeconds) ||
    input.maxTimeoutSeconds < X402_TIMEOUT_SECONDS.min ||
    input.maxTimeoutSeconds > X402_TIMEOUT_SECONDS.max
  ) {
    throw new X402WireError(
      "REQUIREMENTS_TIMEOUT_OUT_OF_RANGE",
      `${input.maxTimeoutSeconds}s is outside ${X402_TIMEOUT_SECONDS.min}–${X402_TIMEOUT_SECONDS.max}s`,
    );
  }
  if (typeof input.nonce !== "string" || !/^[A-Za-z0-9_-]{16,128}$/.test(input.nonce)) {
    throw new X402WireError(
      "REQUIREMENTS_NONCE_MALFORMED",
      "a nonce is 16 to 128 URL-safe characters, and it is the seller who issues it",
    );
  }
  if (!Number.isInteger(input.validForSeconds) || input.validForSeconds <= 0) {
    throw new X402WireError("REQUIREMENTS_EXPIRY_NOT_AFTER_ISSUE", String(input.validForSeconds));
  }

  const issuedAt = input.now.toISOString();
  if (!ISO_INSTANT.test(issuedAt)) {
    throw new X402WireError("REQUIREMENTS_EXPIRY_MALFORMED", "the clock did not produce an instant");
  }
  const expiresAt = new Date(input.now.getTime() + input.validForSeconds * 1_000).toISOString();

  const resourceDigest = x402Digest(X402_HASH_DOMAINS.requirements, {
    resource: resourceUrl.toString(),
    descriptor: input.resourceDescriptor,
  });

  const core = {
    x402Version: X402_VERSION,
    scheme: input.scheme,
    network: input.network,
    asset: input.asset,
    assetRef: splAssetRef(input.network, input.asset),
    assetSymbol: input.assetSymbol,
    decimals: input.decimals,
    maxAmountRequired: input.maxAmountRequired,
    payTo: input.payTo,
    resource: resourceUrl.toString(),
    resourceDigest,
    description: input.description,
    mimeType: input.mimeType,
    maxTimeoutSeconds: input.maxTimeoutSeconds,
    facilitator: facilitator.id,
    nonce: input.nonce,
    issuedAt,
    expiresAt,
    refund: Object.freeze({ kind: "SELLER_REVIEW" as const, reference: input.refundReference }),
    limitations: X402_REQUIREMENTS_LIMITATIONS,
  };

  return Object.freeze({
    ...core,
    requirementsDigest: x402Digest(X402_HASH_DOMAINS.requirements, core),
  });
}

/** The `PAYMENT-REQUIRED` header value: base64 of the quote's JSON. */
export function encodePaymentRequirements(requirements: X402PaymentRequirements): string {
  return Buffer.from(JSON.stringify(requirements), "utf8").toString("base64");
}

/* ─── The buyer's authorization ────────────────────────────────────────────── */

/**
 * What a `PAYMENT-SIGNATURE` carries, in the shape this seller reads.
 *
 * It is deliberately a *narrow* read. The hub checks the declared facts — which
 * chain, which mint, who is paid, how much, for which resource, until when —
 * and hands the bytes to the facilitator for everything cryptographic. Parsing
 * a signed Solana transaction here would mean this file decided whether a
 * signature was valid, and a resource server that validates its own payments is
 * the self-attestation `RYNTRA_RUNS_A_FACILITATOR` exists to refuse.
 */
export type X402PaymentAuthorization = Readonly<{
  x402Version: number;
  scheme: string;
  network: string;
  payload: Readonly<{
    asset: string;
    amount: string;
    payTo: string;
    payer: string;
    resource: string;
    resourceDigest: string;
    nonce: string;
    validUntil: string;
    /** Opaque to this module: the facilitator reads it, nobody here does. */
    signature: string;
  }>;
}>;

export type DecodeResult =
  | Readonly<{ ok: true; value: X402PaymentAuthorization }>
  | Readonly<{ ok: false; reasonCode: X402WireRefusal; detail: string }>;

const refuse = (reasonCode: X402WireRefusal, detail: string): DecodeResult =>
  Object.freeze({ ok: false as const, reasonCode, detail });

function readString(source: Record<string, unknown>, key: string): string | null {
  const value = source[key];
  return typeof value === "string" && value.length > 0 && value.length <= 4096 ? value : null;
}

/**
 * Read the authorization header, or say exactly why it could not be read.
 *
 * A V1 header is its own refusal and it is checked first: a buyer sending
 * `X-PAYMENT` has a client one major version behind, and telling them the
 * payload was unreadable would send them looking for a bug in their JSON.
 */
export function decodePaymentAuthorization(headers: Headers): DecodeResult {
  if (headers.get(X402_V1_AUTHORIZATION_HEADER) !== null) {
    return refuse(
      "AUTHORIZATION_HEADER_IS_V1",
      `${X402_V1_AUTHORIZATION_HEADER} is the V1 header; this seller speaks V2 and reads ${X402_HEADERS.authorization}`,
    );
  }
  const raw = headers.get(X402_HEADERS.authorization);
  if (raw === null || raw.trim().length === 0) {
    return refuse("AUTHORIZATION_HEADER_MISSING", `no ${X402_HEADERS.authorization} was presented`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(raw.trim(), "base64").toString("utf8"));
  } catch {
    return refuse("AUTHORIZATION_NOT_BASE64_JSON", "the header is not base64 of a JSON document");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return refuse("AUTHORIZATION_SHAPE_UNREADABLE", "the payload is not a JSON object");
  }

  const top = parsed as Record<string, unknown>;
  const payloadValue = top.payload;
  if (!payloadValue || typeof payloadValue !== "object" || Array.isArray(payloadValue)) {
    return refuse("AUTHORIZATION_SHAPE_UNREADABLE", "the payload carries no `payload` object");
  }
  const payload = payloadValue as Record<string, unknown>;

  const scheme = readString(top, "scheme");
  const network = readString(top, "network");
  if (typeof top.x402Version !== "number" || scheme === null || network === null) {
    return refuse("AUTHORIZATION_SHAPE_UNREADABLE", "version, scheme or network is missing");
  }

  const fields = ["asset", "amount", "payTo", "payer", "resource", "resourceDigest", "nonce", "validUntil", "signature"] as const;
  const read: Record<string, string> = {};
  for (const field of fields) {
    const value = readString(payload, field);
    if (value === null) {
      return refuse("AUTHORIZATION_SHAPE_UNREADABLE", `the payload carries no \`${field}\``);
    }
    read[field] = value;
  }

  if (!BASE58.test(read.payer)) {
    return refuse("AUTHORIZATION_PAYER_MALFORMED", `${read.payer} is not an address`);
  }
  if (!/^[A-Za-z0-9+/=_-]{16,2048}$/.test(read.signature)) {
    return refuse("AUTHORIZATION_SIGNATURE_MALFORMED", "the signature field is not an opaque token");
  }

  return Object.freeze({
    ok: true as const,
    value: Object.freeze({
      x402Version: top.x402Version,
      scheme,
      network,
      payload: Object.freeze({
        asset: read.asset,
        amount: read.amount,
        payTo: read.payTo,
        payer: read.payer,
        resource: read.resource,
        resourceDigest: read.resourceDigest,
        nonce: read.nonce,
        validUntil: read.validUntil,
        signature: read.signature,
      }),
    }),
  });
}

export type AuthorizationVerdict =
  | Readonly<{
      ok: true;
      /** The amount this sale may settle for, in base units. */
      amount: string;
      payer: string;
      /** The one identifier the replay store claims. Stable across retries. */
      paymentId: string;
    }>
  | Readonly<{ ok: false; reasonCode: X402WireRefusal; detail: string }>;

/**
 * Check a presented authorization against the quote that asked for it.
 *
 * The checks run in the order the module header states, and `exact` is held to
 * equality rather than to a ceiling: a scheme named `exact` whose amount is
 * merely *not more than* the quote is a scheme that silently became `upto`.
 */
export function verifyPaymentAuthorization({
  requirements,
  authorization,
  now,
}: {
  requirements: X402PaymentRequirements;
  authorization: X402PaymentAuthorization;
  now: Date;
}): AuthorizationVerdict {
  const no = (reasonCode: X402WireRefusal, detail: string): AuthorizationVerdict =>
    Object.freeze({ ok: false as const, reasonCode, detail });

  if (authorization.x402Version !== X402_VERSION) {
    return no("AUTHORIZATION_VERSION_NOT_V2", `x402Version ${authorization.x402Version}`);
  }
  if (authorization.scheme !== requirements.scheme) {
    return no(
      "AUTHORIZATION_SCHEME_MISMATCH",
      `the quote is ${requirements.scheme} and the authorization says ${authorization.scheme}`,
    );
  }
  if (authorization.network !== requirements.network) {
    return no(
      "AUTHORIZATION_NETWORK_MISMATCH",
      `the quote is for ${requirements.network} and the authorization is for ${authorization.network}`,
    );
  }

  const payload = authorization.payload;
  if (payload.asset !== requirements.asset) {
    return no(
      "AUTHORIZATION_ASSET_MISMATCH",
      `the quote names mint ${requirements.asset} and the authorization names ${payload.asset}`,
    );
  }
  if (payload.payTo !== requirements.payTo) {
    return no(
      "AUTHORIZATION_RECIPIENT_MISMATCH",
      `the quote pays ${requirements.payTo} and the authorization pays ${payload.payTo}`,
    );
  }

  if (!BASE_UNITS.test(payload.amount)) {
    return no("AUTHORIZATION_AMOUNT_MISMATCH", "the amount is not whole base units");
  }
  const presented = BigInt(payload.amount);
  const quoted = BigInt(requirements.maxAmountRequired);
  if (requirements.scheme === "exact") {
    if (presented !== quoted) {
      return no(
        "AUTHORIZATION_AMOUNT_MISMATCH",
        `exact means exactly ${requirements.maxAmountRequired}, and ${payload.amount} is not that`,
      );
    }
  } else if (presented > quoted) {
    return no(
      "AUTHORIZATION_AMOUNT_ABOVE_CAP",
      `${payload.amount} is above the declared cap ${requirements.maxAmountRequired}`,
    );
  }

  if (payload.resource !== requirements.resource) {
    return no(
      "AUTHORIZATION_RESOURCE_MISMATCH",
      `the quote is for ${requirements.resource} and the authorization names ${payload.resource}`,
    );
  }
  if (payload.resourceDigest !== requirements.resourceDigest) {
    return no(
      "AUTHORIZATION_RESOURCE_DIGEST_MISMATCH",
      "the authorization carries a digest for a different deliverable",
    );
  }
  if (payload.nonce !== requirements.nonce) {
    return no("AUTHORIZATION_NONCE_MISMATCH", "the authorization answers a different quote");
  }

  const validUntil = Date.parse(payload.validUntil);
  const quoteExpiry = Date.parse(requirements.expiresAt);
  if (!Number.isFinite(validUntil)) {
    return no("AUTHORIZATION_EXPIRED", "the authorization states no readable expiry");
  }
  if (now.getTime() > quoteExpiry || now.getTime() > validUntil) {
    return no(
      "AUTHORIZATION_EXPIRED",
      `the quote stood until ${requirements.expiresAt} and the authorization until ${payload.validUntil}`,
    );
  }

  return Object.freeze({
    ok: true as const,
    amount: payload.amount,
    payer: payload.payer,
    paymentId: paymentIdentifier({ requirements, authorization }),
  });
}

/**
 * The one identifier the replay store claims, and the reason it is a digest
 * rather than the signature.
 *
 * A signature alone cannot answer "has this payment already bought this
 * resource": the same buyer can legitimately pay twice for two different
 * reports, and a scheme whose payload is rebuilt with a fresh blockhash
 * produces new bytes for the same purchase. So the identifier covers what makes
 * a purchase one purchase — the quote, the resource and the payer's own
 * authorization — and two requests that differ in any of those are two
 * payments, while a retry of the same one is the same payment.
 */
export function paymentIdentifier({
  requirements,
  authorization,
}: {
  requirements: X402PaymentRequirements;
  authorization: X402PaymentAuthorization;
}): string {
  return x402Digest(X402_HASH_DOMAINS.claim, {
    requirementsDigest: requirements.requirementsDigest,
    nonce: requirements.nonce,
    resourceDigest: requirements.resourceDigest,
    payer: authorization.payload.payer,
    amount: authorization.payload.amount,
    signature: authorization.payload.signature,
  });
}

/* ─── The response header ──────────────────────────────────────────────────── */

export type X402PaymentResponse = Readonly<{
  x402Version: typeof X402_VERSION;
  scheme: X402Scheme;
  network: string;
  /** What the facilitator said, never what Ryntra concluded. */
  settlement: "SETTLED" | "PENDING_VERIFICATION" | "FAILED";
  facilitator: X402Facilitator;
  transaction: string | null;
  payer: string;
  amount: string;
  asset: string;
  paymentId: string;
  /** Whether the resource actually went out. A separate axis, always stated. */
  delivery: "DELIVERED" | "NOT_DELIVERED" | "AWAITING_RECONCILIATION";
}>;

/** The `PAYMENT-RESPONSE` header value: base64 of the response's JSON. */
export function encodePaymentResponse(response: X402PaymentResponse): string {
  return Buffer.from(JSON.stringify(response), "utf8").toString("base64");
}
