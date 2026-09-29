"use client";

import { Check } from "@phosphor-icons/react";

import { useSolanaConnection } from "@/app/solana/workspace/connection";
import { useWalletProof } from "@/app/solana/workspace/wallet-proof";

import { useAccount } from "./account-context";

/**
 * The account, inside the wallet's own panel.
 *
 * The header used to carry two controls — the wallet and a separate *Sign in*
 * that opened the login sheet. Since the Owner's decision of 2026-09-11 the
 * wallet is the account, and on 2026-09-12 the Owner asked for the second
 * control to go: with email and Google shut there is nothing it opens that
 * the wallet does not. So this block sits at the top of the wallet panel:
 *
 *   signed out   one sentence on what signing in opens and one button that
 *                asks the connected wallet for one signature — the same
 *                `signin` the sheet performed — then reloads with `auth=ok`
 *                so the server layout re-reads the session;
 *   signed in    the fact, the way into the account settings, the two ways
 *                out. The wallet stays connected through either.
 *
 * The sheet itself is not deleted: Settings, Alerts and the saved plans still
 * open it in place, where the reason for signing in is on the page.
 */
export function WalletAccountIdentity() {
  const { signedIn, walletAddress, copy, logout, logoutPending } = useAccount();
  const { connection } = useSolanaConnection();
  const proof = useWalletProof();
  const address = connection?.address ?? null;

  if (signedIn) {
    const other = walletAddress && address && walletAddress !== address ? `${walletAddress.slice(0, 4)}…${walletAddress.slice(-4)}` : null;
    return (
      <>
        <p className="rs-menu-body ry-identity-fact">
          <Check size={14} weight="bold" aria-hidden />
          {other ? `${copy.identity.signedInOther} ${other}` : copy.identity.signedIn}
        </p>
        {/* Settings is one row of the menu this block stands in (canon v5.4
            В31), under the address — not a second link here. */}
        <button type="button" className="rs-menu-action" disabled={logoutPending} onClick={() => void logout("this")}>{copy.menu.logout}</button>
        <button type="button" className="rs-menu-action" disabled={logoutPending} onClick={() => void logout("all")}>{copy.menu.logoutAll}</button>
      </>
    );
  }

  /* Nothing to sign with yet: the panel below is already asking to connect. */
  if (!address) return null;

  const signing = proof.state.status === "signing";
  const failure =
    proof.state.status === "refused" || proof.state.status === "failed" || proof.state.status === "unsupported" || proof.state.status === "taken"
      ? copy.identity[proof.state.status]
      : null;

  const signIn = async () => {
    const ok = await proof.signIn();
    if (!ok) return;
    /* The session is server-rendered into the layout; the sheet reloads the
       same way once the cookie is set. */
    const url = new URL(window.location.href);
    url.searchParams.set("auth", "ok");
    window.location.assign(url.href);
  };

  return (
    <>
      <p className="rs-menu-hint">{copy.identity.lead}</p>
      {/* Quiet, not orange: the page under the menu keeps its one orange action (canon §2, rule 1). */}
      <button type="button" className="rs-menu-action" disabled={signing} onClick={() => void signIn()}>
        {signing ? copy.identity.signing : copy.identity.signIn}
      </button>
      {failure ? <p className="rs-menu-hint" role="alert">{failure}</p> : null}
    </>
  );
}
