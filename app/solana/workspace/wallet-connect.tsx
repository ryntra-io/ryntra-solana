"use client";

/**
 * The one way a money form asks for a wallet.
 *
 * There was already exactly one connection *implementation* — the provider in
 * `connection.tsx`, mounted once in the layout. What there were five of was
 * *entry points*, with three different behaviours, and that is what a person
 * hit: the control in the shell header offered a choice and named its failures,
 * while the control inside Send and Swap silently picked a wallet for you and
 * then said nothing at all when that wallet did not answer.
 *
 * Two defects sat behind that, and both are the kind that only appear on a real
 * machine:
 *
 * 1. **The cards auto-picked.** `connect(wallets[0]?.name)` consumes the
 *    detector's ranking as if it were a decision. The scores tie whenever no
 *    wallet has yet exposed a Solana account — the ordinary state of a browser
 *    that has just loaded — and the tiebreak is alphabetical. With Backpack and
 *    Phantom both installed, the card reaches past the one in the toolbar for
 *    the one that sorts first.
 *
 * 2. **The cards never read `error`.** Neither Send nor Swap destructured it,
 *    so a refusal, a wallet already holding an unanswered popup, or a wallet
 *    that simply is not the one you meant produced no visible change whatsoever.
 *    A button that does nothing and explains nothing is a broken button, whether
 *    or not the code beneath it ran.
 *
 * So: with more than one wallet the person chooses, exactly as the header lets
 * them. With one there is nothing to choose and the card's own primary button
 * connects it. With none there is a sentence saying so. And in every case a
 * failure is printed next to the control that caused it, rather than in a panel
 * in the opposite corner of the screen.
 *
 * The choice itself now lives in `WalletChoices`, so the tiles a person sees
 * inside the Send, Swap and Bridge forms are the same tiles the full-screen
 * gate shows on Holdings, Receive and Receipts. A wallet picker that looks like
 * two different products depending on which screen you reached it from is one
 * of the things this file was written to stop.
 */

import { useSolanaConnection } from "./connection.tsx";
import { useSolanaI18n } from "./i18n/provider.tsx";
import { WalletChoices } from "./wallet-gate.tsx";

export type WalletConnectRowProps = Readonly<{
  /** Class for the explanatory sentence, so each card keeps its own type scale. */
  hintClassName?: string;
  /** Class for a failure line, so each card keeps its own error treatment. */
  errorClassName?: string;
}>;

export function WalletConnectRow({ hintClassName, errorClassName }: WalletConnectRowProps) {
  const { text } = useSolanaI18n();
  const { wallets, connection } = useSolanaConnection();

  if (connection) return null;

  return (
    <>
      {wallets.length === 0 ? (
        <p className={hintClassName}>
          <b>{text("No Solana wallet detected")}</b>{" "}
          {text("Install Phantom, Solflare or Backpack to connect. You can look around without one.")}
        </p>
      ) : null}

      {/* `defer`: with exactly one wallet there is nothing to choose, so no
          control is drawn here and the card's own primary button connects it.
          With several, the tiles are the choice and the card's button is not
          rendered at all. */}
      <WalletChoices single="defer" errorClassName={errorClassName} />
    </>
  );
}
