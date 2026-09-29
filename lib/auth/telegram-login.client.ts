/**
 * Telegram Login in the browser — the popup that hands the page an ID token.
 *
 * The official library (`telegram-login.js`) opens a window on
 * oauth.telegram.org, runs the authorization there and posts the resulting
 * ID token back to this page. The page then gives the token to the product's
 * `/api/auth/telegram`, which has Supabase verify it. Nothing here trusts the
 * token: the browser is a courier.
 *
 * The library is loaded on demand and only while the Telegram door is open,
 * so a visitor who never presses the button never talks to Telegram.
 */

export const TELEGRAM_LOGIN_LIBRARY = "https://oauth.telegram.org/js/telegram-login.js?6";

export type TelegramLoginResult = Readonly<{ id_token?: string; user?: unknown; error?: string }>;

export type TelegramLoginOptions = Readonly<{
  client_id: number;
  scope?: readonly string[];
  nonce?: string;
  lang?: string;
}>;

export type TelegramLoginApi = Readonly<{
  auth: (options: TelegramLoginOptions, callback: (result: TelegramLoginResult) => void) => void;
  close?: () => void;
}>;

declare global {
  interface Window {
    Telegram?: { Login?: TelegramLoginApi };
  }
}

let loading: Promise<TelegramLoginApi | null> | null = null;

/** The library, loaded once; `null` when it cannot be loaded (offline, blocked). */
export function loadTelegramLogin(): Promise<TelegramLoginApi | null> {
  if (typeof window === "undefined") return Promise.resolve(null);
  const present = window.Telegram?.Login;
  if (present) return Promise.resolve(present);
  if (!loading) {
    loading = new Promise((resolve) => {
      const script = document.createElement("script");
      script.src = TELEGRAM_LOGIN_LIBRARY;
      script.async = true;
      script.onload = () => resolve(window.Telegram?.Login ?? null);
      script.onerror = () => {
        loading = null;
        resolve(null);
      };
      document.head.appendChild(script);
    });
  }
  return loading;
}

/** The library if it is already on the page — the popup must open in the click that asked for it. */
export function telegramLoginApi(): TelegramLoginApi | null {
  return typeof window === "undefined" ? null : (window.Telegram?.Login ?? null);
}
