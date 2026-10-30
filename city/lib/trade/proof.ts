import { announceAccountChange, postWalletProof, settleWalletChange, walletAuthGeneration } from '../../../lib/account/wallet-auth.client.ts';
import { actActionFor, proofCanAct, revalidateWalletFact, setWalletFact, walletFact } from '../../../lib/account/wallet-proof-store.client.ts';
import { bytesToBase64, type SignInInput } from '../../../lib/solana/wallet-signin.client.ts';
import { citySigner } from '../app-bridge/route.ts';
import { wordsNow } from '../i18n/dict.ts';
import { LINE } from './words.ts';

/**
 * Proving the wallet to Ryntra with one signed message — Ryntra's own Sign In With Solana. The server writes the
 * message, the wallet signs that text and nothing else, the server checks it. No transaction, nothing that can move
 * value; the wallet's own screen says so. The proof is shared with every other page of Ryntra. In the Ryntra app the
 * app's wallet signs the same bytes through the bridge (`../app-bridge/route.ts`).
 */

export type ProofOutcome =
  | Readonly<{ ok: true }>
  /** The person closed the wallet or said no: an answer, not an error. */
  | Readonly<{ ok: false; state: 'declined'; message: string }>
  | Readonly<{ ok: false; state: 'failed'; message: string }>;

export async function proveWallet(
  connection: Readonly<{ wallet: string; address: string }>,
  /** `signIn`: a browser with no Ryntra account signs in with this wallet even if it holds a bare proof for it (the quarter needs an account). */
  options: Readonly<{ signIn?: boolean }> = {},
): Promise<ProofOutcome> {
  settleWalletChange();
  const generation = walletAuthGeneration();
  const fact = walletFact().status === 'known' ? walletFact() : await revalidateWalletFact();
  const signIn = options.signIn === true && !fact.signedIn;
  if (!signIn && proofCanAct(fact, connection.address)) return { ok: true };
  const action = signIn ? 'signin' : actActionFor(fact, connection.address);
  if (action === 'none') return { ok: true };
  try {
    const prepared = await fetch(`/api/auth/solana?address=${encodeURIComponent(connection.address)}&action=${action}&locale=en`);
    if (!prepared.ok) return { ok: false, state: 'failed', message: prepared.status === 429 ? wordsNow(LINE).tooManyAttempts : wordsNow(LINE).signInUnavailable };
    const { input, message } = (await prepared.json()) as { input: SignInInput; message: string };
    const signed = await citySigner.signIn(connection.wallet, input, message);
    if (!signed.ok) {
      if (signed.state === 'CANCELLED' || signed.state === 'REFUSED') return { ok: false, state: 'declined', message: wordsNow(LINE).nothingSigned };
      return { ok: false, state: 'failed', message: signed.reason || wordsNow(LINE).walletNoSign };
    }
    if (signed.address !== connection.address) return { ok: false, state: 'failed', message: wordsNow(LINE).walletChanged };
    const answer = await postWalletProof(
      { action, locale: 'en', address: signed.address, signedMessage: bytesToBase64(signed.signedMessage), signature: bytesToBase64(signed.signature) },
      generation,
    );
    if (!answer) return { ok: false, state: 'failed', message: wordsNow(LINE).walletChanged };
    const data = (await answer.json().catch(() => ({}))) as { ok?: boolean; expiresAt?: string };
    if (!answer.ok || !data.ok) {
      return { ok: false, state: 'failed', message: answer.status === 409 ? wordsNow(LINE).otherAccount : wordsNow(LINE).notVerified };
    }
    const before = walletFact();
    setWalletFact(
      action === 'signin'
        ? { signedIn: true, walletAddress: signed.address, provenAddress: signed.address, provenVia: 'signin', expiresAt: data.expiresAt ?? null }
        : { signedIn: before.signedIn, walletAddress: before.walletAddress, provenAddress: signed.address, provenVia: 'proof', expiresAt: data.expiresAt ?? null },
    );
    if (action === 'signin') announceAccountChange();
    return { ok: true };
  } catch {
    return { ok: false, state: 'failed', message: wordsNow(LINE).notCompleted };
  }
}
