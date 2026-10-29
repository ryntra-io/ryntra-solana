import { isRyntraApp } from '../app-mode.ts';
import { chooseVia, DETACH_CHANNEL, detachUrl, fitSize, OUT_DEFAULT, parseMessage, popupFeatures, sameParams, type Message, type Params, type Via } from './detach.ts';
import type { Size } from './geometry.ts';
import { placed } from './layout.ts';
import { outSizeOf, useWindows, windowWasOut } from './store.ts';

/**
 * The windows out on another screen, in the browser (CITY-75; the rules are `detach.ts`): opening the window out
 * there, copying the city's styles into a Picture-in-Picture window, watching it close, and speaking to a window on its
 * own page over the channel. The store says what is out; this file holds the browser windows themselves.
 */

type DocumentPip = Readonly<{ requestWindow: (options: { width: number; height: number }) => Promise<Window>; window: Window | null }>;
type Handle = { via: Via; win: Window | null; params: Params; stop?: () => void };

const handles = new Map<string, Handle>();
let channel: BroadcastChannel | null = null;

const pipApi = (): DocumentPip | null => (typeof window === 'undefined' ? null : ((window as Window & { documentPictureInPicture?: DocumentPip }).documentPictureInPicture ?? null));

/** Whether a window can go out from this page at all: a computer's browser, not a phone, not the Ryntra app. */
export function canGoOut(): boolean {
  if (typeof window === 'undefined') return false;
  const { desk, alone } = useWindows.getState();
  return chooseVia({ desk: desk && !alone, app: isRyntraApp(navigator.userAgent), pip: Boolean(pipApi()), pipBusy: false, popup: typeof window.open === 'function' }) !== null;
}

/** The Picture-in-Picture window a window stands in, while it does. */
export function pipWindowOf(id: string): Window | null {
  const handle = handles.get(id);
  return handle?.via === 'pip' && handle.win && !handle.win.closed ? handle.win : null;
}

/**
 * The city is on a screen the person sees: its own tab, or a window of it out in Picture-in-Picture while the tab is in
 * the background. Reads that pause in a hidden tab keep running for a window the person is looking at.
 */
export function cityInView(): boolean {
  if (typeof document === 'undefined') return true;
  if (document.visibilityState === 'visible') return true;
  for (const handle of handles.values()) if (handle.via === 'pip' && handle.win && !handle.win.closed && handle.win.document.visibilityState === 'visible') return true;
  return false;
}

const screenNow = () => ({
  left: (screen as Screen & { availLeft?: number }).availLeft ?? 0,
  top: (screen as Screen & { availTop?: number }).availTop ?? 0,
  width: screen.availWidth || window.innerWidth,
  height: screen.availHeight || window.innerHeight,
});

const sizeOf = (win: Window): Size | null => {
  try {
    return win.innerWidth > 0 && win.innerHeight > 0 ? { width: win.innerWidth, height: win.innerHeight } : null;
  } catch {
    return null;
  }
};

/**
 * An open window goes out onto another screen: Document Picture-in-Picture where the browser has it and none is open
 * yet, a browser window on the city's route otherwise. Called from a tap (a browser opens neither without one);
 * `auto` is the window going out again by itself because it was out last time — only while the tap that opened it
 * still counts. Resolves to how it went, or null when it stayed in the city.
 */
export async function goOut(id: string, options: Readonly<{ auto?: boolean }> = {}): Promise<Via | null> {
  const store = useWindows.getState();
  const spec = store.specs[id];
  if (!spec?.detach || store.out[id] || !placed(store.layout, id)) return null;
  const activation = (navigator as Navigator & { userActivation?: { isActive: boolean } }).userActivation;
  if (options.auto && !activation?.isActive) return null;
  const pip = pipApi();
  const via = chooseVia({
    desk: store.desk && !store.alone,
    app: isRyntraApp(navigator.userAgent),
    pip: Boolean(pip),
    pipBusy: Boolean(pip?.window) || [...handles.values()].some((h) => h.via === 'pip'),
    popup: typeof window.open === 'function',
  });
  if (!via) return null;
  const screenBox = screenNow();
  const size = fitSize(outSizeOf(id) ?? spec.size ?? OUT_DEFAULT, screenBox);
  const params = spec.detach;

  if (via === 'pip' && pip) {
    try {
      const win = await pip.requestWindow({ width: size.width, height: size.height });
      const stop = dress(win);
      handles.set(id, { via: 'pip', win, params, stop });
      // Closed by the person (or by the city taking it back): its contents come back where they stood.
      win.addEventListener(
        'pagehide',
        () => {
          stop();
          if (handles.get(id)?.win !== win) return;
          handles.delete(id);
          useWindows.getState().attach(id, sizeOf(win));
        },
        { once: true },
      );
      useWindows.getState().detach(id, 'pip', size);
      if (!useWindows.getState().out[id]) release(id);
      return 'pip';
    } catch {
      // Refused (no tap left, a policy): the other way, if the browser still lets a window open.
    }
  }

  const win = window.open(detachUrl(id, params), `ryntra-window-${id}`, popupFeatures(size, screenBox));
  if (!win) return null;
  const timer = setInterval(() => {
    if (!win.closed || handles.get(id)?.win !== win) return;
    clearInterval(timer);
    handles.delete(id);
    useWindows.getState().attach(id);
  }, 600);
  handles.set(id, { via: 'tab', win, params, stop: () => clearInterval(timer) });
  listen();
  useWindows.getState().detach(id, 'tab', size);
  if (!useWindows.getState().out[id]) release(id);
  return 'tab';
}

/** The window out there comes back to the city in one tap: the window out there closes, the frame stands where it stood. */
export function comeBack(id: string): void {
  const handle = handles.get(id);
  // A page of its own is asked, and comes back when it has closed (it says so, or its handle shows it): a signature out
  // there holds it until done, so the city never draws a second copy of a window that is mid-signature.
  if (handle?.via === 'tab' && channel && (!handle.win || !handle.win.closed)) {
    post({ t: 'return', id });
    if (!handle.win) {
      // Adopted after a reload, with no handle to watch: a page that does not answer is gone.
      setTimeout(() => {
        if (handles.get(id) === handle && useWindows.getState().out[id]) {
          handles.delete(id);
          useWindows.getState().attach(id);
        }
      }, RETURN_WAIT_MS);
    }
    return;
  }
  const size = handle?.win && !handle.win.closed ? sizeOf(handle.win) : null;
  useWindows.getState().attach(id, size);
}

/** How long a page of its own, adopted with no handle, has to answer «back» before the city takes the window anyway. */
const RETURN_WAIT_MS = 2_500;

/** A window that opens while it was out last time goes out again, if the tap that opened it still counts. */
export function goOutAgain(id: string): void {
  if (windowWasOut(id) && canGoOut()) void goOut(id, { auto: true });
}

/** The browser window of a window no longer out — taken back, or closed by its owner — closes. */
function release(id: string) {
  const handle = handles.get(id);
  if (!handle) return;
  handles.delete(id);
  handle.stop?.();
  if (handle.via === 'tab') post({ t: 'return', id });
  try {
    if (handle.win && !handle.win.closed) handle.win.close();
  } catch {
    // A window that is already going.
  }
}

function post(message: Message) {
  try {
    channel?.postMessage(message);
  } catch {
    // No channel: the window out there is still closed through its handle.
  }
}

/** The city's side of the channel: windows on their own pages say they are there and when they close. */
function listen() {
  if (channel || typeof BroadcastChannel === 'undefined') return;
  channel = new BroadcastChannel(DETACH_CHANNEL);
  channel.onmessage = (event) => {
    const message = parseMessage(event.data);
    if (!message) return;
    const store = useWindows.getState();
    if (message.t === 'gone') {
      if (store.out[message.id]?.via !== 'tab') return;
      handles.get(message.id)?.stop?.();
      handles.delete(message.id);
      store.attach(message.id, message.size);
    } else if (message.t === 'here') {
      // A window already on its own page (left there before the city reloaded) while the same window opens in the
      // city: it is that one — the frame leaves the city, and the page out there follows what the city shows.
      const spec = store.specs[message.id];
      if (!spec?.detach || store.out[message.id] || !placed(store.layout, message.id)) return;
      handles.set(message.id, { via: 'tab', win: null, params: message.params });
      store.detach(message.id, 'tab', outSizeOf(message.id) ?? spec.size ?? OUT_DEFAULT);
      follow(message.id);
    }
  };
}

/** What a window on its own page shows follows the city: another tower picked, the same window, its new tower. */
function follow(id: string) {
  const handle = handles.get(id);
  const params = useWindows.getState().specs[id]?.detach;
  if (!handle || handle.via !== 'tab' || !params || sameParams(handle.params, params)) return;
  handle.params = params;
  post({ t: 'follow', id, params });
}

let started = false;

/**
 * The city's page starts watching its windows out there: a window no longer out has its browser window closed, a
 * window out on its own page follows the city, and pages left open before a reload are asked to say they are there.
 */
export function startOut(): () => void {
  if (started || typeof window === 'undefined') return () => {};
  started = true;
  listen();
  post({ t: 'hello' });
  const stop = useWindows.subscribe((now, before) => {
    if (now.out === before.out && now.specs === before.specs) return;
    for (const id of Object.keys(before.out)) if (!now.out[id]) release(id);
    for (const id of Object.keys(now.out)) follow(id);
  });
  // The page going away takes its Picture-in-Picture windows with it; windows on their own pages stay and live on.
  const leave = () => {
    for (const [id, handle] of handles) if (handle.via === 'pip') release(id);
  };
  window.addEventListener('pagehide', leave);
  return () => {
    started = false;
    stop();
    window.removeEventListener('pagehide', leave);
  };
}

/** A page's style sheet that has not loaded yet is waited for no longer than this; past it, it is linked instead. */
const SHEET_WAIT_MS = 3_000;

/** The rules of a loaded sheet of this site as text, every relative `url()` made whole against the sheet's own address. */
export function sheetText(rules: readonly { cssText: string }[], href: string | null): string {
  const text = rules.map((rule) => rule.cssText).join('\n');
  if (!href) return text;
  return text.replace(/url\((['"]?)([^'")]+)\1\)/g, (whole, quote: string, path: string) => {
    if (/^(?:data:|blob:|https?:|\/|#)/i.test(path)) return whole;
    try {
      return `url(${quote}${new URL(path, href).href}${quote})`;
    } catch {
      return whole;
    }
  });
}

/**
 * A Picture-in-Picture window dressed as the city: the page's styles written into it as text — at once, with nothing
 * for that window to fetch, so its contents are never drawn unstyled — and every style the page adds later, when a
 * window's code arrives after it went out; the page's language and its classes. A sheet that cannot be read as text
 * is linked instead. Returns the undo.
 */
function dress(win: Window): () => void {
  const doc = win.document;
  doc.documentElement.lang = document.documentElement.lang || 'en';
  doc.documentElement.className = document.documentElement.className;
  doc.body.className = document.body.className;
  doc.body.style.margin = '0';
  doc.body.style.background = '#09080f';
  const base = doc.createElement('base');
  base.href = document.baseURI;
  doc.head.append(base);
  const link = (node: HTMLLinkElement) => {
    const copy = doc.createElement('link');
    copy.rel = 'stylesheet';
    copy.href = node.href;
    doc.head.append(copy);
  };
  const inline = (node: HTMLLinkElement) => {
    const sheet = node.sheet;
    if (!sheet) return false;
    try {
      const style = doc.createElement('style');
      style.textContent = sheetText([...sheet.cssRules], node.href);
      doc.head.append(style);
      return true;
    } catch {
      return false;
    }
  };
  const copy = (node: Node) => {
    if (node instanceof HTMLStyleElement) doc.head.append(node.cloneNode(true));
    else if (node instanceof HTMLLinkElement && node.rel === 'stylesheet') {
      if (inline(node)) return;
      // Not loaded yet (a window's code arriving after it went out): written in once it has, linked if it never does.
      let done = false;
      const settle = () => {
        if (done) return;
        done = true;
        if (!inline(node)) link(node);
      };
      node.addEventListener('load', settle, { once: true });
      node.addEventListener('error', settle, { once: true });
      setTimeout(settle, SHEET_WAIT_MS);
    }
  };
  document.head.querySelectorAll('style, link[rel="stylesheet"]').forEach(copy);
  const watch = new MutationObserver((records) => records.forEach((record) => record.addedNodes.forEach(copy)));
  watch.observe(document.head, { childList: true });
  return () => watch.disconnect();
}

/** For tests: nothing out, nothing heard. */
export function forgetOutForTests(): void {
  for (const handle of handles.values()) handle.stop?.();
  handles.clear();
  channel?.close();
  channel = null;
  started = false;
}
