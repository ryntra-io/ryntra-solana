"use client";

import { useEffect, useRef, useState } from "react";

import { readResolvedTheme, watchResolvedTheme } from "@/app/app/theme";
import type { WorkspaceLocale } from "@/app/shell/locale";

import styles from "./predictions.module.css";
import { wordsFor } from "./words";

/**
 * The provider's bot check (Cloudflare Turnstile), shown only when a sign-in
 * start answered that it wants one. Cloudflare's script is loaded on that
 * moment and not before, so a page that never meets the check never asks
 * Cloudflare for anything. The box follows the site's theme and the
 * person's language; its token goes straight back into the sign-in, once.
 */

type Turnstile = {
  render(host: HTMLElement, options: Record<string, unknown>): string;
  remove(id: string): void;
};

declare global {
  interface Window {
    turnstile?: Turnstile;
  }
}

const SCRIPT = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
/* A request that neither loads nor fails (a stalling blocker or proxy) would leave the card waiting for ever. */
const LOAD_TIMEOUT_MS = 15_000;
let loading: Promise<Turnstile> | null = null;

function loadTurnstile(): Promise<Turnstile> {
  if (window.turnstile) return Promise.resolve(window.turnstile);
  if (loading) return loading;
  loading = new Promise<Turnstile>((resolve, reject) => {
    const script = document.createElement("script");
    const timer = window.setTimeout(() => {
      script.remove();
      reject(new Error("turnstile did not load in time"));
    }, LOAD_TIMEOUT_MS);
    script.src = SCRIPT;
    script.async = true;
    script.onload = () => {
      window.clearTimeout(timer);
      if (window.turnstile) resolve(window.turnstile);
      else reject(new Error("no turnstile"));
    };
    script.onerror = () => {
      window.clearTimeout(timer);
      reject(new Error("turnstile did not load"));
    };
    document.head.appendChild(script);
  }).catch((error) => {
    /* A failed load can be tried again on the next check. */
    loading = null;
    throw error;
  });
  return loading;
}

/**
 * Cloudflare's own error codes that never pass on a retry, so the person is
 * told at once: 102…–106… a widget set up wrong, 1101…–1105… the key or this
 * site not allowed for it, 200… the box's frame that cannot load. Any other
 * error — 1106… a check that timed out, an expiry, a challenge that failed —
 * Cloudflare retries and refreshes by itself.
 */
const FINAL_ERROR = /^(10[2-6]|110[1-5]|200)/;

export function BotCheck({ siteKey, locale, onToken, onFail }: { siteKey: string; locale: WorkspaceLocale; onToken: (token: string) => void; onFail: (why: "failed" | "blocked") => void }) {
  const word = wordsFor(locale);
  const host = useRef<HTMLDivElement>(null);
  const [shown, setShown] = useState(false);
  /* The box is drawn in the site's theme, and drawn again when the theme changes under it. */
  const [theme, setTheme] = useState<"dark" | "light">(() => readResolvedTheme());
  useEffect(() => watchResolvedTheme(setTheme), []);
  /* The latest handlers, so a parent's re-render does not draw the box again. */
  const handlers = useRef({ onToken, onFail });
  handlers.current = { onToken, onFail };

  useEffect(() => {
    let gone = false;
    let id: string | null = null;
    loadTurnstile()
      .then((turnstile) => {
        if (gone || !host.current) return;
        id = turnstile.render(host.current, {
          sitekey: siteKey,
          theme,
          language: locale === "uk" ? "uk" : "en",
          size: "normal",
          appearance: "always",
          callback: (token: string) => {
            if (!gone) handlers.current.onToken(token);
          },
          retry: "auto",
          "refresh-expired": "auto",
          "refresh-timeout": "auto",
          "error-callback": (code: unknown) => {
            if (gone || !FINAL_ERROR.test(String(code ?? ""))) return false;
            handlers.current.onFail("failed");
            return true;
          },
        });
        setShown(true);
      })
      .catch(() => {
        if (!gone) handlers.current.onFail("blocked");
      });
    return () => {
      gone = true;
      if (id && window.turnstile) window.turnstile.remove(id);
    };
  }, [siteKey, locale, theme]);

  return (
    <div className={styles.botCheck} role="group" aria-label={word("botCheckTitle")}>
      {shown ? null : <p className={styles.muted}>{word("botCheckLoading")}</p>}
      <div ref={host} className={styles.botCheckBox} />
    </div>
  );
}
