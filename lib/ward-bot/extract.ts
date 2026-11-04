/**
 * What in a chat message the pre-sign check can read (CITY-166): a transaction, a link, an address (a wallet or a
 * token's mint — a «CA»; the engine tells which), or a sent transaction's signature (which it cannot check).
 *
 * Only the first such thing in a message is taken: one message, at most one check, at most one reply. A web address is
 * taken only when it is a Solana link (`solana:`, `solana-action:`, a Ryntra payment link, a page that carries an
 * action) or an explorer's page of one address — never an address lifted out of an unknown site, which would let a
 * phishing page borrow the verdict of the real token it names. Everything else is left alone: the bot is quiet unless
 * it has something to check.
 *
 * Pure: no clock, no network.
 */

import { getBase58Encoder } from "@solana/kit";

import { readWire } from "../ward/wire.ts";
import { cleanIncoming } from "./clean.ts";

export type WardBotSubject =
  | Readonly<{ kind: "transaction"; value: string }>
  | Readonly<{ kind: "link"; value: string }>
  | Readonly<{ kind: "address"; value: string }>
  | Readonly<{ kind: "signature"; value: string }>;

/** Ryntra's own payment links. */
const RYNTRA_HOSTS = ["ryntra.io"];
/** Explorers and token pages whose address is the page's subject — a wallet, a mint or a transaction, never a pool. */
const EXPLORER_HOSTS = ["solscan.io", "explorer.solana.com", "solana.fm", "birdeye.so", "pump.fun", "gmgn.ai", "rugcheck.xyz", "jup.ag"];

const BASE58_RUN = /^[1-9A-HJ-NP-Za-km-z]+$/;
const BASE64_RUN = /^[A-Za-z0-9+/]+={0,2}$/;
/** The longest token read as a transaction: a 1 232-byte transaction is at most ~1 700 characters in either encoding. */
const TOKEN_MAX = 2_000;
const LEADING = /^[(\[{<"'«„“‘`]+/;
const TRAILING = /[)\]}>"'»“”’`.,;:!?]+$/;
const base58 = getBase58Encoder();

function bytesOf58(text: string): Uint8Array | null {
  try {
    return base58.encode(text) as Uint8Array;
  } catch {
    return null;
  }
}

/** A base58 run: an address (32 bytes) or a signature (64 bytes), or nothing. */
function keyOf(text: string): WardBotSubject | null {
  if (!BASE58_RUN.test(text)) return null;
  if (text.length >= 32 && text.length <= 44 && bytesOf58(text)?.length === 32) return { kind: "address", value: text };
  if (text.length >= 86 && text.length <= 88 && bytesOf58(text)?.length === 64) return { kind: "signature", value: text };
  return null;
}

function transactionOf(text: string): WardBotSubject | null {
  if (text.length < 100 || text.length > TOKEN_MAX) return null;
  if (BASE64_RUN.test(text) && readWire(text).ok) return { kind: "transaction", value: text };
  /* Some tools print a transaction in base58; the engine reads base64. */
  if (BASE58_RUN.test(text)) {
    const bytes = bytesOf58(text);
    if (bytes && bytes.length >= 64) {
      const wire = Buffer.from(bytes).toString("base64");
      if (readWire(wire).ok) return { kind: "transaction", value: wire };
    }
  }
  return null;
}

const hostIs = (host: string, list: readonly string[]) => list.some((entry) => host === entry || host.endsWith(`.${entry}`));

function linkOf(text: string): WardBotSubject | null {
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  const host = url.hostname.toLowerCase();
  /* A page that carries a Solana action (a «blink»): the action is what a wallet would be asked to sign for. */
  for (const value of url.searchParams.values()) {
    if (/^solana-action:/i.test(value)) return { kind: "link", value };
  }
  if (hostIs(host, RYNTRA_HOSTS) && /^\/pay\/[^/]+\/?$/.test(url.pathname)) return { kind: "link", value: url.toString() };
  if (hostIs(host, EXPLORER_HOSTS)) {
    const parts = [...url.pathname.split(/[/\-_]/), ...url.searchParams.values()];
    for (const part of parts) {
      const key = keyOf(part);
      if (key) return key;
    }
  }
  return null;
}

function subjectOf(token: string): WardBotSubject | null {
  if (token.length < 32) return null;
  if (/^solana-action:/i.test(token) || /^solana:/i.test(token)) return token.length <= TOKEN_MAX ? { kind: "link", value: token } : null;
  if (/^https?:\/\//i.test(token)) return token.length <= TOKEN_MAX ? linkOf(token) : null;
  return keyOf(token) ?? transactionOf(token);
}

/** The first thing in `text` the check can read, or null. `text` may be raw: it is cleaned here first. */
export function findSubject(text: unknown): WardBotSubject | null {
  const clean = cleanIncoming(text);
  for (const raw of clean.split(/\s+/)) {
    const token = raw.replace(LEADING, "").replace(TRAILING, "");
    const found = subjectOf(token);
    if (found) return found;
  }
  return null;
}

/** The key two pastes of the same thing share: the same address twice is one check. */
export function subjectKey(subject: WardBotSubject): string {
  return `${subject.kind}:${subject.value.length > 128 ? `${subject.value.slice(0, 64)}…${subject.value.slice(-64)}#${subject.value.length}` : subject.value}`;
}
