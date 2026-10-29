/**
 * Registering Seeker Connect, once, in the browser (SKR-1).
 *
 * `wallet.client.ts` already listens to the Wallet Standard registry, so the
 * whole integration is one `registerSeekerConnect` call: after it "Seeker
 * Connect" is a wallet like any other there — listed, restored silently and
 * asked only for `solana:signTransaction`, never for sign-and-send.
 *
 * The package is imported dynamically, and only on Android. Its UI is Lit
 * custom elements that need a DOM, so a static import would run on the server
 * with every client component that renders there; and on a computer there is
 * no Seeker to answer, so registering it there would only put a wallet that
 * cannot connect at the top of Phantom's list.
 *
 * Its progress overlay and error dialog are its own, in the page's theme. One
 * dialog is left out: `association-failed` — nothing answered the launch —
 * is a quiet line in the wallet panel instead (`connection.tsx`), with the
 * other wallets beside it.
 *
 * Registered is not offered. The package's first connect opens Solana
 * Mobile's App Link (`connect.solanamobile.com`): on a Seeker the wallet takes
 * it, on any other Android phone the tab is sent to that page instead. So the
 * wallet lists show Seeker Connect only where a Seeker is likely — the phone
 * names itself one (the `model` client hint), or a Seeker authorization is
 * already cached here, which only a Seeker's wallet can have made. Elsewhere
 * on Android the panel keeps Phantom first and offers Seeker as a quiet row.
 */
import type { SeekerConnectPresenter } from "@solana-mobile/seeker-connect-wallet-standard";

import { sendEvent } from "../analytics.ts";
import { isAndroidUserAgent, SEEKER_CHAIN, seekerConnectEvent, seekerFailureCode, seekerRelayDomain, type SeekerConnectEvent, type SeekerFailureCode } from "./seeker-connect.ts";

type SeekerPackage = Readonly<{
  registerSeekerConnect: (options: {
    identity: { name: string; uri: string; icon?: string };
    relayDomain: string;
    chain?: string;
    presenter?: SeekerConnectPresenter;
  }) => unknown;
}>;
type SeekerUi = Readonly<{
  createSeekerConnectPresenter: (options?: { theme?: "light" | "dark" }) => SeekerConnectPresenter;
}>;

export type SeekerRegistrationDeps = Readonly<{
  userAgent: () => string | undefined;
  likely: () => Promise<boolean>;
  origin: () => string;
  load: () => Promise<SeekerPackage>;
  loadUi: () => Promise<SeekerUi>;
}>;

const DEFAULTS: SeekerRegistrationDeps = {
  userAgent: () => window.navigator?.userAgent,
  likely: () =>
    looksLikeSeeker({
      storage: () => window.localStorage.getItem(SEEKER_ANSWERED_KEY) ?? window.localStorage.getItem(SEEKER_AUTHORIZATION_KEY),
      hints: (window.navigator as Navigator & { userAgentData?: ModelHints }).userAgentData,
      userAgent: window.navigator?.userAgent,
    }),
  origin: () => window.location.origin,
  load: () => import("@solana-mobile/seeker-connect-wallet-standard") as Promise<SeekerPackage>,
  loadUi: () => import("@solana-mobile/seeker-connect-ui") as Promise<SeekerUi>,
};

/**
 * The page's own theme — Graphite is dark, Porcelain light — read at each
 * interaction. The cabinet names the look (`data-theme="porcelain"`) and the
 * scheme beside it (`data-ry-theme="light"`); the site names the scheme alone.
 */
export const THEME_ATTRIBUTES = ["data-ry-theme", "data-theme"] as const;
export function pageTheme(): "light" | "dark" {
  if (typeof document === "undefined") return "dark";
  const root = document.documentElement;
  const scheme = root.getAttribute("data-ry-theme") ?? root.getAttribute("data-theme");
  return scheme === "light" || scheme === "porcelain" ? "light" : "dark";
}

/** The package's overlay and dialogs, in the page's theme, without the dialog for a launch nothing answered. */
export function pagePresenter(ui: SeekerUi, theme: () => "light" | "dark" = pageTheme): SeekerConnectPresenter {
  return {
    interactionStarted: (cancel) => ui.createSeekerConnectPresenter({ theme: theme() }).interactionStarted(cancel),
    interactionFailed: (error) => {
      if (seekerFailureCode(error) === "association-failed") return;
      ui.createSeekerConnectPresenter({ theme: theme() }).interactionFailed(error);
    },
  };
}

let registration: Promise<boolean> | null = null;
let likely = false;
const likelyListeners = new Set<() => void>();

/** The package's own `localStorage` key for the authorization it caches. */
export const SEEKER_AUTHORIZATION_KEY = "SeekerConnectAuthorizationCache";

/** Whether this browser is, as far as can be told, on a Seeker. */
export function seekerLikely(): boolean {
  return likely;
}

/** Be told when that changes (once, from false to true). */
export function onSeekerLikely(listener: () => void): () => void {
  likelyListeners.add(listener);
  return () => {
    likelyListeners.delete(listener);
  };
}

/**
 * Ryntra's own note that a Seeker's wallet answered in this browser. It
 * outlives Disconnect, which clears the package's cache, so a Seeker that
 * disconnected is still offered first after a reload.
 */
export const SEEKER_ANSWERED_KEY = "ryntra.seeker.answered.v1";

/** A Seeker answered here — the wallet connected — so it is offered from now on. */
export function markSeekerLikely(): void {
  try {
    window.localStorage.setItem(SEEKER_ANSWERED_KEY, "1");
  } catch {
    /* Not remembering means the quiet row after a reload, never a broken page. */
  }
  if (likely) return;
  likely = true;
  for (const listener of likelyListeners) listener();
}

type ModelHints = { getHighEntropyValues?: (hints: string[]) => Promise<{ model?: string }> };

/** The phone's own word for what it is: a cached Seeker authorization, the model hint, the user agent. */
export async function looksLikeSeeker(env: Readonly<{ storage?: () => string | null; hints?: ModelHints; userAgent?: string }>): Promise<boolean> {
  try {
    if (env.storage?.()) return true;
  } catch {
    /* A browser with site data blocked has no cache to read. */
  }
  try {
    const values = await env.hints?.getHighEntropyValues?.(["model"]);
    if (/\bseeker\b/i.test(values?.model ?? "")) return true;
  } catch {
    /* No client hints in this browser. */
  }
  return /\bseeker\b/i.test(env.userAgent ?? "");
}

/**
 * Register Seeker Connect with the Wallet Standard registry, at most once per
 * page. Resolves `true` when it registered, `false` when this browser is not
 * one a Seeker wallet can answer in (or the package failed to load — then the
 * other wallets are simply all there is, as before).
 */
export function registerSeekerConnectOnce(overrides: Partial<SeekerRegistrationDeps> = {}): Promise<boolean> {
  if (registration) return registration;
  if (typeof window === "undefined") return Promise.resolve(false);
  const deps: SeekerRegistrationDeps = { ...DEFAULTS, ...overrides };
  if (!isAndroidUserAgent(deps.userAgent())) {
    registration = Promise.resolve(false);
    return registration;
  }
  registration = (async () => {
    try {
      const [seeker, ui] = await Promise.all([deps.load(), deps.loadUi()]);
      seeker.registerSeekerConnect({
        /* What the Seeker wallet shows on its consent screen: our name, this
           exact origin, and the mark — the icon path is resolved against the
           origin. */
        identity: { name: "Ryntra", uri: deps.origin(), icon: "/brand/icon-192.png" },
        relayDomain: seekerRelayDomain(),
        chain: SEEKER_CHAIN,
        presenter: pagePresenter(ui),
      });
      void deps
        .likely()
        .then((seeker) => {
          if (seeker) markSeekerLikely();
        })
        .catch(() => undefined);
      return true;
    } catch {
      return false;
    }
  })();
  return registration;
}

let countSink: (event: SeekerConnectEvent) => void = sendEvent;

/**
 * Count one «Connect with Seeker» — worked, cancelled or did not connect
 * (`seekerConnectEvent`). Fire and forget: the count never delays or breaks
 * the connect it describes.
 */
export function countSeekerConnect(result: Readonly<{ ok: boolean; state?: string; code?: SeekerFailureCode }>): void {
  try {
    countSink(
      seekerConnectEvent(result, {
        pathname: typeof window === "undefined" ? null : window.location?.pathname,
        locale: typeof document === "undefined" ? null : document.documentElement.lang,
      }),
    );
  } catch {
    /* A count that failed is a count missing, never a connect that failed. */
  }
}

/** Tests only: where the count goes instead of `/api/track`. */
export function setSeekerCountSinkForTests(sink: ((event: SeekerConnectEvent) => void) | null): void {
  countSink = sink ?? sendEvent;
}

/** Tests only: forget the registration so the next call registers again. */
export function resetSeekerRegistrationForTests(): void {
  registration = null;
  likely = false;
}
