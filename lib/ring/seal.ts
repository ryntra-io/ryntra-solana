/**
 * An agent's OpenRouter key at rest (CITY-50): OpenRouter shows a key once, so the Ring keeps it — sealed. The store
 * holds only the sealed text; the seal's own secret lives in the server's environment by name, so a copy of the database alone opens nothing.
 *
 *   sealed = v1.<iv>.<ciphertext>.<tag>     AES-256-GCM, key = HKDF-SHA256(secret, "ryntra-ring", "agent-key:v1"),
 *                                           the agent's id as associated data — a sealed key opens for its agent only
 *
 * Opening is for the matches (CITY-51); nothing in CITY-50 reads a key back.
 */

import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";

export type Sealer = Readonly<{
  seal(agentId: string, secret: string): string;
  open(agentId: string, sealed: string): string | null;
}>;

const SEALED = /^v1\.([A-Za-z0-9_-]{16})\.([A-Za-z0-9_-]{8,1400})\.([A-Za-z0-9_-]{22})$/;

/** The sealer for a server secret of at least 32 printable characters; `null` without one. */
export function createSealer(serverSecret: string | null | undefined): Sealer | null {
  const secret = serverSecret?.trim();
  if (!secret || !/^[\x21-\x7e]{32,512}$/.test(secret)) return null;
  const key = Buffer.from(hkdfSync("sha256", secret, "ryntra-ring", "agent-key:v1", 32));
  return {
    seal(agentId, value) {
      const iv = randomBytes(12);
      const cipher = createCipheriv("aes-256-gcm", key, iv);
      cipher.setAAD(Buffer.from(agentId, "utf8"));
      const body = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
      return `v1.${iv.toString("base64url")}.${body.toString("base64url")}.${cipher.getAuthTag().toString("base64url")}`;
    },
    open(agentId, sealed) {
      const parts = SEALED.exec(sealed);
      if (!parts) return null;
      try {
        const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(parts[1]!, "base64url"));
        decipher.setAAD(Buffer.from(agentId, "utf8"));
        decipher.setAuthTag(Buffer.from(parts[3]!, "base64url"));
        return Buffer.concat([decipher.update(Buffer.from(parts[2]!, "base64url")), decipher.final()]).toString("utf8");
      } catch {
        return null;
      }
    },
  };
}
