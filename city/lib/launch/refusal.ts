import { wordsNow, type Same } from '../i18n/dict.ts';
import { REFUSAL_WORDS } from './words.ts';

/**
 * Every way a launch from the city can stop, in a person's words (CITY-181): what happened in one sentence, whether any
 * money moved, and one way on. The engine answers in its contract's codes (`lib/api/v1/contract.ts`) and its own
 * English; the city never shows that English — it reads the code, and where one code covers several causes
 * (`LAUNCH_SUBMIT_FAILED`, `UNAVAILABLE`, a wallet's refusal) it reads the cause from the text here, in `causeOf`, and
 * nowhere else. The engine's text stays for support, behind «Details», without addresses or paths.
 */

/** Why a launch stopped. `before` — nothing was sent; `send` — the signed creation reached the engine and its fate is the chain's. */
export type LaunchFailure = Readonly<{ code: string; stage: 'before' | 'send'; message: string; token: string | null }>;

/** The city's own refusals, beside the engine's codes. */
export const CITY_CLOSED = 'CITY_LAUNCH_CLOSED';
export const BUILD_UNEXPECTED = 'CITY_BUILD_UNEXPECTED';
export const WALLET_REFUSED = 'WALLET_REFUSED';
export const BUILD_AGED = 'LAUNCH_BUILD_EXPIRED';

export type RefusalKind =
  | 'closed'
  | 'declined'
  | 'walletFailed'
  | 'lowSol'
  | 'aged'
  | 'networkBusy'
  | 'busyHour'
  | 'rateLimited'
  | 'ryntraNotSigned'
  | 'unreachable'
  | 'unexpected'
  | 'picture'
  | 'pictureUnchecked'
  | 'ticker'
  | 'invalid'
  | 'limit'
  | 'paused'
  | 'unavailable'
  | 'mismatch'
  | 'otherBytes'
  | 'used'
  | 'chainRefused'
  | 'noAnswer'
  | 'unknown';

/** The one way on: build and sign again, add SOL, choose another picture, change the fields, or close the sheet. */
export type RefusalAction = 'retry' | 'topUp' | 'picture' | 'edit' | 'close';

/** Whether money moved: nothing was sent; it was sent and nothing left the wallet; or the chain may still hold it. */
export type RefusalMoney = 'nothingSent' | 'nothingSigned' | 'nothingStored' | 'nothingLeft' | 'maybeLanded' | 'landing';

export type Refusal = Readonly<{
  kind: RefusalKind;
  /** What happened — one sentence. */
  what: string;
  /** Whether money moved — one sentence, every time. */
  money: string;
  moneyKind: RefusalMoney;
  action: RefusalAction;
  /** The action's label. */
  act: string;
  /** For support, behind «Details»: the contract's code, the stage, and the engine's words without addresses or paths. */
  details: readonly Readonly<{ label: string; value: string }>[];
}>;

type W = Same<(typeof REFUSAL_WORDS)['en']>;

/** A cause read from free text, for the codes that carry several. */
export type TextCause = 'ryntraNotSigned' | 'lowSol' | 'aged' | 'networkBusy' | 'paused' | 'declined';

/**
 * The one place the city reads a cause from the engine's or a wallet's text. The order matters: Ryntra's own signer
 * first («Ryntra's pool payer did not sign the launch»), then the wallet's balance, the blockhash, a busy network,
 * a pause, and a person who said no.
 */
export function causeOf(text: string): TextCause | null {
  const t = text.trim();
  if (!t) return null;
  if (/ryntra.{0,24}\b(payer|executor|signer)\b|\b(pool payer|executor|cosigner|co-signer)\b.{0,40}\b(did not|didn't|could not|couldn't|failed to|cannot) sign|\b(kms|signing) key\b.{0,24}\b(did not|didn't|failed)|\bkey did not sign\b/i.test(t)) return 'ryntraNotSigned';
  if (/insufficient (lamports|funds|balance|sol)|insufficientfunds|no record of a prior credit|not enough sol|insufficient for rent|balance (is )?too low/i.test(t)) return 'lowSol';
  if (/blockhash (not found|expired|has expired)|blockhashnotfound|block ?height exceeded|expired before|signature has expired|transaction expired|waited too long/i.test(t)) return 'aged';
  if (/did not answer.{0,30}in time|timed? ?out|timeout|too many requests|\b429\b|\b503\b|rate.?limit|node is (behind|unhealthy)|overloaded|congest|try again later/i.test(t)) return 'networkBusy';
  if (/\bpaused\b/i.test(t)) return 'paused';
  if (/closed|cancel|reject|declin|refus|denied|4001/i.test(t)) return 'declined';
  return null;
}

/** The engine refused the picture itself: another try with the same picture ends the same way. */
export function pictureRefused(failure: LaunchFailure): boolean {
  return failure.stage === 'before' && (failure.code === 'LAUNCH_IMAGE_REFUSED' || failure.code === 'LAUNCH_IMAGE_INVALID');
}

/** The moderation categories the engine named («The picture reads as sexual, violence/graphic; …»), in plain words. */
function pictureReads(message: string, w: W): string | null {
  const named = /reads as ([a-z/, -]+?);/i.exec(message)?.[1];
  if (!named) return null;
  const words: Record<string, string> = { sexual: w.readSexual, violence: w.readViolent, 'violence/graphic': w.readGraphic, 'self-harm': w.readSelfHarm, 'self-harm/intent': w.readSelfHarm, 'self-harm/instructions': w.readSelfHarm };
  const read = [...new Set(named.split(',').map((category) => words[category.trim()] ?? null).filter((word): word is string => word !== null))];
  return read.length ? w.readContent(read.join(', ')) : null;
}

/** The names the engine said a borrowed name or ticker reads as («The name or ticker reads as Tesla, Apple.»). */
function borrowedAs(message: string): string | null {
  const named = /reads as (.+?)\.?$/i.exec(message.trim())?.[1]?.trim();
  return named && named.length <= 60 && !/[/\\<>]/.test(named) ? named : null;
}

type Read = Readonly<{ kind: RefusalKind; what: string; money: RefusalMoney; action: RefusalAction }>;

/** The failure's kind, sentence, money and action, from its code first and its text only where the code is shared. */
function read(failure: LaunchFailure, wallet: string | null, w: W): Read {
  const message = failure.message.trim();
  const sent = failure.stage === 'send';
  const who = wallet ?? w.theWallet;
  /* Refused before the chain: nothing was sent. Refused by the chain after the send: the creation is paid for by
     Ryntra's pool payer, and a refused transaction moves nothing of the creator's — nothing left the wallet. */
  const none: RefusalMoney = sent ? 'nothingLeft' : 'nothingSent';
  const by = (kind: RefusalKind, what: string, action: RefusalAction, money: RefusalMoney = none): Read => ({ kind, what, money, action });
  switch (failure.code) {
    case CITY_CLOSED:
      return by('closed', w.closed, 'close');
    case WALLET_REFUSED: {
      const cause = causeOf(message);
      if (cause === 'lowSol') return by('lowSol', w.lowSol, 'topUp');
      if (cause === 'declined' || !message) return by('declined', w.declined(who), 'retry');
      return by('walletFailed', w.walletFailed(who), 'retry');
    }
    case BUILD_AGED:
      return by('aged', w.aged, 'retry');
    case BUILD_UNEXPECTED:
      return by('unexpected', w.unexpected, 'retry', 'nothingSigned');
    case 'LAUNCH_NAME_BORROWED': {
      const label = borrowedAs(message);
      return by('ticker', label ? w.borrowedAs(label) : w.borrowed, 'edit');
    }
    case 'VALIDATION_ERROR':
      return by('invalid', w.invalid, 'edit');
    case 'LAUNCH_IMAGE_INVALID':
      return by('picture', /by the check/i.test(message) ? w.imageUnreadable : w.imageInvalid, 'picture', 'nothingStored');
    case 'LAUNCH_IMAGE_REFUSED': {
      if (/took this picture down/i.test(message)) return by('picture', w.imageTakenDown, 'picture', 'nothingStored');
      const reads = pictureReads(message, w);
      return by('picture', reads ? w.imageReads(reads) : w.imageRefused, 'picture', 'nothingStored');
    }
    case 'LAUNCH_IMAGE_CHECK_UNAVAILABLE':
      return by('pictureUnchecked', w.imageUnchecked, 'retry', 'nothingStored');
    case 'LAUNCH_LIMIT':
      return by('limit', w.limit, 'close');
    case 'LAUNCH_PAUSED':
    case 'LAUNCH_QUOTE_PAUSED':
      return by('paused', w.paused, 'close');
    case 'LAUNCH_BUSY':
      return by('busyHour', w.busyHour, 'retry');
    case 'RATE_LIMITED':
      return by('rateLimited', w.rateLimited, 'retry');
    case 'LAUNCH_UNAVAILABLE':
      return by('unavailable', w.unavailable, 'close');
    case 'WALLET_MISMATCH':
      return by('mismatch', w.mismatch, 'retry');
    case 'LAUNCH_SIGNED_OTHER_BYTES':
      return by('otherBytes', w.otherBytes, 'retry');
    case 'LAUNCH_NOT_FOUND':
      /* The stored details or the build are gone: nothing went out; a new try stores and builds afresh. */
      return by('unknown', w.wrong, 'retry', 'nothingSent');
    case 'LAUNCH_BUILD_USED':
      /* Sent before, by this very build: the chain may hold it — never a second send. */
      return sent ? by('used', w.used, 'close', 'landing') : by('aged', w.aged, 'retry');
    case 'LAUNCH_SUBMIT_FAILED': {
      const cause = causeOf(message);
      if (cause === 'ryntraNotSigned') return by('ryntraNotSigned', w.ryntraNotSigned, 'retry', 'nothingSent');
      if (cause === 'lowSol') return by('lowSol', w.lowSol, 'topUp');
      if (cause === 'aged') return by('aged', w.aged, 'retry');
      if (cause === 'networkBusy') return by('networkBusy', w.networkBusy, 'retry');
      return by('chainRefused', w.chainRefused, 'retry');
    }
    case 'UNAVAILABLE': {
      /* No answer to a send: the creation may have gone out — it is never sent twice from here. */
      if (sent) return by('noAnswer', w.noAnswer, 'close', 'maybeLanded');
      const cause = causeOf(message);
      if (cause === 'ryntraNotSigned') return by('ryntraNotSigned', w.ryntraNotSigned, 'retry');
      if (cause === 'paused') return by('paused', w.paused, 'close');
      if (cause === 'networkBusy') return by('networkBusy', w.networkBusy, 'retry');
      if (cause === 'lowSol') return by('lowSol', w.lowSol, 'topUp');
      return by('unreachable', w.unreachable, 'retry');
    }
    default:
      return sent ? by('noAnswer', w.noAnswer, 'close', 'maybeLanded') : by('unknown', w.wrong, 'retry');
  }
}

const ACTS: Record<RefusalAction, (w: W) => string> = {
  retry: (w) => w.actRetry,
  topUp: (w) => w.actTopUp,
  picture: (w) => w.actPicture,
  edit: (w) => w.actEdit,
  close: (w) => w.actClose,
};

const BASE58_RUN = /[1-9A-HJ-NP-Za-km-z]{32,88}/g;

/** The engine's words for support: no addresses, signatures, links or paths, one short line. */
export function supportText(message: string): string {
  return message
    .replace(/https?:\/\/\S+/gi, '')
    .replace(/(^|\s)\/[\w./-]+/g, '$1')
    .replace(BASE58_RUN, '…')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 200);
}

/** A failure in the city's words, in the language on screen: one sentence, the money, one action, and «Details». */
export function readRefusal(failure: LaunchFailure, wallet: string | null = null, at: Date | null = null): Refusal {
  const w = wordsNow(REFUSAL_WORDS);
  const r = read(failure, wallet, w);
  const said = supportText(failure.message);
  const details = [
    { label: w.detailCode, value: `${failure.code} · ${failure.stage === 'send' ? w.stageSend : w.stageBefore}` },
    ...(at ? [{ label: w.detailWhen, value: at.toISOString().replace('T', ' ').slice(0, 19) + ' UTC' }] : []),
    ...(said ? [{ label: w.detailSaid, value: said }] : []),
  ];
  return { kind: r.kind, what: r.what, money: w[r.money], moneyKind: r.money, action: r.action, act: ACTS[r.action](w), details };
}

/** The same in one line — for the form's line under the fields, where the refusal of a picture or a name shows at once. */
export function failureWords(failure: LaunchFailure, wallet: string | null = null): string {
  const refusal = readRefusal(failure, wallet);
  return `${refusal.what} ${refusal.money}`;
}
