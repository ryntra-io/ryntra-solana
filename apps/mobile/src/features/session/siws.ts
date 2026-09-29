/**
 * Sign In With Solana — the client's half, pure.
 *
 * The server builds the sign-in input (domain, URI, statement, nonce, the
 * issue and expiry times) and the exact message text; the wallet shows the
 * text and signs it; the server verifies every field against what it issued
 * before the signature. This module turns the server's input into the
 * Mobile Wallet Adapter sign-in payload, checks that what the wallet signed
 * is what the server issued, and shapes the verify request. No key, no
 * token and no transaction is touched here; nothing is invented on the phone.
 */

export type SiwsInput = Readonly<{
  domain: string
  address: string
  statement: string
  uri: string
  version: string
  chainId: string
  nonce: string
  issuedAt: string
  expirationTime: string
}>

/** The exact text a wallet signs — identical to what `solana:signIn` builds from the input, and to the web's. */
export function siwsMessageText(input: SiwsInput): string {
  return [
    `${input.domain} wants you to sign in with your Solana account:`,
    input.address,
    '',
    input.statement,
    '',
    `URI: ${input.uri}`,
    `Version: ${input.version}`,
    `Chain ID: ${input.chainId}`,
    `Nonce: ${input.nonce}`,
    `Issued At: ${input.issuedAt}`,
    `Expiration Time: ${input.expirationTime}`,
  ].join('\n')
}

/** The Mobile Wallet Adapter `sign_in_payload` for the server's input — field for field, nothing added. */
export function signInPayloadFrom(input: SiwsInput): Readonly<{
  domain: string
  address: string
  statement: string
  uri: string
  version: string
  chainId: string
  nonce: string
  issuedAt: string
  expirationTime: string
}> {
  return {
    domain: input.domain,
    address: input.address,
    statement: input.statement,
    uri: input.uri,
    version: input.version,
    chainId: input.chainId,
    nonce: input.nonce,
    issuedAt: input.issuedAt,
    expirationTime: input.expirationTime,
  }
}

const utf8 = new TextEncoder()
const fromUtf8 = new TextDecoder()

export function textBytes(text: string): Uint8Array {
  return utf8.encode(text)
}

/**
 * True when the bytes the wallet signed are the server's message for this
 * input: the same nonce, address, domain and expiry, and nothing else. A
 * wallet that supports `solana:signIn` rebuilds the text from the fields; one
 * that only signs messages signs the text verbatim — both must read back as
 * the issued message, or the app does not send the signature anywhere.
 */
export function signedWhatWasIssued(signedMessage: Uint8Array, input: SiwsInput): boolean {
  let text: string
  try {
    text = fromUtf8.decode(signedMessage)
  } catch {
    return false
  }
  return text === siwsMessageText(input)
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

/** Standard base64 with padding — the encoding the verify route reads; pure so tests need no runtime. */
export function bytesToBase64(bytes: Uint8Array): string {
  let out = ''
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i]!
    const b = i + 1 < bytes.length ? bytes[i + 1]! : 0
    const c = i + 2 < bytes.length ? bytes[i + 2]! : 0
    const triple = (a << 16) | (b << 8) | c
    out += B64[(triple >> 18) & 63]! + B64[(triple >> 12) & 63]!
    out += i + 1 < bytes.length ? B64[(triple >> 6) & 63]! : '='
    out += i + 2 < bytes.length ? B64[triple & 63]! : '='
  }
  return out
}

/** The verify request's signed part — contract 1.3.0 `VerifyRequest` without `client`, which the API layer adds. */
/** Base64 — standard or URL-safe, padded or not — back into bytes; null when the text is not base64. */
export function base64ToBytes(text: string): Uint8Array | null {
  const clean = text.replace(/=+$/, '').replace(/-/g, '+').replace(/_/g, '/')
  if (clean.length === 0 || !/^[A-Za-z0-9+/]+$/.test(clean) || clean.length % 4 === 1) return null
  const out = new Uint8Array(Math.floor((clean.length * 3) / 4))
  let buffer = 0
  let bits = 0
  let index = 0
  for (const char of clean) {
    buffer = (buffer << 6) | B64.indexOf(char)
    bits += 6
    if (bits >= 8) {
      bits -= 8
      out[index++] = (buffer >> bits) & 0xff
    }
  }
  return out.subarray(0, index)
}

const BASE64_TEXT = /^[A-Za-z0-9+/_-]+={0,2}$/

/**
 * The bytes the wallet signed, as bytes. Mobile Wallet Adapter answers a
 * sign-in with base64 strings, and `@wallet-ui/react-native-kit` (4.3.0)
 * hands them on as the UTF-8 bytes of that base64 text rather than the
 * decoded bytes (standard or URL-safe, padded or not, by the wallet); a
 * Sign In With Solana message holds spaces, colons and line breaks and an
 * Ed25519 signature is 64 raw bytes, so base64 text is unmistakable and is
 * decoded here — anything else passes through as it is.
 */
export function walletBytes(value: Uint8Array): Uint8Array {
  let text: string
  try {
    text = fromUtf8.decode(value)
  } catch {
    return value
  }
  if (!BASE64_TEXT.test(text)) return value
  return base64ToBytes(text) ?? value
}

export type SiwsVerifyBody = Readonly<{
  address: string
  /** base64 of the bytes the wallet signed */
  signedMessage: string
  /** base64 of the 64-byte Ed25519 signature */
  signature: string
}>

/** The verify request: the address, the signed bytes and the signature, as the server's schema reads them. */
export function verifyBodyFrom(
  input: Readonly<{ address: string; signedMessage: Uint8Array; signature: Uint8Array }>,
): SiwsVerifyBody | null {
  if (input.signature.length !== 64 || input.signedMessage.length === 0) return null
  return {
    address: input.address,
    signedMessage: bytesToBase64(input.signedMessage),
    signature: bytesToBase64(input.signature),
  }
}
