import {
  encodePageReady,
  encodeRequest,
  parseAppMessage,
  parseFields,
  parseResult,
  REQUEST_TIMEOUT_MS,
  WALLET_REQUESTS,
  type AppEvent,
  type AppWallet,
  type ErrorCode,
  type RequestFields,
  type RequestType,
  type ResultOf,
} from './protocol.ts';

/**
 * The page's side of the bridge to the Ryntra app (`docs/city/APP-BRIDGE.md`): it asks, waits for the answer with the
 * same id, and hears the app's two events. One request to the wallet at a time — a second while one is open is `busy`
 * here, before the app is even asked. An answer that does not come in 120 s is `failed`, and a late one is dropped.
 * The transport is given (the WebView in the page, a fake app in the tests and on the stand), so this file has no
 * `window` of its own.
 */

export type Transport = Readonly<{
  /** Hand one JSON string to the app. */
  post: (data: string) => void;
  /** Hear every message that arrives; the bridge reads each through the parser. */
  listen: (receive: (data: unknown) => void) => () => void;
}>;

export type Timers = Readonly<{
  set: (run: () => void, ms: number) => unknown;
  clear: (handle: unknown) => void;
}>;

export type BridgeAnswer<T> = Readonly<{ ok: true; result: T }> | Readonly<{ ok: false; code: ErrorCode; message: string }>;

export type AppReady = Readonly<{ version: string; platform: 'android' }>;

export type AppBridge = Readonly<{
  /** The app's `app.ready`, once it came; null before. */
  ready: () => AppReady | null;
  /** The wallet the app has connected, as its last word said. */
  wallet: () => AppWallet | null;
  /** True once `app.ready` came; false when it did not in `ms`. */
  whenReady: (ms: number) => Promise<boolean>;
  /** Hear `app.ready` and `wallet.changed`, after the bridge has taken them in. */
  subscribe: (listener: (event: AppEvent) => void) => () => void;
  request: <T extends RequestType>(type: T, fields: RequestFields[T]) => Promise<BridgeAnswer<ResultOf[T]>>;
  /** How many requests wait for an answer. */
  pending: () => number;
  close: () => void;
}>;

const realTimers: Timers = {
  set: (run, ms) => setTimeout(run, ms),
  clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

const LINES = {
  busy: 'Your wallet is still answering another request.',
  timeout: 'The wallet did not answer in time. Nothing was signed.',
  invalid: 'This request could not be sent to the app.',
  unknownAnswer: 'The app answered in a way this page does not know.',
  closed: 'The app is no longer listening.',
} as const;

function randomPart(): string {
  const bytes = new Uint8Array(6);
  globalThis.crypto?.getRandomValues?.(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

type Waiting = Readonly<{ type: RequestType; fields: unknown; settle: (answer: BridgeAnswer<unknown>) => void }>;

export type BridgeOptions = Readonly<{
  timers?: Timers;
  timeoutMs?: number;
  /**
   * Say `page.ready` once the bridge listens (the WebView): the app answers with `app.ready`, so a page whose code came
   * after the app's first `app.ready` still hears it.
   */
  hello?: boolean;
}>;

export function createAppBridge(transport: Transport, options: BridgeOptions = {}): AppBridge {
  const timers = options.timers ?? realTimers;
  const timeoutMs = options.timeoutMs ?? REQUEST_TIMEOUT_MS;
  const waiting = new Map<string, Waiting>();
  const listeners = new Set<(event: AppEvent) => void>();
  const readyWaiters = new Set<() => void>();
  let ready: AppReady | null = null;
  let wallet: AppWallet | null = null;
  let seq = 0;
  let closed = false;

  const receive = (data: unknown) => {
    const message = parseAppMessage(data);
    if (!message) return;
    if (message.kind === 'response') {
      // An answer to nothing this page is waiting for — a late one, a twin from the other listener — is dropped.
      const asked = waiting.get(message.id);
      if (!asked) return;
      waiting.delete(message.id);
      if (!message.ok) return asked.settle({ ok: false, code: message.error.code, message: message.error.message });
      const result = parseResult(asked.type, message.result, asked.fields as never);
      if (!result) return asked.settle({ ok: false, code: 'failed', message: LINES.unknownAnswer });
      if (asked.type === 'wallet.connect') wallet = result as AppWallet;
      if (asked.type === 'wallet.disconnect') wallet = null;
      return asked.settle({ ok: true, result });
    }
    if (message.type === 'app.ready') {
      ready = { version: message.version, platform: message.platform };
      for (const done of readyWaiters) done();
      readyWaiters.clear();
    }
    // `app.ready` before anything else; a `wallet.changed` without it is still the app's word on its wallet.
    wallet = message.wallet;
    for (const listener of listeners) listener(message);
  };

  const stop = transport.listen(receive);
  if (options.hello) {
    try {
      transport.post(encodePageReady());
    } catch {
      // No app to hear it: the page stays a browser until `app.ready` comes, if it ever does.
    }
  }

  return {
    ready: () => ready,
    wallet: () => wallet,
    whenReady: (ms) =>
      new Promise<boolean>((resolve) => {
        if (ready) return resolve(true);
        const done = () => {
          timers.clear(timer);
          resolve(true);
        };
        const timer = timers.set(() => {
          readyWaiters.delete(done);
          resolve(ready !== null);
        }, ms);
        readyWaiters.add(done);
      }),
    subscribe: (listener) => {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    request: <T extends RequestType>(type: T, fields: RequestFields[T]) =>
      new Promise<BridgeAnswer<ResultOf[T]>>((resolve) => {
        if (closed) return resolve({ ok: false, code: 'failed', message: LINES.closed });
        // The page checks its own request with the app's parser: what the app would refuse is never sent.
        const checked = parseFields(type, fields as Record<string, unknown>);
        if (!checked) return resolve({ ok: false, code: 'invalid', message: LINES.invalid });
        if (WALLET_REQUESTS.has(type) && [...waiting.values()].some((open) => WALLET_REQUESTS.has(open.type))) {
          return resolve({ ok: false, code: 'busy', message: LINES.busy });
        }
        const id = `p${++seq}-${randomPart()}`;
        const timer = timers.set(() => {
          if (!waiting.delete(id)) return;
          resolve({ ok: false, code: 'failed', message: LINES.timeout });
        }, timeoutMs);
        waiting.set(id, {
          type,
          fields: checked,
          settle: (answer) => {
            timers.clear(timer);
            resolve(answer as BridgeAnswer<ResultOf[T]>);
          },
        });
        try {
          transport.post(encodeRequest(id, type, checked));
        } catch {
          waiting.delete(id);
          timers.clear(timer);
          resolve({ ok: false, code: 'failed', message: LINES.closed });
        }
      }),
    pending: () => waiting.size,
    close: () => {
      closed = true;
      stop();
      for (const [id, open] of waiting) {
        waiting.delete(id);
        open.settle({ ok: false, code: 'failed', message: LINES.closed });
      }
      listeners.clear();
    },
  };
}
