import { createAppBridge, type AppBridge, type Transport } from './client.ts';
import type { FakeApp } from './mock.ts';
import { bytesToBase64, isExternalUrl, MAX_SHARE_BYTES, MAX_SHARE_TEXT, SHARE_MIMES, shareNameOf, type ShareMime } from './protocol.ts';

/**
 * The bridge as the city page holds it: one per page, made only inside the Ryntra app's WebView
 * (`window.ReactNativeWebView` and `RyntraApp/` in the user agent). The city is "in the app" only after the app said
 * `app.ready`; before that, and in every browser, the city's wallets are the browser's own (Wallet Standard) and
 * nothing here runs.
 *
 * Development only: `?bridge=mock` puts a fake app in the page (`./mock.ts`) so the bridge can be walked by hand in a
 * desktop browser — on the city itself and on the stand `/city/bridge`.
 */

/** How long a page that looks like the app waits for `app.ready` before it takes the browser's wallets. */
export const APP_READY_WAIT_MS = 5_000;

export type BridgeWindow = Readonly<{
  ReactNativeWebView?: Readonly<{ postMessage?: (data: string) => void }>;
  navigator?: Readonly<{ userAgent?: string }>;
  location?: Readonly<{ origin?: string; search?: string }>;
  addEventListener: (type: 'message', listener: (event: MessageEvent) => void) => void;
  removeEventListener: (type: 'message', listener: (event: MessageEvent) => void) => void;
  document?: Readonly<{
    addEventListener: (type: 'message', listener: (event: MessageEvent) => void) => void;
    removeEventListener: (type: 'message', listener: (event: MessageEvent) => void) => void;
  }>;
}>;

const APP_AGENT = /(?:^|\s)RyntraApp\/\S+/;

/** The page sits in the Ryntra app's WebView: both marks, never one. */
export function looksLikeApp(win: BridgeWindow): boolean {
  return typeof win.ReactNativeWebView?.postMessage === 'function' && APP_AGENT.test(win.navigator?.userAgent ?? '');
}

/**
 * A message the WebView delivered: it comes with no window behind it (or this window itself) and no foreign origin.
 * A frame inside the page posting to it is not the app.
 */
export function fromApp(event: Pick<MessageEvent, 'source' | 'origin'>, win: BridgeWindow): boolean {
  if (event.source !== null && event.source !== undefined && (event.source as unknown) !== win) return false;
  return !event.origin || event.origin === win.location?.origin;
}

export function webViewTransport(win: BridgeWindow): Transport {
  return {
    post: (data) => win.ReactNativeWebView!.postMessage!(data),
    listen: (receive) => {
      const hear = (event: MessageEvent) => {
        if (fromApp(event, win)) receive(event.data);
      };
      // Android's WebView delivers on `document`, others on `window`: both are heard, and a twin answer is dropped by id.
      win.addEventListener('message', hear);
      win.document?.addEventListener('message', hear);
      return () => {
        win.removeEventListener('message', hear);
        win.document?.removeEventListener('message', hear);
      };
    },
  };
}

let bridge: AppBridge | null | undefined;
let mock: Promise<FakeApp> | null = null;

function mockAsked(win: BridgeWindow): boolean {
  if (process.env.NODE_ENV === 'production') return false;
  try {
    return new URLSearchParams(win.location?.search ?? '').get('bridge') === 'mock';
  } catch {
    return false;
  }
}

/** Development only: the fake app is loaded on its own, and what the page says waits for it. */
function mockTransport(): Transport {
  const queue: string[] = [];
  const receivers = new Set<(data: unknown) => void>();
  let app: FakeApp | null = null;
  // The branch is cut from a production build, and the fake app with it.
  if (process.env.NODE_ENV !== 'production') {
    mock = import('./mock.ts').then(({ createFakeApp }) => {
      const made = createFakeApp({ name: 'Mock wallet', answerDelayMs: 600 });
      made.onSend((data) => receivers.forEach((receive) => receive(data)));
      app = made;
      for (const data of queue.splice(0)) made.receive(data);
      void made.ready();
      return made;
    });
  }
  return {
    post: (data) => (app ? void Promise.resolve().then(() => app!.receive(data)) : void queue.push(data)),
    listen: (receive) => {
      receivers.add(receive);
      return () => void receivers.delete(receive);
    },
  };
}

/** Put the bridge in a page: the WebView's, the fake app's, or none in a browser. Tests hand their own window. */
export function attachAppBridge(win: BridgeWindow, options: Readonly<{ transport?: Transport; timeoutMs?: number }> = {}): AppBridge | null {
  bridge?.close();
  mock = null;
  const inApp = !options.transport && looksLikeApp(win);
  const transport = options.transport ?? (inApp ? webViewTransport(win) : mockAsked(win) ? mockTransport() : null);
  // In the WebView the page says `page.ready` as soon as it listens: the app's `app.ready` on load may have come first.
  bridge = transport ? createAppBridge(transport, { timeoutMs: options.timeoutMs, hello: inApp }) : null;
  return bridge;
}

/** Forget the page's bridge (tests). */
export function detachAppBridge(): void {
  bridge?.close();
  bridge = undefined;
  mock = null;
}

/** This page's bridge, made on first use; null outside the app. */
export function pageBridge(): AppBridge | null {
  if (bridge !== undefined) return bridge;
  if (typeof window === 'undefined') return null;
  return attachAppBridge(window as unknown as BridgeWindow);
}

/** The city is in the app: the bridge exists and the app said `app.ready`. */
export function onApp(): boolean {
  return pageBridge()?.ready() != null;
}

/** The fake app of `?bridge=mock`, for the stand's switches; null in any other page. */
export function mockApp(): Promise<FakeApp> | null {
  pageBridge();
  return mock;
}

/** Open a link outside the city: the app's browser in the app, a new tab elsewhere. */
export function openExternal(url: string): void {
  const app = pageBridge();
  if (app?.ready()) {
    const absolute = absoluteUrl(url);
    if (absolute) void app.request('open.external', { url: absolute });
    return;
  }
  window.open(url, '_blank', 'noopener');
}

function absoluteUrl(href: string): string | null {
  try {
    const url = new URL(href, window.location.href).toString();
    return isExternalUrl(url) ? url : null;
  } catch {
    return null;
  }
}

/** A file through the app's own share sheet. Null outside the app, or for a file the bridge does not carry. */
export async function shareThroughApp(file: Blob & { name?: string }, name: string, text?: string): Promise<'shared' | 'cancelled' | null> {
  const app = pageBridge();
  if (!app?.ready()) return null;
  const mime = file.type.split(';')[0] as ShareMime;
  if (!(SHARE_MIMES as readonly string[]).includes(mime) || file.size > MAX_SHARE_BYTES) return null;
  const data = bytesToBase64(new Uint8Array(await file.arrayBuffer()));
  // The app's share sheet takes an ASCII name and up to 500 characters of words (`docs/city/APP-BRIDGE.md`).
  const answer = await app.request('share.file', { name: shareNameOf(name), mime, data, ...(text ? { text: text.slice(0, MAX_SHARE_TEXT) } : {}) });
  if (answer.ok) return answer.result.shared ? 'shared' : 'cancelled';
  // An older app, or a file the bridge refused to carry: the page's own way is tried next. Any other answer is the
  // person's or the app's, and nothing more is tried.
  return answer.code === 'unsupported' || answer.code === 'invalid' ? null : 'cancelled';
}

/**
 * In the app, a tap on a link that leaves the city (`target="_blank"`, or another site) opens it outside the
 * WebView through `open.external`, so the city stays where it was. Installed once the app said `app.ready`.
 */
export function catchExternalLinks(doc: Document, app: AppBridge): () => void {
  const click = (event: MouseEvent) => {
    if (event.defaultPrevented || event.button !== 0 || !app.ready()) return;
    const anchor = (event.target as Element | null)?.closest?.('a[href]') as HTMLAnchorElement | null;
    if (!anchor || anchor.hasAttribute('download')) return;
    const absolute = absoluteUrl(anchor.getAttribute('href') ?? '');
    if (!absolute) return;
    const leaves = anchor.target === '_blank' || new URL(absolute).origin !== window.location.origin;
    if (!leaves) return;
    event.preventDefault();
    void app.request('open.external', { url: absolute });
  };
  doc.addEventListener('click', click, true);
  return () => doc.removeEventListener('click', click, true);
}
