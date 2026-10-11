import { readWalletProofFrom } from "../session.ts";

/**
 * The Solana wallet a request proved it signs for — its wallet sign-in (the web's cookie or the native bearer), read
 * once and only when asked: the holder's entry asks only while it is closed to people, to let an operator's own
 * wallet in without telling anyone else whose wallets those are. A store that did not answer proves nothing.
 */
export function provenWalletOf(request: Request): () => Promise<string | null> {
  let read: Promise<string | null> | null = null;
  return () =>
    (read ??= readWalletProofFrom(request.headers)
      .then((proof) => (proof.status === "ok" && proof.proof.chain === "solana" ? proof.proof.address : null))
      .catch(() => null));
}
