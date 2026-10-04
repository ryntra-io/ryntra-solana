/**
 * The tokens of a provider session at rest.
 *
 * The aggregator's access and refresh tokens are held by the server, never
 * by the browser. At rest they are sealed with AES-256-GCM under a key
 * derived once from the deployment's session secret (`BETA_TOKEN_SECRET`,
 * the same root every Ryntra session cookie is signed with) through HKDF
 * with a purpose label of its own — so the Guard store's rows carry
 * ciphertext, a database read alone yields no token, and a deployment
 * without a session secret cannot link at all (`LINK_UNAVAILABLE`) rather
 * than storing a token in the clear.
 *
 * The sealed form is `v1.<iv>.<ciphertext>.<tag>` in base64url. Nothing here
 * logs a token or a key.
 */

import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";

const VERSION = "v1";
const INFO = "ryntra-predictions-vault-v1";

let derived: { secret: string; key: Buffer } | null = null;

function key(secret: string): Buffer {
  if (derived && derived.secret === secret) return derived.key;
  const raw = Buffer.from(hkdfSync("sha256", secret, "ryntra", INFO, 32));
  derived = { secret, key: raw };
  return raw;
}

export function vaultAvailable(env: NodeJS.ProcessEnv = process.env): boolean {
  return typeof env.BETA_TOKEN_SECRET === "string" && env.BETA_TOKEN_SECRET.length >= 8;
}

export function seal(plain: string, env: NodeJS.ProcessEnv = process.env): string {
  const secret = env.BETA_TOKEN_SECRET;
  if (!secret || secret.length < 8) throw new Error("vault: no session secret");
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(secret), iv);
  const body = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [VERSION, iv.toString("base64url"), body.toString("base64url"), tag.toString("base64url")].join(".");
}

export function open(sealed: string, env: NodeJS.ProcessEnv = process.env): string | null {
  const secret = env.BETA_TOKEN_SECRET;
  if (!secret || secret.length < 8) return null;
  const parts = sealed.split(".");
  if (parts.length !== 4 || parts[0] !== VERSION) return null;
  try {
    const decipher = createDecipheriv("aes-256-gcm", key(secret), Buffer.from(parts[1], "base64url"));
    decipher.setAuthTag(Buffer.from(parts[3], "base64url"));
    return Buffer.concat([decipher.update(Buffer.from(parts[2], "base64url")), decipher.final()]).toString("utf8");
  } catch {
    /* A row sealed under another secret, or a damaged one, is no session. */
    return null;
  }
}
