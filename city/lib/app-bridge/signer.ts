import type { ConnectResult, SignManyResult, SignResult, WalletConnection } from '../../../lib/solana/wallet.client.ts';
import type { SignInInput, SignInResult } from '../../../lib/solana/wallet-signin.client.ts';
import type { AppBridge, BridgeAnswer } from './client.ts';
import { base64ToBytes, bytesToBase64, MAX_TRANSACTIONS, type ErrorCode } from './protocol.ts';

/**
 * The external signer: the city's wallet when the city is open in the Ryntra app. It answers in the very shapes the
 * browser's Wallet Standard functions answer (`lib/solana/wallet.client.ts`, `wallet-signin.client.ts`), so every
 * caller in the city stays as it is; only the hands change. The app's wallet signs the exact bytes the engine built —
 * a transaction, or the sign-in text the server wrote — and gives them back; nothing is sent from here.
 */

export type ExternalSigner = Readonly<{
  connect: () => Promise<ConnectResult>;
  disconnect: () => Promise<void>;
  signTransaction: (args: Readonly<{ address: string; unsignedWireBase64: string }>) => Promise<SignResult>;
  signTransactions: (args: Readonly<{ address: string; unsignedWireBase64: readonly string[] }>) => Promise<SignManyResult>;
  signIn: (input: SignInInput, messageText: string) => Promise<SignInResult>;
}>;

/** The chain the app's wallet signs for: Ryntra City trades on mainnet only. */
const APP_CHAINS = ['solana:mainnet'] as const;

export const SIGNER_LINES = {
  declined: 'Nothing was signed.',
  busy: 'Your wallet is still answering another request. Finish it there, then try again.',
  unsupported: 'This version of the Ryntra app cannot do that yet. Update the app.',
  failed: 'The wallet did not answer. Nothing was signed; try again.',
  changed: 'The wallet in the app changed. Reconnect and try again.',
} as const;

function line(code: ErrorCode, message: string): string {
  if (code === 'declined') return SIGNER_LINES.declined;
  if (code === 'busy') return SIGNER_LINES.busy;
  if (code === 'unsupported') return SIGNER_LINES.unsupported;
  return message || SIGNER_LINES.failed;
}

type Refused = Extract<BridgeAnswer<unknown>, { ok: false }>;

function connectState(answer: Refused): Extract<ConnectResult, { ok: false }>['state'] {
  // The person closing the wallet is an answer: said quietly, never as an error.
  if (answer.code === 'declined') return 'CANCELLED';
  if (answer.code === 'busy') return 'PENDING';
  if (answer.code === 'unsupported') return 'UNSUPPORTED';
  return 'FAILED';
}

function signInState(answer: Refused): Extract<SignInResult, { ok: false }>['state'] {
  if (answer.code === 'declined') return 'CANCELLED';
  if (answer.code === 'busy') return 'PENDING';
  if (answer.code === 'unsupported') return 'UNSUPPORTED';
  return 'FAILED';
}

/** A Mobile Wallet Adapter wallet may answer with the signature appended to the text: the text alone is what was signed. */
function signedText(message: Uint8Array, signedMessage: Uint8Array, signature: Uint8Array): Uint8Array {
  if (signedMessage.length !== message.length + signature.length) return signedMessage;
  for (let i = 0; i < message.length; i++) if (signedMessage[i] !== message[i]) return signedMessage;
  for (let i = 0; i < signature.length; i++) if (signedMessage[message.length + i] !== signature[i]) return signedMessage;
  return message;
}

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  return a.length === b.length && a.every((byte, i) => byte === b[i]);
}

export function externalSigner(bridge: AppBridge): ExternalSigner {
  /** The app's wallet must still be the one the page asks for: a switch in the app never signs for the old one. */
  const holds = (address: string) => bridge.wallet()?.address === address;

  const signTransactions: ExternalSigner['signTransactions'] = async ({ address, unsignedWireBase64 }) => {
    // The app takes four at a time (CITY-213): a plan of more is signed in two windows, and nothing is sent before the last.
    const signed: string[] = [];
    let at = 0;
    do {
      if (!holds(address)) return { ok: false, reason: SIGNER_LINES.changed };
      const answer = await bridge.request('wallet.signTransactions', { transactions: unsignedWireBase64.slice(at, at + MAX_TRANSACTIONS) });
      if (!answer.ok) return { ok: false, reason: line(answer.code, answer.message) };
      signed.push(...answer.result.signed);
      at += MAX_TRANSACTIONS;
    } while (at < unsignedWireBase64.length);
    if (!holds(address)) return { ok: false, reason: SIGNER_LINES.changed };
    return { ok: true, signedWireBase64: signed };
  };

  return {
    connect: async () => {
      const answer = await bridge.request('wallet.connect', {});
      if (!answer.ok) return { ok: false, state: connectState(answer), reason: answer.code === 'declined' ? '' : line(answer.code, answer.message) };
      const connection: WalletConnection = { wallet: answer.result.name, address: answer.result.address, chains: APP_CHAINS };
      return { ok: true, connection };
    },
    disconnect: async () => {
      await bridge.request('wallet.disconnect', {});
    },
    signTransactions,
    signTransaction: async ({ address, unsignedWireBase64 }) => {
      const many = await signTransactions({ address, unsignedWireBase64: [unsignedWireBase64] });
      return many.ok ? { ok: true, signedWireBase64: many.signedWireBase64[0]! } : many;
    },
    signIn: async (input, messageText) => {
      if (!holds(input.address)) return { ok: false, state: 'FAILED', reason: SIGNER_LINES.changed };
      // The exact bytes of the server's text; the wallet signs them and nothing else.
      const message = new TextEncoder().encode(messageText);
      const answer = await bridge.request('wallet.signMessage', { message: bytesToBase64(message) });
      if (!answer.ok) return { ok: false, state: signInState(answer), reason: line(answer.code, answer.message) };
      if (!holds(input.address)) return { ok: false, state: 'FAILED', reason: SIGNER_LINES.changed };
      const signature = base64ToBytes(answer.result.signature);
      if (signature.length !== 64) return { ok: false, state: 'FAILED', reason: SIGNER_LINES.failed };
      const signedMessage = signedText(message, base64ToBytes(answer.result.signedMessage), signature);
      // What comes back must be the server's text itself; anything else is not this sign-in.
      if (!sameBytes(signedMessage, message)) return { ok: false, state: 'FAILED', reason: SIGNER_LINES.failed };
      return { ok: true, address: input.address, signedMessage, signature, via: 'signMessage' };
    },
  };
}
