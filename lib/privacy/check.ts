/**
 * The private balance's keys come from the person's wallet only. Pure rules, the same for the Portfolio block
 * and the wallet check (`/private/check`, owner's hands, on the private balance's network):
 *
 * 1. The key request — the SDK's off-chain message `TSPP/derive/v1` over the wallet's own address. The wallet's
 *    signature over it is the seed of the viewing and nullifier keys: the same wallet gives the same keys on any device,
 *    so nothing has to be kept. A wallet fits only when it signs the exact bytes it was given, the signature is valid,
 *    and two signatures of the same request are the same — otherwise keys made from it would differ every time.
 * 2. The ring's registry holds one record per address and its nullifier key never changes. Before anything is written
 *    the record is read and compared with the keys the wallet gave: the same — this balance opens here; other keys
 *    (another app, such as Solflare Private Mode, or older keys) — nothing is written.
 * 3. A version 1 transaction: does the wallet return it signed, with the message unchanged and a valid signature.
 *
 * Nothing here signs, keeps or prints a secret: functions take bytes and verdicts and give verdicts back.
 */

import { DERIVE_FROM_WALLET, PRIVATE_NET, type PrivateNetwork } from './network.ts';

export type Verdict = 'yes' | 'no' | 'unknown';

export function sameBytes(a: Uint8Array | null | undefined, b: Uint8Array | null | undefined): Verdict {
  if (!a || !b) return 'unknown';
  return a.length === b.length && a.every((x, i) => x === b[i]) ? 'yes' : 'no';
}

/** `supportedTransactionVersions` as the wallet declares it: 'legacy', 0, 1 → strings; null when it says nothing. */
export function declaredVersions(feature: unknown): readonly string[] | null {
  const list = (feature as { supportedTransactionVersions?: unknown } | undefined)?.supportedTransactionVersions;
  if (!Array.isArray(list)) return null;
  return list.map((v) => String(v));
}

export function signsV1(versions: readonly string[] | null): Verdict {
  if (versions === null) return 'unknown';
  return versions.includes('1') ? 'yes' : 'no';
}

/* ---------------- 1. the key request ---------------- */

/* eslint-disable @typescript-eslint/no-explicit-any -- the SDK bundle is loaded at run time and typed here by use. */
type Sdk = any;
type Keys = any;
/* eslint-enable @typescript-eslint/no-explicit-any */

/** The exact bytes the wallet is asked to sign: the SDK's derivation message over the owner's address. */
export function keysRequest(sdk: Sdk, owner: string): Uint8Array {
  return new Uint8Array(sdk.ed25519DerivationMessage(sdk.getAddressEncoder().encode(owner)));
}

/** What the wallet gave for the request; `signedMessage` is null when it did not return the bytes it signed. */
export type KeysAnswer = Readonly<{ signedMessage: Uint8Array | null; signature: Uint8Array }>;

export type KeysFrom = Readonly<{ ok: true; keys: Keys }> | Readonly<{ ok: false; why: 'changed' }>;

/**
 * The private balance's keys from one answer to the key request. The SDK checks the signature against the request and
 * the owner itself (`TRANSACTION_INVALID_DERIVATION_SEED` otherwise); a wallet that returned other bytes, or signed
 * something else, «changed» the request. The caller zeroes the signature after this.
 */
export function keysFromAnswer(sdk: Sdk, proofService: unknown, owner: string, request: Uint8Array, answer: KeysAnswer): KeysFrom {
  if (answer.signedMessage && sameBytes(answer.signedMessage, request) !== 'yes') return { ok: false, why: 'changed' };
  const seed = new Uint8Array(answer.signature);
  try {
    return { ok: true, keys: sdk.LocalKeys.fromDerivationSeed({ solanaPublicKey: owner, derivationSeed: seed }, proofService) };
  } catch (error) {
    const code = String((error as { code?: unknown } | null)?.code ?? '');
    if (code.includes('DERIVATION_SEED')) return { ok: false, why: 'changed' };
    throw error;
  } finally {
    seed.fill(0);
  }
}

/** Why a wallet cannot give the keys: no message signing, a changed request, two different signatures. */
export type KeysCannot = 'no-sign' | 'changed' | 'differs';

/** One word for a wallet's answers to the key request; null — fits, or not known yet. */
export function keysCannot(facts: Readonly<{ signMessage: boolean; sameBytes: Verdict; valid: Verdict; repeatable: Verdict }>): KeysCannot | null {
  if (!facts.signMessage) return 'no-sign';
  if (facts.sameBytes === 'no' || facts.valid === 'no') return 'changed';
  if (facts.repeatable === 'no') return 'differs';
  return null;
}

/** The wallets the owner's check showed give the keys — named to a person whose wallet cannot (`network.ts`). */
export function walletsThatCan(list: readonly string[] = DERIVE_FROM_WALLET): readonly string[] {
  return [...new Set(list.map((name) => name.trim()).filter(Boolean))];
}

/* ---------------- 2. the ring's registry ---------------- */

/** The two public keys a registry record holds; each as bytes, or as the SDK's key object (`toBytes()`). */
export type RecordKeys = Readonly<{ nullifierPublicKey: unknown; viewingPublicKey: unknown }>;

export type Registration = 'none' | 'mine' | 'other';

function bytesOf(value: unknown): Uint8Array | null {
  if (value instanceof Uint8Array) return value;
  const toBytes = (value as { toBytes?: unknown } | null)?.toBytes;
  if (typeof toBytes === 'function') {
    const out = (toBytes as () => unknown).call(value);
    return out instanceof Uint8Array ? out : null;
  }
  return null;
}

/** The public half of a set of keys, as the registry compares it: nullifier and viewing public keys. */
export function publicOf(keys: Keys): RecordKeys {
  const address = keys.address();
  return { nullifierPublicKey: bytesOf(address.nullifierPublicKey), viewingPublicKey: bytesOf(address.viewingPublicKey) };
}

/**
 * Is this address registered, and with these keys? No record — 'none'; both public keys equal, byte for byte — 'mine';
 * anything else, a key missing included — 'other', and then nothing may be written for this address.
 */
export function recordVerdict(record: RecordKeys | null | undefined, mine: RecordKeys): Registration {
  if (!record) return 'none';
  const pairs = [
    [bytesOf(record.nullifierPublicKey), bytesOf(mine.nullifierPublicKey)],
    [bytesOf(record.viewingPublicKey), bytesOf(mine.viewingPublicKey)],
  ] as const;
  return pairs.every(([a, b]) => a && b && a.length > 0 && sameBytes(a, b) === 'yes') ? 'mine' : 'other';
}

/* ---------------- the block's state ---------------- */

export type PrivatePhase =
  | 'shut' // the flag is closed
  | 'none' // no wallet of the person's own
  | 'loading'
  | 'off' // the address is not registered: «Turn on» takes the keys from the wallet
  | 'locked' // registered; the wallet's keys are not in this tab yet: «Open», one signature
  | 'cannot' // this wallet does not give the keys
  | 'elsewhere' // registered with other keys: nothing is written here
  | 'ready'
  | 'failed';

/** Where the open balance's keys come from: the wallet's signature (memory only) or an older sealed copy. */
export type KeysFromWhere = 'wallet' | 'copy';

export type PhaseFacts = Readonly<{
  open: boolean;
  owner: string | null;
  /** The registry record: being read, unreadable, absent or present. */
  record: 'reading' | 'failed' | 'none' | 'some';
  /** The verdict for keys this tab holds from the wallet; null — none held. */
  inTab: Registration | null;
  /** The verdict for older keys sealed in this browser; null — none. */
  sealed: Registration | null;
  /** The wallet's last answer to the key request said it cannot. */
  cannot: KeysCannot | null;
}>;

/** The block's state from what is known, and where the keys of an open balance come from. */
export function phaseOf(facts: PhaseFacts): Readonly<{ phase: PrivatePhase; keys: KeysFromWhere | null }> {
  const at = (phase: PrivatePhase, keys: KeysFromWhere | null = null) => ({ phase, keys });
  if (!facts.open) return at('shut');
  if (!facts.owner) return at('none');
  if (facts.record === 'reading') return at('loading');
  if (facts.record === 'failed') return at('failed');
  if (facts.record === 'none') return at(facts.cannot ? 'cannot' : 'off');
  if (facts.inTab === 'mine') return at('ready', 'wallet');
  if (facts.sealed === 'mine') return at('ready', 'copy');
  if (facts.inTab === 'other') return at('elsewhere');
  if (facts.cannot) return at('cannot');
  return at('locked');
}

/* ---------------- the wallet check's report ---------------- */

export type CheckReport = Readonly<{
  wallet: string;
  address: string | null;
  device: 'phone' | 'desktop';
  versions: readonly string[] | null;
  signMessage: boolean;
  /** The key request, asked twice. `refused` — what the wallet said when it did not sign. */
  keys: Readonly<{ sameBytes: Verdict; valid: Verdict; repeatable: Verdict; refused: string | null }>;
  v1: Readonly<{ signed: Verdict; messageKept: Verdict; valid: Verdict; landed: string | null; refused: string | null }>;
  /**
   * The registry record for this address against the wallet's keys; 'unread' — not checked yet; 'locked' — a record is
   * there, and the wallet gave no keys to compare it with.
   */
  registry: Registration | 'unread' | 'failed' | 'locked';
}>;

/** A phone or a computer, from the browser's own words — for the owner's matrix only. */
export function deviceOf(userAgent: string): 'phone' | 'desktop' {
  return /Mobi|Android|iPhone|iPad|Seeker|Saga/i.test(userAgent) ? 'phone' : 'desktop';
}

export type CheckLine = 'yes' | 'no' | 'refused' | 'unasked';

/** Check 1: does the wallet give the private balance's keys? */
export function keysLine(report: CheckReport): Readonly<{ line: CheckLine; why: KeysCannot | null }> {
  const why = keysCannot({ signMessage: report.signMessage, ...report.keys });
  if (why) return { line: 'no', why };
  if (report.keys.refused) return { line: 'refused', why: null };
  const { sameBytes: kept, valid, repeatable } = report.keys;
  if (kept !== 'no' && valid === 'yes' && repeatable === 'yes') return { line: 'yes', why: null };
  return { line: 'unasked', why: null };
}

/** Check 2: does the wallet sign the private balance's version 1 transactions? */
export function v1Line(report: CheckReport): Readonly<{ line: CheckLine; why: 'not-declared' | 'changed' | null }> {
  if (report.v1.refused) return { line: 'refused', why: signsV1(report.versions) === 'no' ? 'not-declared' : null };
  if (report.v1.signed === 'unknown') return { line: 'unasked', why: signsV1(report.versions) === 'no' ? 'not-declared' : null };
  if (report.v1.signed === 'yes' && report.v1.messageKept === 'yes' && report.v1.valid === 'yes') return { line: 'yes', why: null };
  return { line: 'no', why: 'changed' };
}

/** May the private balance take its keys from this wallet's signature? Only when every key-request check says yes. */
export function derivationFit(report: CheckReport): Verdict {
  const { line } = keysLine(report);
  return line === 'yes' ? 'yes' : line === 'no' ? 'no' : 'unknown';
}

const REGISTRY_TEXT: Record<CheckReport['registry'], string> = {
  unread: 'not checked',
  failed: 'could not read the registry',
  none: 'not turned on for this address yet',
  mine: 'turned on with the keys this wallet gives — Ryntra opens it',
  other: 'turned on with other keys (another app or older keys) — Ryntra writes nothing',
  locked: 'turned on; the wallet gave no keys to compare — Ryntra writes nothing',
};

/** The network as the report names it, and what its last line says when no v1 transaction was sent there. */
const REPORT_NETWORK: Record<PrivateNetwork, Readonly<{ name: string; where: string; notSent: string }>> = {
  devnet: { name: 'test network', where: 'the test network', notSent: 'not sent' },
  // The check sends nothing on mainnet (`WalletCheckScreen.tsx`): the line says so rather than wait for a landing.
  mainnet: { name: 'mainnet', where: 'mainnet', notSent: 'not sent — the check sends nothing on mainnet' },
};

/**
 * The report as the plain text the owner copies and forwards to the lead: three result lines first, then the facts —
 * one a line, no secret in it (signatures are compared and dropped, never kept). The network is the private balance's
 * own (`PRIVATE_NET`): a report copied on mainnet never says «test network».
 */
export function reportText(report: CheckReport, at: Date, network: PrivateNetwork = PRIVATE_NET): string {
  const net = REPORT_NETWORK[network];
  const keys = keysLine(report);
  const v1 = v1Line(report);
  const keysText = {
    yes: 'yes — same bytes, valid, the same signature twice',
    no: { 'no-sign': 'no — the wallet does not sign messages', changed: 'no — the wallet changed the request', differs: 'no — two signatures differ' }[keys.why ?? 'no-sign'],
    refused: `refused — ${report.keys.refused ?? ''}`.trim(),
    unasked: 'not checked',
  }[keys.line];
  const v1Text = {
    yes: 'yes — signed, message unchanged, valid',
    no: 'no — the wallet changed the transaction',
    refused: `refused — ${report.v1.refused ?? ''}`.trim(),
    unasked: v1.why === 'not-declared' ? 'not checked (version 1 not declared)' : 'not checked',
  }[v1.line];
  const lines = [
    `Ryntra wallet check · ${net.name} · ${at.toISOString()}`,
    `wallet: ${report.wallet} · ${report.device}`,
    `account: ${report.address ?? '—'}`,
    '',
    `1. key request: ${keysText}`,
    `2. v1 transaction: ${v1Text}`,
    `3. already registered: ${REGISTRY_TEXT[report.registry]}`,
    '',
    `signTransaction versions: ${report.versions ? report.versions.join(', ') : 'not declared'}`,
    `signs v1: ${signsV1(report.versions)}`,
    `signMessage: ${report.signMessage ? 'yes' : 'no'}`,
    `key request returned byte for byte: ${report.keys.sameBytes}`,
    `key request signature valid: ${report.keys.valid}`,
    `two key request signatures equal: ${report.keys.repeatable}`,
    `keys from the wallet's signature: ${derivationFit(report)}`,
    `v1 signed: ${report.v1.signed}`,
    `v1 message unchanged: ${report.v1.messageKept}`,
    `v1 signature valid: ${report.v1.valid}`,
    `v1 landed on ${net.where}: ${report.v1.landed ?? net.notSent}`,
  ];
  return lines.join('\n');
}
