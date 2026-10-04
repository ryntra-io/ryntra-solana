/**
 * Digital Asset Links for the native Android client — pure.
 *
 * A wallet that receives a Mobile Wallet Adapter `authorize` from a native app
 * checks `https://<identity>/.well-known/assetlinks.json` for an `android_app`
 * statement naming the calling package and the SHA-256 fingerprint of the
 * certificate it is signed with; without one the wallet shows the app as
 * unverified at every connect (seen with the Solana Mobile fakewallet on
 * 2026-09-15). This module turns the deployment's configuration into that
 * statement list and nothing else.
 *
 * What is and is not here, on purpose:
 *
 * - The fingerprints are **public** facts about a certificate (what
 *   `keytool -list -v` prints), never the keystore or its password, which stay
 *   with the release signer and are never asked for. The Android build supplies
 *   the package name and the fingerprints; the deployment's environment sets them.
 * - **Production trusts the release certificate only.** A debug certificate
 *   enters the list only from its own variable, meant for a preview
 *   deployment; a production deployment that happens to carry it is refused
 *   by the build of the statement, not by a convention someone must remember.
 * - Nothing configured means an **empty** statement list — valid JSON that
 *   grants no trust — never a placeholder fingerprint.
 */

export const ASSETLINKS_ENV = {
  package: "RYNTRA_ANDROID_PACKAGE",
  /** Comma or whitespace separated SHA-256 fingerprints of the release signing certificate(s). */
  release: "RYNTRA_ANDROID_RELEASE_CERT_SHA256",
  /** The developer's debug certificate; honoured only when the deployment is not production. */
  debug: "RYNTRA_ANDROID_DEBUG_CERT_SHA256",
} as const;

export const ASSETLINKS_RELATIONS = ["delegate_permission/common.handle_all_urls", "delegate_permission/common.get_login_creds"] as const;

const PACKAGE = /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/;
const FINGERPRINT = /^([0-9A-F]{2}:){31}[0-9A-F]{2}$/;

export type AssetLinkStatement = Readonly<{
  relation: readonly string[];
  target: Readonly<{ namespace: "android_app"; package_name: string; sha256_cert_fingerprints: readonly string[] }>;
}>;

/** Fingerprints as they were written, normalised to upper-case colon-separated hex; anything else is dropped, never guessed. */
export function parseFingerprints(value: string | undefined): readonly string[] {
  if (!value) return [];
  const seen = new Set<string>();
  for (const raw of value.split(/[\s,]+/)) {
    const candidate = raw.trim().toUpperCase().replace(/^SHA-?256:?/i, "");
    const formatted = /^[0-9A-F]{64}$/.test(candidate) ? candidate.match(/.{2}/g)!.join(":") : candidate;
    if (FINGERPRINT.test(formatted)) seen.add(formatted);
  }
  return [...seen];
}

export function buildAssetLinks(env: Readonly<Record<string, string | undefined>>, isProduction: boolean): readonly AssetLinkStatement[] {
  const packageName = env[ASSETLINKS_ENV.package]?.trim() ?? "";
  if (!PACKAGE.test(packageName)) return [];
  const release = parseFingerprints(env[ASSETLINKS_ENV.release]);
  const debug = isProduction ? [] : parseFingerprints(env[ASSETLINKS_ENV.debug]);
  const fingerprints = [...new Set([...release, ...debug])];
  if (fingerprints.length === 0) return [];
  return [{ relation: [...ASSETLINKS_RELATIONS], target: { namespace: "android_app", package_name: packageName, sha256_cert_fingerprints: fingerprints } }];
}
