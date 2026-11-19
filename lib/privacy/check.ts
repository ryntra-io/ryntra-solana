/**
 * The wallet check (owner's hands, devnet): what a wallet answers to the two things the private balance needs from it.
 * Pure rules over what the page collected; the page itself — `terminal/portfolio/private/WalletCheck.tsx`.
 *
 * 1. Which transaction versions `solana:signTransaction` declares — the private balance's transactions are version 1.
 * 2. The derivation envelope `TSPP/derive/v1` (off-chain message v0): does `solana:signMessage` return the exact bytes
 *    it was given, is the signature valid, and are two signatures of the same envelope the same — otherwise keys made
 *    from it would differ every time.
 * 3. A version 1 transaction: does the wallet return it signed, with the message unchanged and a valid signature.
 */

export type Verdict = 'yes' | 'no' | 'unknown';

export type CheckReport = Readonly<{
  wallet: string;
  address: string | null;
  versions: readonly string[] | null;
  signMessage: boolean;
  envelope: Readonly<{ sameBytes: Verdict; valid: Verdict; repeatable: Verdict }>;
  v1: Readonly<{ signed: Verdict; messageKept: Verdict; valid: Verdict; landed: string | null }>;
}>;

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

/** May the private balance take its keys from this wallet's signature? Only when both envelope checks say yes. */
export function derivationFit(report: CheckReport): Verdict {
  const { sameBytes: kept, valid, repeatable } = report.envelope;
  if (kept === 'no' || valid === 'no' || repeatable === 'no') return 'no';
  if (kept === 'yes' && valid === 'yes' && repeatable === 'yes') return 'yes';
  return 'unknown';
}

/** The report as the plain text the owner copies — one fact a line, no secret in it (signatures are not kept). */
export function reportText(report: CheckReport, at: Date): string {
  const lines = [
    `Ryntra wallet check · devnet · ${at.toISOString()}`,
    `wallet: ${report.wallet}`,
    `account: ${report.address ?? '—'}`,
    `signTransaction versions: ${report.versions ? report.versions.join(', ') : 'not declared'}`,
    `signs v1: ${signsV1(report.versions)}`,
    `signMessage: ${report.signMessage ? 'yes' : 'no'}`,
    `envelope returned byte for byte: ${report.envelope.sameBytes}`,
    `envelope signature valid: ${report.envelope.valid}`,
    `two envelope signatures equal: ${report.envelope.repeatable}`,
    `keys from the wallet's signature: ${derivationFit(report)}`,
    `v1 signed: ${report.v1.signed}`,
    `v1 message unchanged: ${report.v1.messageKept}`,
    `v1 signature valid: ${report.v1.valid}`,
    `v1 landed on devnet: ${report.v1.landed ?? 'not sent'}`,
  ];
  return lines.join('\n');
}
