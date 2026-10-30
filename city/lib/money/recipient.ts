import { summarizeAddressEvidence, type AddressEvidenceRead, type AddressEvidenceSummary } from '../../../lib/evidence/address.ts';
import { addressProblem } from '../../../lib/solana/address.ts';
import { lookalikeOf, skrNameOf } from '../../../lib/solana/skr-name.ts';
import { isNewRecipient } from '../../../lib/solana/send-recipients.client.ts';
import { wordsNow } from '../i18n/dict.ts';
import { RECIPIENT_CHECK_WORDS, RECIPIENT_PROBLEM_WORDS } from './words.ts';

/**
 * «To» on the Send tab, read the engine's way. What was typed is one of: a Solana address (the engine's own shape and
 * its three mistakes, `lib/solana/address.ts`), a `.skr` name the engine resolves (`lib/solana/skr.client.ts`, read
 * again before the wallet opens and before the bytes leave), or a payment request — `solana:` or a Ryntra link — that
 * the engine's recipient check classifies (`GET /api/v1/money/recipient`). Anything else is said plainly: a `.sol`
 * name is not one the engine reads, and a `0x` address belongs on Bridge.
 */

export type RecipientProblem =
  | 'NOT_AN_ADDRESS'
  | 'MISREAD_CHARACTER'
  | 'WRONG_LENGTH'
  | 'BAD_NAME'
  | 'SOL_NAME'
  | 'OTHER_NETWORK'
  | 'SELF';

export type RecipientRead =
  | Readonly<{ kind: 'empty' }>
  | Readonly<{ kind: 'address'; address: string }>
  /** A `.skr` name: an address only once the engine answered where it points now. */
  | Readonly<{ kind: 'name'; name: string }>
  /** A `solana:` request or a Ryntra payment link: the engine's recipient check says what it is. */
  | Readonly<{ kind: 'request'; text: string }>
  | Readonly<{ kind: 'problem'; problem: RecipientProblem; text: string }>;

const EVM = /^0x[0-9a-fA-F]{40}$/;
const SOL_NAME = /^[^\s]+\.sol$/i;

/** The problems in English, as written (the words on screen follow the language: `RECIPIENT_PROBLEM_WORDS`). */
export const RECIPIENT_WORDS: Readonly<Record<RecipientProblem, string>> = RECIPIENT_PROBLEM_WORDS.en;

function problem(code: RecipientProblem): RecipientRead {
  return { kind: 'problem', problem: code, text: wordsNow(RECIPIENT_PROBLEM_WORDS)[code] };
}

/** What was typed in «To». `self` is the connected wallet: sending to it is refused before anything is asked. */
export function readRecipient(typed: string, self: string | null = null): RecipientRead {
  const value = typed.trim();
  if (value === '') return { kind: 'empty' };
  if (/^solana:/i.test(value) || /^https?:\/\//i.test(value)) return { kind: 'request', text: value };
  if (EVM.test(value)) return problem('OTHER_NETWORK');
  if (value.toLowerCase().endsWith('.skr')) {
    const name = skrNameOf(value);
    return name ? { kind: 'name', name } : problem('BAD_NAME');
  }
  if (SOL_NAME.test(value)) return problem('SOL_NAME');
  const shape = addressProblem(value);
  if (shape === 'EMPTY') return { kind: 'empty' };
  if (shape) return problem(shape);
  if (self && value === self) return problem('SELF');
  return { kind: 'address', address: value };
}

/** The engine's recipient check, as the city says its answers (contract 1.22.0, `RECIPIENT_PROBLEMS`). */
const SAME_AS_PROBLEM = new Set<string>(['NOT_AN_ADDRESS', 'MISREAD_CHARACTER', 'WRONG_LENGTH', 'SELF']);
const CHECK_CODES = new Set<string>(Object.keys(RECIPIENT_CHECK_WORDS.en).filter((code) => code === code.toUpperCase()));

export function checkProblemWords(code: string | null | undefined): string {
  if (code && SAME_AS_PROBLEM.has(code)) return wordsNow(RECIPIENT_PROBLEM_WORDS)[code as RecipientProblem];
  const w = wordsNow(RECIPIENT_CHECK_WORDS);
  return code && CHECK_CODES.has(code) ? (w as Readonly<Record<string, string>>)[code] : w.fallback;
}

/** The engine's recipient check, as much of it as the Send tab acts on. */
export type RecipientCheck = Readonly<{
  next: 'transfer' | 'pay-link' | 'none';
  problem: string | null;
  address: string | null;
  opensAccount: boolean;
  /** What a scanned request asks for, in the coin's units. */
  askedAmount: string | null;
  /** The Ryntra link, when what was typed is one: it is paid on its own page. */
  linkUrl: string | null;
}>;

/** The check's answer, believed only in the shape the contract gives it. */
export function parseRecipientCheck(body: unknown): RecipientCheck | null {
  if (!body || typeof body !== 'object') return null;
  const value = body as Record<string, unknown>;
  const next = value.next;
  if (next !== 'transfer' && next !== 'pay-link' && next !== 'none') return null;
  const address = typeof value.address === 'string' && addressProblem(value.address) === null ? value.address : null;
  if (next === 'transfer' && !address) return null;
  const destination = value.destination && typeof value.destination === 'object' ? (value.destination as Record<string, unknown>) : null;
  const asked = value.asked && typeof value.asked === 'object' ? (value.asked as Record<string, unknown>) : null;
  const link = value.link && typeof value.link === 'object' ? (value.link as Record<string, unknown>) : null;
  return {
    next,
    problem: typeof value.problem === 'string' ? value.problem : null,
    address,
    opensAccount: destination?.opensAccount === true,
    askedAmount: typeof asked?.amount === 'string' && /^(0|[1-9][0-9]*)(\.[0-9]+)?$/.test(asked.amount) ? asked.amount : null,
    linkUrl: typeof link?.url === 'string' && /^https:\/\//.test(link.url) ? link.url : null,
  };
}

export type Guard = Readonly<{
  /** A known address this one copies the edges of — the poisoning trick (SEC-2). */
  lookalike: string | null;
  /** Nothing was sent to it from this browser yet (SEC-2). */
  isNew: boolean;
}>;

/**
 * The two checks the engine's Send keeps on a real address before the wallet opens (SEC-2): a look-alike of a recent
 * recipient or of the wallet itself, and an address this browser never paid. Each holds the action until the person
 * says it is the one they meant. `recentsRead` false means the list was not looked at yet — not «new».
 */
export function guardOf(address: string, self: string | null, recents: readonly string[], recentsRead: boolean): Guard {
  const known = self ? [...recents, self] : [...recents];
  return {
    lookalike: address === self ? null : lookalikeOf(known, address),
    isNew: recentsRead && address !== self && isNewRecipient(recents, address),
  };
}

/** A whole address in groups of four, as the eye checks it. */
export function grouped(address: string): string {
  return (address.match(/.{1,4}/g) ?? []).join(' ');
}

export function short(address: string): string {
  return address.length <= 12 ? address : `${address.slice(0, 4)}…${address.slice(-4)}`;
}

/**
 * The security source's word on the address the money goes to (`GET /api/v1/research/address-evidence`), as the web's
 * «Send» reads it. Ryntra never stops a transfer on it: the person decides. Only a word that should change their mind
 * is a line on screen; «nothing found» and «not checked» say nothing.
 */
export type RiskRead = Readonly<{ address: string; summary: AddressEvidenceSummary }>;

export function riskOf(body: unknown): AddressEvidenceSummary {
  if (!body || typeof body !== 'object' || typeof (body as Record<string, unknown>).state !== 'string') return 'unavailable';
  try {
    return summarizeAddressEvidence(body as AddressEvidenceRead);
  } catch {
    // A read in a shape the contract does not give is no read.
    return 'unavailable';
  }
}

export function riskLine(summary: AddressEvidenceSummary | null | undefined): Readonly<{ tone: 'warn' | 'error'; text: string }> | null {
  if (summary === 'sanctioned') return { tone: 'error', text: wordsNow(RECIPIENT_CHECK_WORDS).sanctioned };
  if (summary === 'evidence-found') return { tone: 'warn', text: wordsNow(RECIPIENT_CHECK_WORDS).evidence };
  return null;
}
