import { bytesToBase64, type SignInInput } from '../../../../lib/solana/wallet-signin.client.ts';
import { citySigner } from '../../app-bridge/route.ts';

/**
 * The managed account's sign-in: AGG issues its own nonce and the engine writes the message; the wallet signs that text
 * verbatim, and nothing else — no transaction, nothing that can move value. It goes through the city's one door to a
 * wallet (`../../app-bridge/route.ts`): the browser's wallet signs the text with `signMessage`, the Ryntra app's wallet
 * the same bytes. A wallet that could only rebuild a sign-in of its own is refused here: what it signed is not the text.
 */
export type Signed = Readonly<{ ok: true; signature: string }> | Readonly<{ ok: false; declined: boolean; message: string }>;

const same = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((v, i) => v === b[i]);

export async function signText(wallet: string, address: string, text: string): Promise<Signed> {
  // The text is the whole sign-in: the signer reads only the address of the input, and signs the text it is given.
  const input = { address } as SignInInput;
  const signed = await citySigner.signIn(wallet, input, text);
  if (!signed.ok) {
    const declined = signed.state === 'CANCELLED' || signed.state === 'REFUSED';
    return { ok: false, declined, message: declined ? 'Nothing was signed.' : signed.state === 'UNSUPPORTED' ? 'This wallet cannot sign in here.' : 'The wallet did not sign.' };
  }
  if (signed.address !== address) return { ok: false, declined: false, message: 'The wallet changed. Try again.' };
  if (signed.via !== 'signMessage' || !same(signed.signedMessage, new TextEncoder().encode(text))) return { ok: false, declined: false, message: 'This wallet cannot sign in here.' };
  return { ok: true, signature: bytesToBase64(signed.signature) };
}
