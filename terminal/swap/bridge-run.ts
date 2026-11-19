'use client';

import { adaptViemWallet, createClient, execute, getClient, type AdaptedWallet } from '@relayprotocol/relay-sdk';
import { configureDynamicChains } from '@relayprotocol/relay-sdk/chain-utils';
import { createPublicClient, custom } from 'viem';
import { citySigner } from '@/city/lib/app-bridge/route';
import { RELAY_SOLANA_CHAIN_ID } from '@/lib/relay/chains';
import { signatureOfWire } from '@/lib/relay/bridge-quote';
import { evmClient } from './bridge-evm';

/**
 * Carrying one Bridge order with Relay's own SDK — «бери його, якщо він чесніший за самописний ланцюг». The
 * SDK walks the quote's steps as Relay wrote them (an approval, the deposit, a signature), switches the wallet to the
 * sending network (adding it when the wallet lacks it), tells Relay of the deposit and follows the order until it lands
 * or comes back. The quote it carries is the one this site's server read back (`/api/swap/bridge/quote`).
 *
 * The page may talk only to its own site, so the SDK's calls go through this site's narrow pass to Relay
 * (`/api/swap/bridge/relay/*`), and a wallet is asked everything through the wallet: an EVM receipt is read through the
 * wallet's own connection, and a Solana step is built and sent by this site's server and signed in the person's wallet.
 */

/** How often the SDK asks where an order is, and how long before it hands the following over to the page. */
const POLL_MS = 3_000;
const POLL_ATTEMPTS = 100;

let ready: Promise<void> | null = null;

function sdk(): Promise<void> {
  if (ready) return ready;
  {
    createClient({
      baseApiUrl: `${window.location.origin}/api/swap/bridge/relay`,
      source: 'ryntra',
      pollingInterval: POLL_MS,
      maxPollingAttemptsBeforeTimeout: POLL_ATTEMPTS,
      confirmationPollingInterval: POLL_MS,
    });
    const asked: Promise<void> = configureDynamicChains().then(
      () => undefined,
      (error: unknown) => {
        ready = null;
        throw error;
      },
    );
    ready = asked;
    return asked;
  }
}

/** The connected EVM wallet as the SDK's wallet, its receipts read through the wallet itself. */
async function evmWallet(): Promise<AdaptedWallet> {
  const client = await evmClient();
  // One transaction at a time: a batched call (EIP-5792) answers with a bundle id, not a hash a person can follow.
  const base = adaptViemWallet(client as never, { disableCapabilitiesCheck: true });
  return {
    ...base,
    handleConfirmTransactionStep: async (hash, chainId, onReplaced, onCancelled) => {
      const chain = getClient().chains.find((entry) => entry.id === chainId)?.viemChain;
      const reader = createPublicClient({ chain, transport: custom({ request: (args) => client.request(args as never) }), pollingInterval: POLL_MS });
      return reader.waitForTransactionReceipt({
        hash: hash as `0x${string}`,
        timeout: 10 * 60_000,
        onReplaced: (replacement) => {
          if (replacement.reason === 'cancelled') {
            onCancelled();
            throw new Error('Transaction cancelled');
          }
          onReplaced(replacement.transaction.hash);
        },
      });
    },
  };
}

async function post<T>(body: Record<string, unknown>): Promise<T> {
  const response = await fetch('/api/swap/bridge/solana', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const payload = (await response.json().catch(() => null)) as (T & { error?: { code?: string; message?: string } }) | null;
  if (!response.ok || !payload) throw new BridgeStepError(payload?.error?.code ?? 'UNAVAILABLE', payload?.error?.message ?? 'The network did not answer.');
  return payload;
}

/** A refusal from this site's Solana side, with its code. */
export class BridgeStepError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'BridgeStepError';
  }
}

/** What this site's Solana side answers when it is sure nothing was sent: the order stops, nothing to follow. */
const NOT_SENT = new Set(['EXPIRED', 'SIMULATION_FAILED', 'SIMULATION_UNAVAILABLE', 'UNEXPECTED_PROGRAM', 'SIGNER_SHAPE', 'UNREADABLE', 'REVIEWED_BYTES_MISMATCH', 'WALLET_MODIFIED_BYTES', 'WALLET_REPLACED_BLOCKHASH', 'VALIDATION_ERROR', 'RATE_LIMITED', 'ORIGIN_REFUSED']);


/**
 * The person's Solana wallet as the SDK's wallet: the step is built and sent here, signed only in the wallet. Once the
 * wallet has signed, the transfer's id is known; if the network does not say whether it took the order, the page follows
 * that id — offering the same bytes again while their blockhash is valid — until it lands, fails, or can no longer land.
 */
function solanaWallet(connection: Readonly<{ wallet: string; address: string }>, onSigned: (signature: string) => void): AdaptedWallet {
  let signedWire: string | null = null;
  let lastValidBlockHeight: number | null = null;
  return {
    vmType: 'svm',
    getChainId: async () => RELAY_SOLANA_CHAIN_ID,
    address: async () => connection.address,
    switchChain: async () => undefined,
    handleSignMessageStep: async () => {
      throw new BridgeStepError('UNSUPPORTED', 'This order asks the Solana wallet for a message; nothing was signed.');
    },
    handleSendTransactionStep: async (_chainId, item) => {
      const data = (item.data ?? {}) as { instructions?: unknown; addressLookupTableAddresses?: unknown };
      const built = await post<{ unsigned: string; lastValidBlockHeight?: number }>({
        action: 'build',
        owner: connection.address,
        instructions: data.instructions,
        lookupTables: Array.isArray(data.addressLookupTableAddresses) ? data.addressLookupTableAddresses : [],
      });
      const signed = await citySigner.signTransaction({ wallet: connection.wallet, address: connection.address, unsignedWireBase64: built.unsigned, chain: 'solana:mainnet' });
      if (!signed.ok) throw new BridgeStepError('WALLET', signed.reason);
      signedWire = signed.signedWireBase64;
      lastValidBlockHeight = typeof built.lastValidBlockHeight === 'number' ? built.lastValidBlockHeight : null;
      const id = signatureOfWire(signed.signedWireBase64);
      // Signed is as good as sent for the person's records: kept now, so a reload in the next second still finds it.
      if (id) onSigned(id);
      try {
        const sent = await post<{ signature: string }>({ action: 'send', owner: connection.address, reviewed: built.unsigned, signed: signed.signedWireBase64 });
        return sent.signature;
      } catch (error) {
        // Refused before the network: nothing left the wallet. Anything else may be on its way — it is followed by its id.
        if (error instanceof BridgeStepError && NOT_SENT.has(error.code)) throw error;
        if (!id) throw error;
        return id;
      }
    },
    handleConfirmTransactionStep: async (signature) => {
      const until = Date.now() + 180_000;
      while (Date.now() < until) {
        const answer = await post<{ state: string }>({ action: 'status', signature, ...(signedWire ? { signed: signedWire } : {}), ...(lastValidBlockHeight ? { lastValidBlockHeight } : {}) }).catch(() => ({ state: 'unknown' }));
        if (answer.state === 'confirmed') return { blockHash: '', blockNumber: 0, txHash: signature };
        if (answer.state === 'failed') throw new BridgeStepError('FAILED_ON_CHAIN', 'The transaction failed on Solana; only the network fee was spent.');
        if (answer.state === 'expired') throw new BridgeStepError('EXPIRED', 'The order can no longer land; nothing left the wallet.');
        await new Promise((resolve) => setTimeout(resolve, 2_500));
      }
      throw new BridgeStepError('CONFIRM_TIMEOUT', 'Solana has not confirmed the transaction yet.');
    },
  };
}

export type RunWallet = Readonly<{ kind: 'evm' }> | Readonly<{ kind: 'solana'; wallet: string; address: string }>;

/**
 * Carries the quote; `onProgress` hears each step. Resolves when the order lands; rejects with the SDK's or the
 * wallet's error otherwise — the caller tells a refusal, a timeout and a failure apart.
 */
export async function runQuote(quote: unknown, wallet: RunWallet, onProgress: (progress: Record<string, unknown>) => void, onSigned: (signature: string) => void = () => undefined): Promise<void> {
  await sdk();
  const adapted = wallet.kind === 'evm' ? await evmWallet() : solanaWallet(wallet, onSigned);
  // The wallet is turned to the sending network first (added to it when it lacks one): the SDK only checks it is there.
  const originChain = (quote as { details?: { currencyIn?: { currency?: { chainId?: number } } } }).details?.currencyIn?.currency?.chainId;
  if (wallet.kind === 'evm' && typeof originChain === 'number' && (await adapted.getChainId()) !== originChain) await adapted.switchChain(originChain);
  const run = await execute({ quote: quote as never, wallet: adapted, onProgress: (progress) => onProgress(progress as unknown as Record<string, unknown>) });
  void run;
}

/** Whether an error is the SDK giving up on following (the order may still land): a timeout, not a failure. */
export function timedOut(error: unknown): boolean {
  const name = error instanceof Error ? error.name : '';
  const text = error instanceof Error ? error.message : String(error);
  return /Timeout|TransactionConfirmation/i.test(name) || /timed? ?out|still pending|CONFIRM_TIMEOUT/i.test(text) || (error instanceof BridgeStepError && error.code === 'CONFIRM_TIMEOUT');
}

/** Whether this site's Solana side was sure nothing was sent: refused before the network. */
export function notSent(error: unknown): boolean {
  return error instanceof BridgeStepError && NOT_SENT.has(error.code);
}

/** Whether an error says the order can no longer land and nothing left the wallet. */
export function expired(error: unknown): boolean {
  return error instanceof BridgeStepError ? error.code === 'EXPIRED' || error.code === 'SIMULATION_FAILED' : /EXPIRED|can no longer land/.test(String((error as Error)?.message ?? error));
}

/** Whether an error says the deposit itself failed on its network — reverted: the money stayed, only the fee was spent. */
export function reverted(error: unknown): boolean {
  if (error instanceof BridgeStepError) return error.code === 'FAILED_ON_CHAIN';
  const seen = new Set<unknown>();
  for (let cause: unknown = error; cause && !seen.has(cause); cause = (cause as { cause?: unknown }).cause) {
    seen.add(cause);
    const text = cause instanceof Error ? `${cause.name} ${cause.message}` : String(cause);
    if (/FAILED_ON_CHAIN|revert|failed on Solana/i.test(text)) return true;
  }
  return false;
}
