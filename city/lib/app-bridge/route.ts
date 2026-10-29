import { signTransaction, signTransactions, type SignManyResult, type SignResult } from '../../../lib/solana/wallet.client.ts';
import { signInWithWallet, type SignInInput, type SignInResult } from '../../../lib/solana/wallet-signin.client.ts';
import type { AppBridge } from './client.ts';
import { pageBridge } from './page.ts';
import { externalSigner, type ExternalSigner } from './signer.ts';

/**
 * The city's one door to a signature. Every place in the city that asks a wallet to sign — the trade card, the
 * harbour, the launch, the sign-in — asks here. In the Ryntra app (the bridge exists and the app said `app.ready`)
 * the app's wallet signs through the bridge and nothing else is ever asked: a refusal, a timeout or `busy` from the
 * app is the answer, never a reason to try the browser's wallets. In a browser it is Wallet Standard, as it was.
 */

export type SignArgs = Readonly<{ wallet: string; address: string; unsignedWireBase64: string; chain?: string }>;
export type SignManyArgs = Readonly<{ wallet: string; address: string; unsignedWireBase64: readonly string[]; chain?: string }>;

export type BrowserSigner = Readonly<{
  signTransaction: (args: SignArgs) => Promise<SignResult>;
  signTransactions: (args: SignManyArgs) => Promise<SignManyResult>;
  signInWithWallet: (name: string, input: SignInInput, messageText: string) => Promise<SignInResult>;
}>;

export type CitySigner = Readonly<{
  signTransaction: (args: SignArgs) => Promise<SignResult>;
  signTransactions: (args: SignManyArgs) => Promise<SignManyResult>;
  signIn: (name: string, input: SignInInput, messageText: string) => Promise<SignInResult>;
}>;

/** The app's wallet signs on mainnet; a devnet step in the app is refused, never handed to another wallet. */
const APP_CHAIN = 'solana:mainnet';
export const MAINNET_ONLY = 'In the Ryntra app the wallet signs on Solana mainnet only.';

export function routeSigner(deps: Readonly<{ app: () => ExternalSigner | null; browser: BrowserSigner }>): CitySigner {
  return {
    signTransaction: (args) => {
      const app = deps.app();
      if (!app) return deps.browser.signTransaction(args);
      if (args.chain && args.chain !== APP_CHAIN) return Promise.resolve({ ok: false, reason: MAINNET_ONLY });
      return app.signTransaction({ address: args.address, unsignedWireBase64: args.unsignedWireBase64 });
    },
    signTransactions: (args) => {
      const app = deps.app();
      if (!app) return deps.browser.signTransactions(args);
      if (args.chain && args.chain !== APP_CHAIN) return Promise.resolve({ ok: false, reason: MAINNET_ONLY });
      return app.signTransactions({ address: args.address, unsignedWireBase64: args.unsignedWireBase64 });
    },
    signIn: (name, input, messageText) => {
      const app = deps.app();
      return app ? app.signIn(input, messageText) : deps.browser.signInWithWallet(name, input, messageText);
    },
  };
}

let held: Readonly<{ bridge: AppBridge; signer: ExternalSigner }> | null = null;

/** The app's wallet as a signer, once the app said `app.ready`; null in a browser. */
export function appSigner(): ExternalSigner | null {
  const bridge = pageBridge();
  if (!bridge?.ready()) return null;
  if (held?.bridge !== bridge) held = { bridge, signer: externalSigner(bridge) };
  return held.signer;
}

export const citySigner: CitySigner = routeSigner({ app: appSigner, browser: { signTransaction, signTransactions, signInWithWallet } });
