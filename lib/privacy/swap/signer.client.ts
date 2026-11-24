/**
 * The wallet as a private swap asks it: one transaction, or the pack's three in one approval — Wallet Standard's
 * `solana:signTransaction` takes several at once and the wallet shows them together (`lib/solana/wallet.client.ts`,
 * `signTransactions`). Nothing here sends, keeps or logs anything.
 */

import { signTransactions } from '../../solana/wallet.client.ts';
import { walletSigner } from '../wallet.client.ts';
import { PRIVATE_CHAIN } from '../network.ts';
import type { SwapSigner } from './run.ts';

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function fromBase64(text: string): Uint8Array {
  return Uint8Array.from(atob(text), (c) => c.charCodeAt(0));
}

/** The connected wallet, signing one transaction or several in one approval. A refusal is thrown as the wallet worded it. */
export function swapSigner(wallet: string, address: string, chain: string = PRIVATE_CHAIN): SwapSigner {
  return {
    ...walletSigner(wallet, address),
    async signWires(wires) {
      const result = await signTransactions({ wallet, address, unsignedWireBase64: wires.map(toBase64), chain });
      if (!result.ok) throw new Error(result.reason);
      return result.signedWireBase64.map(fromBase64);
    },
  };
}
