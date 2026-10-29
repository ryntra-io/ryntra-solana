"use client";

import { useEffect, useSyncExternalStore, type DetailedHTMLProps, type HTMLAttributes, type ReactNode } from "react";

import { pageTheme, THEME_ATTRIBUTES } from "@/lib/solana/seeker-connect.client";

/**
 * «Connect with Seeker» — Solana Mobile's own button, in the wallet panel on
 * Android (SKR-1).
 *
 * The button is the package's `<seeker-connect-button>`: a Lit element in its
 * own shadow DOM, drawn to Solana Mobile's design (white on a dark page, black
 * on a light one), presentation only — the press is ours and connects the
 * "Seeker Connect" wallet by name, so the phone's wallet opens with no list in
 * between. Until the element is defined its light-DOM text shows, so the panel
 * never has an empty slot.
 */

type SeekerButtonElement = DetailedHTMLProps<HTMLAttributes<HTMLElement>, HTMLElement> & {
  theme?: "light" | "dark";
  variant?: "connect" | "sign-in";
  disabled?: boolean;
};

declare module "react" {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace JSX {
    interface IntrinsicElements {
      "seeker-connect-button": SeekerButtonElement;
    }
  }
}

const LABEL = "Connect with Seeker";

/* The page's theme, followed live: Porcelain is light, Graphite (and anything unset) dark. */
function subscribeTheme(changed: () => void): () => void {
  const observer = new MutationObserver(changed);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: [...THEME_ATTRIBUTES] });
  return () => observer.disconnect();
}

export function SeekerConnectEntry({
  busy,
  onConnect,
  hint,
  children,
}: {
  busy: boolean;
  onConnect: () => void;
  /** A quiet line under the button — after a launch nothing answered. */
  hint?: string | null;
  /** The other ways in on this phone, drawn under the button as secondary actions. */
  children?: ReactNode;
}) {
  const theme = useSyncExternalStore(subscribeTheme, pageTheme, () => "dark" as const);

  useEffect(() => {
    let live = true;
    void import("@solana-mobile/seeker-connect-ui")
      .then((ui) => {
        if (live) ui.defineSeekerConnectElements();
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, []);

  return (
    <div className="rs-menu-featured">
      <seeker-connect-button
        className="rs-menu-featured-button"
        theme={theme}
        variant="connect"
        disabled={busy}
        aria-busy={busy || undefined}
        onClick={() => {
          if (!busy) onConnect();
        }}
      >
        {LABEL}
      </seeker-connect-button>
      {hint ? (
        <p className="rs-menu-hint" role="status">
          {hint}
        </p>
      ) : null}
      {children}
    </div>
  );
}
