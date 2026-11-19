/**
 * The person's connected wallet, as the private balance asks it: sign these exact transaction bytes for devnet, sign
 * these exact message bytes. Both go through the wallet modules Ryntra already uses (`lib/solana/wallet.client.ts`);
 * nothing here sends or keeps anything.
 */

import { registeredWallet, signTransaction } from '../solana/wallet.client.ts';
import type { PrivateSigner } from './flows.ts';
import { PRIVATE_CHAIN } from './network.ts';

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function fromBase64(text: string): Uint8Array {
  return Uint8Array.from(atob(text), (c) => c.charCodeAt(0));
}

/** The wallet as the private steps' signer. A refusal is thrown as the wallet worded it. */
export function walletSigner(wallet: string, address: string): PrivateSigner {
  return {
    address,
    async signWire(wire) {
      const result = await signTransaction({ wallet, address, unsignedWireBase64: toBase64(wire), chain: PRIVATE_CHAIN });
      if (!result.ok) throw new Error(result.reason);
      return fromBase64(result.signedWireBase64);
    },
  };
}

type SignMessageFeature = {
  signMessage?: (input: Readonly<{ account: unknown; message: Uint8Array }>) => Promise<readonly { signedMessage?: Uint8Array; signature: Uint8Array }[]>;
};

/** `signedMessage` is null when the wallet did not return the bytes it signed. */
export type SignedMessage = Readonly<{ signedMessage: Uint8Array | null; signature: Uint8Array }>;

/** `solana:signMessage` over raw bytes; null when the wallet has no such feature. */
export async function signMessageBytes(wallet: string, address: string, message: Uint8Array): Promise<SignedMessage | null> {
  const found = registeredWallet(wallet);
  const feature = found?.features['solana:signMessage'] as SignMessageFeature | undefined;
  if (!found || typeof feature?.signMessage !== 'function') return null;
  const account = found.accounts.find((a) => a.address === address);
  if (!account) throw new Error(`${wallet} no longer offers ${address}.`);
  const [output] = await feature.signMessage({ account, message: new Uint8Array(message) });
  if (!output) throw new Error(`${wallet} returned nothing.`);
  return { signedMessage: output.signedMessage ? new Uint8Array(output.signedMessage) : null, signature: new Uint8Array(output.signature) };
}

/** What the wallet declares for `solana:signTransaction` and whether it has `solana:signMessage` at all. */
export function walletFeatures(wallet: string): Readonly<{ signTransaction: unknown; signMessage: boolean }> {
  const found = registeredWallet(wallet);
  return {
    signTransaction: found?.features['solana:signTransaction'],
    signMessage: typeof (found?.features['solana:signMessage'] as SignMessageFeature | undefined)?.signMessage === 'function',
  };
}
