import { createHash } from "node:crypto";

const CONTROL = /[\u0000-\u001f\u007f]/;

/**
 * Opaque, stable namespace for browser-local Home state.
 *
 * The source fields never reach the client. The digest is a partition key,
 * not an authentication token, and grants no server access.
 */
export function homeLocalOwnerRef(input: Readonly<{ proofCode: string; createdAt: string }>): string {
  const proofCode = input.proofCode.trim();
  if (
    !proofCode ||
    proofCode.length > 128 ||
    CONTROL.test(proofCode) ||
    !Number.isFinite(Date.parse(input.createdAt))
  ) {
    throw new Error("invalid Home owner scope");
  }
  const digest = createHash("sha256")
    .update("ryntra-home-owner-v1\0", "utf8")
    .update(proofCode, "utf8")
    .update("\0", "utf8")
    .update(input.createdAt, "utf8")
    .digest("hex")
    .slice(0, 32);
  return `owner_${digest}`;
}
