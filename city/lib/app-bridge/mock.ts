import { getPublicKeyAsync, signAsync } from '@noble/ed25519';
import type { Transport } from './client.ts';
import {
  base64ToBytes,
  bytesToBase64,
  encodeAppMessage,
  isPageReady,
  parsePageRequest,
  requestIdOf,
  WALLET_REQUESTS,
  type AppResponse,
  type AppWallet,
  type ErrorCode,
  type PageRequest,
  type RequestType,
} from './protocol.ts';

/**
 * A fake Ryntra app: the other end of the bridge for the tests and for the stand (`?bridge=mock`, development only).
 * It reads every request with the app's own parser, as CITY-6c must, and answers as the contract says. Its wallet is a
 * throwaway key made for the page load: it signs for real (Ed25519), so the engine and the sign-in see true
 * signatures, and it owns nothing. Never in a production bundle.
 */

export type FakeMode = 'approve' | 'decline' | 'fail' | 'busy' | 'unsupported' | 'silent';

export type FakeAppOptions = Readonly<{
  /** The wallet's 32-byte Ed25519 seed; a fresh one when left out. */
  secretKey?: Uint8Array;
  name?: string;
  version?: string;
  /** The wallet is already connected in the app when the page loads. */
  connected?: boolean;
  /** How long the wallet window stays open before it answers. */
  answerDelayMs?: number;
}>;

export type FakeLogEntry = Readonly<{ type: RequestType | 'invalid'; id: string | null; answer: 'ok' | ErrorCode | 'none' }>;

export type FakeApp = Readonly<{
  address: () => Promise<string>;
  /** A message from the page. */
  receive: (data: unknown) => void;
  /** Hear what the app says to the page. */
  onSend: (listener: (data: string) => void) => () => void;
  /** `app.ready`, as the app sends it after the page loaded. */
  ready: () => Promise<void>;
  /** How the wallet answers from now on, for one request type or all. */
  setMode: (type: RequestType | '*', mode: FakeMode) => void;
  /** How the wallet answers the next request of this type, once. */
  once: (type: RequestType, mode: FakeMode) => void;
  /** The person connects or disconnects in the app itself: `wallet.changed`. */
  changeWallet: (connected: boolean) => Promise<void>;
  /** Every request the app received, valid or not. */
  requests: readonly PageRequest[];
  log: readonly FakeLogEntry[];
}>;

const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

export function base58(bytes: Uint8Array): string {
  const digits: number[] = [];
  for (const byte of bytes) {
    let carry = byte;
    for (let i = 0; i < digits.length; i++) {
      carry += digits[i]! << 8;
      digits[i] = carry % 58;
      carry = (carry / 58) | 0;
    }
    while (carry) {
      digits.push(carry % 58);
      carry = (carry / 58) | 0;
    }
  }
  let out = '';
  for (const byte of bytes) {
    if (byte !== 0) break;
    out += '1';
  }
  for (let i = digits.length - 1; i >= 0; i--) out += ALPHABET[digits[i]!];
  return out;
}

function compactU16(bytes: Uint8Array, offset: number): [number, number] {
  let value = 0;
  for (let size = 0; size < 3; size++) {
    const byte = bytes[offset + size];
    if (byte === undefined) return [-1, 0];
    value |= (byte & 0x7f) << (7 * size);
    if ((byte & 0x80) === 0) return [value, size + 1];
  }
  return [-1, 0];
}

/** Sign a serialized transaction (legacy or v0) in this key's own signature slot; null when the key is not a signer. */
export async function signWireWith(wire: Uint8Array, secretKey: Uint8Array, publicKey: Uint8Array): Promise<Uint8Array | null> {
  const [count, countSize] = compactU16(wire, 0);
  if (count < 1) return null;
  const messageStart = countSize + 64 * count;
  const message = wire.subarray(messageStart);
  if (message.length < 4) return null;
  let offset = message[0]! & 0x80 ? 1 : 0;
  const required = message[offset]!;
  offset += 3;
  const [keys, keysSize] = compactU16(message, offset);
  offset += keysSize;
  let slot = -1;
  for (let i = 0; i < Math.min(required, keys, count); i++) {
    const key = message.subarray(offset + 32 * i, offset + 32 * i + 32);
    if (key.length === 32 && key.every((byte, j) => byte === publicKey[j])) slot = i;
  }
  if (slot < 0) return null;
  const signature = await signAsync(message, secretKey);
  const out = wire.slice();
  out.set(signature, countSize + 64 * slot);
  return out;
}

export function createFakeApp(options: FakeAppOptions = {}): FakeApp {
  const secretKey = options.secretKey ?? globalThis.crypto.getRandomValues(new Uint8Array(32));
  const publicKey = getPublicKeyAsync(secretKey);
  const address = publicKey.then(base58);
  const name = options.name ?? 'Mock wallet';
  const senders = new Set<(data: string) => void>();
  const modes = new Map<RequestType | '*', FakeMode>();
  const onceModes = new Map<RequestType, FakeMode[]>();
  const requests: PageRequest[] = [];
  const log: FakeLogEntry[] = [];
  let connected = options.connected === true;
  let walletOpen = false;

  const send = (data: string) => {
    for (const sender of senders) sender(data);
  };
  const answer = (response: AppResponse) => send(encodeAppMessage(response));
  const wallet = async (): Promise<AppWallet | null> => (connected ? { address: await address, name } : null);
  const modeOf = (type: RequestType): FakeMode => onceModes.get(type)?.shift() ?? modes.get(type) ?? modes.get('*') ?? 'approve';
  const refuse = (id: string, code: ErrorCode, message: string) => answer({ kind: 'response', id, ok: false, error: { code, message } });

  const handle = async (request: PageRequest) => {
    const mode = modeOf(request.type);
    if (mode === 'silent') return log.push({ type: request.type, id: request.id, answer: 'none' });
    const isWallet = WALLET_REQUESTS.has(request.type);
    if (mode === 'busy' || (isWallet && walletOpen)) {
      log.push({ type: request.type, id: request.id, answer: 'busy' });
      return refuse(request.id, 'busy', 'Another request is open in the wallet.');
    }
    if (mode === 'unsupported' || mode === 'fail' || mode === 'decline') {
      const code: ErrorCode = mode === 'decline' ? 'declined' : mode === 'fail' ? 'failed' : 'unsupported';
      log.push({ type: request.type, id: request.id, answer: code });
      return refuse(request.id, code, mode === 'decline' ? 'The person said no.' : 'The fake app could not.');
    }
    if (isWallet) walletOpen = true;
    try {
      if (options.answerDelayMs) await new Promise((resolve) => setTimeout(resolve, options.answerDelayMs));
      let result: unknown;
      switch (request.type) {
        case 'wallet.connect':
          connected = true;
          result = await wallet();
          break;
        case 'wallet.disconnect':
          connected = false;
          result = {};
          break;
        case 'wallet.signMessage': {
          if (!connected) return refuse(request.id, 'failed', 'No wallet connected.');
          const message = base64ToBytes(request.message);
          const signature = await signAsync(message, secretKey);
          result = { signature: bytesToBase64(signature), signedMessage: request.message };
          break;
        }
        case 'wallet.signTransactions': {
          if (!connected) return refuse(request.id, 'failed', 'No wallet connected.');
          const signed: string[] = [];
          for (const wire of request.transactions) {
            const out = await signWireWith(base64ToBytes(wire), secretKey, await publicKey);
            if (!out) return refuse(request.id, 'failed', 'This wallet is not a signer of that transaction.');
            signed.push(bytesToBase64(out));
          }
          result = { signed };
          break;
        }
        case 'share.file':
          result = { shared: true };
          break;
        case 'open.external':
          result = {};
          break;
      }
      log.push({ type: request.type, id: request.id, answer: 'ok' });
      answer({ kind: 'response', id: request.id, ok: true, result });
    } finally {
      if (isWallet) walletOpen = false;
    }
  };

  const sayReady = async () =>
    send(encodeAppMessage({ kind: 'event', type: 'app.ready', version: options.version ?? '0.0.0-mock', platform: 'android', wallet: await wallet() }));

  return {
    address: () => address,
    receive: (data) => {
      // The page's hello: `app.ready` again, as the app answers it.
      if (isPageReady(data)) return void sayReady();
      const request = parsePageRequest(data);
      if (!request) {
        const id = requestIdOf(data);
        log.push({ type: 'invalid', id, answer: id ? 'invalid' : 'none' });
        if (id) refuse(id, 'invalid', 'The request did not pass the parser.');
        return;
      }
      requests.push(request);
      void handle(request);
    },
    onSend: (listener) => {
      senders.add(listener);
      return () => void senders.delete(listener);
    },
    ready: sayReady,
    setMode: (type, mode) => void modes.set(type, mode),
    once: (type, mode) => void onceModes.set(type, [...(onceModes.get(type) ?? []), mode]),
    changeWallet: async (next) => {
      connected = next;
      send(encodeAppMessage({ kind: 'event', type: 'wallet.changed', wallet: await wallet() }));
    },
    requests,
    log,
  };
}

/** The page's end of a fake app: what the page posts reaches the app a moment later, as through the WebView. */
export function fakeAppTransport(app: FakeApp): Transport {
  return {
    post: (data) => void Promise.resolve().then(() => app.receive(data)),
    listen: (receive) => app.onSend(receive),
  };
}
