"use client";

/**
 * A guest's one way to a wallet, on every page (B14, the B13 review's items 1 and 11).
 *
 * The review found eight wordings of the same act, five shapes of button, gates that drew only a sentence about the
 * missing extension, and form buttons that called `connect(undefined)` and did nothing. There is now one control:
 *
 * - `ConnectWalletButton` — the core's primary `Button`, «Підключити гаманець». It opens the header's own wallet panel,
 *   so the choice among wallets, «Встановити Phantom» when there is none, «Продовжити з …» when there is one, and every
 *   failure are the same panel wherever the press came from. On a phone whose browser carries no wallet the same place
 *   reads «Відкрити в Phantom» and opens this page inside Phantom's browser — the one way on there.
 * - `WalletGate` — the core's `EmptyState` inside the block that will hold the data: one sentence, that button.
 *
 * Nothing here connects a wallet by itself or picks one for the person.
 */

import { Button, EmptyState } from "@ryntra/core/ui";

import { useSolanaConnection } from "./connection.tsx";
import { useSolanaI18n } from "./i18n/provider.tsx";
import styles from "./wallet-gate.module.css";
import { reachAfter, useWalletReach } from "./wallet-reach.ts";

export type ConnectWalletButtonProps = Readonly<{
  /** The pinned action of a form: as wide as its column. */
  block?: boolean;
  className?: string;
  /** Secondary where the screen's one orange action is another (Spot: the ticket's). */
  variant?: "primary" | "secondary";
  /** Runs before the header's panel opens: a sheet above the header closes itself first (`reachAfter`). */
  before?: () => void;
}>;

export function ConnectWalletButton({ block = false, className, before, variant = "primary" }: ConnectWalletButtonProps) {
  const { text, locale } = useSolanaI18n();
  const { connecting } = useSolanaConnection();
  const { openInWallet, reach } = useWalletReach();
  return (
    <Button
      variant={variant}
      icon="wallet"
      block={block}
      className={className}
      loading={connecting}
      onClick={() => reachAfter(before, reach)}
      lang={locale === "uk" ? "uk" : "en"}
      data-connect-wallet=""
    >
      {openInWallet ? text("Open in Phantom") : text("Connect wallet")}
    </Button>
  );
}

export type WalletChoicesProps = Readonly<{
  /**
   * `defer` draws nothing: the surrounding form's own primary button is the connect action. `button` draws the one
   * connect button. Kept for the pages that still name it (other lines' paths); the tiles it once drew live in the
   * header's panel now.
   */
  single: "button" | "defer";
  /** No longer used: a failure is printed in the header's panel, beside the choice that caused it. */
  errorClassName?: string;
}>;

export function WalletChoices({ single }: WalletChoicesProps) {
  const { connection } = useSolanaConnection();
  if (connection || single === "defer") return null;
  return <ConnectWalletButton />;
}

export type WalletGateProps = Readonly<{
  /** What this block shows once a wallet is connected. One sentence, in «ти» — never an explanation of the connection. */
  title: string;
}>;

export function WalletGate({ title }: WalletGateProps) {
  return <EmptyState icon="wallet" text={title} action={<ConnectWalletButton />} className={styles.gate} data-wallet-gate="" />;
}
