"use client";

/**
 * The wallet choice, and the whole screen built around it.
 *
 * `WalletConnectRow` already made the *behaviour* correct: one connection
 * implementation, no auto-picking, a failure printed beside the control that
 * caused it. What it could not fix is that each card pasted that row into the
 * top-left corner of a panel and left the rest of the screen empty. Measured on
 * the rendered page, Holdings was 419x259 of content inside a 2234x708 body.
 * Three of the product's first screens were mostly void, and the first thing a
 * person met was a list of grey buttons under a sentence.
 *
 * Two exports, one vocabulary:
 *
 * - `WalletChoices` is the choice itself, and it is the same tiles wherever it
 *   appears — inside the Send, Swap and Bridge forms as well as here.
 * - `WalletGate` is the whole screen for a surface that has nothing to show
 *   without a wallet: Holdings, Receive, Receipts. Centred on both axes, which
 *   is what makes the emptiness read as composition rather than as an
 *   unfinished page.
 *
 * **One line, not a paragraph.** The gate's line says what the screen will show
 * once a wallet is connected. Nothing here explains Solana, wallets, or what
 * connecting does.
 *
 * **No dead control.** The cards used to render a disabled `Choose a wallet
 * above` whose only job was to point at another control. Where the tiles are on
 * screen, they are the action, and the button that pointed at them is gone.
 *
 * The pending wallet is tracked here rather than read from the provider's
 * `connecting` flag alone, because the flag cannot say *which* tile was
 * pressed — and a row of four tiles that all dim together tells somebody their
 * click went nowhere in particular.
 */

import { useEffect, useState } from "react";

import { isPhoneUserAgent, phantomBrowseUrl } from "@/lib/solana/open-in-wallet";

import { useSolanaConnection } from "./connection.tsx";
import { useSolanaI18n } from "./i18n/provider.tsx";
import styles from "./wallet-gate.module.css";

export type WalletChoicesProps = Readonly<{
  /**
   * What to do when exactly one wallet is detected and there is nothing to
   * choose. `button` renders the connecting control; `defer` renders nothing,
   * because the surrounding card's own primary button already connects it.
   */
  single: "button" | "defer";
  /** Class for a failure line, so a card keeps its own error treatment. */
  errorClassName?: string;
}>;

export function WalletChoices({ single, errorClassName }: WalletChoicesProps) {
  const { text } = useSolanaI18n();
  const { wallets, connecting, error, connect } = useSolanaConnection();
  const [pending, setPending] = useState<string | null>(null);

  const start = (name: string) => {
    setPending(name);
    void connect(name);
  };

  const only = wallets.length === 1 ? wallets[0] : null;

  return (
    <>
      {only && single === "button" ? (
        <button
          className={styles.cta}
          type="button"
          onClick={() => start(only.name)}
          disabled={connecting}
        >
          {only.icon ? (
            /* The wallet hands its icon over as a data URI, so there is no
               remote file for `next/image` to optimize. */
            // eslint-disable-next-line @next/next/no-img-element
            <img className={styles.ctaIcon} src={only.icon} alt="" width={20} height={20} />
          ) : null}
          {connecting ? text("Opening…") : `${text("Continue with")} ${only.name}`}
        </button>
      ) : null}

      {wallets.length > 1 ? (
        <div className={styles.choices}>
          {wallets.map((wallet) => (
            <button
              key={wallet.name}
              className={styles.tile}
              type="button"
              onClick={() => start(wallet.name)}
              disabled={connecting}
            >
              {wallet.icon ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img className={styles.tileIcon} src={wallet.icon} alt="" width={28} height={28} />
              ) : null}
              {connecting && pending === wallet.name ? text("Opening…") : wallet.name}
            </button>
          ))}
        </div>
      ) : null}

      {error ? <p className={errorClassName ?? styles.error}>{error}</p> : null}
    </>
  );
}

export type WalletGateProps = Readonly<{
  /**
   * What this screen shows once a wallet is connected. One sentence, concrete,
   * in the product's own voice — never an explanation of the connection.
   */
  title: string;
}>;

export function WalletGate({ title }: WalletGateProps) {
  const { text } = useSolanaI18n();
  const { wallets } = useSolanaConnection();
  /* A phone's browser carries no wallet: the way on is this page inside
     Phantom's own browser (RYN-INVEST-SIMPLE-001, session 5). Read after mount
     — the server does not know the device. */
  const [phone, setPhone] = useState(false);
  useEffect(() => {
    setPhone(isPhoneUserAgent(window.navigator.userAgent));
  }, []);

  return (
    <div className={styles.gate}>
      <p className={styles.title}>{title}</p>

      {wallets.length === 0 && phone ? (
        <>
          <p className={styles.none}>
            <span className={styles.noneLead}>{text("No wallet in this browser")}</span>
            <span>{text("On a phone, Ryntra opens inside your wallet app.")}</span>
          </p>
          <button className={styles.cta} type="button" onClick={() => window.location.assign(phantomBrowseUrl(window.location.href, window.location.origin))}>
            {text("Open in Phantom")}
          </button>
        </>
      ) : wallets.length === 0 ? (
        <p className={styles.none}>
          <span className={styles.noneLead}>{text("No Solana wallet in this browser.")}</span>
          <span>{text("Phantom, Solflare and Backpack all work.")}</span>
        </p>
      ) : null}

      <WalletChoices single="button" />
    </div>
  );
}
