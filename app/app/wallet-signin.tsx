"use client";

import { useWalletConnect } from "./wallet-connect";

/**
 * Sign in — or link — with a wallet, as a button.
 *
 * The flow itself lives in `useWalletConnect`, shared with the cabinet's
 * connection control. This file is presentation: a button, its three labels,
 * and the connector's refusal shown as a sentence rather than a numbered code.
 * A wallet returns a numbered rejection for "the person closed the prompt",
 * which is not an error anyone needs reflected back at them — the hook maps it
 * to `null` and nothing is shown.
 */
export function WalletSignIn({
  action = "signin",
  label,
  className = "btn btn-ghost btn-sm",
  onLinked,
}: {
  /** `signin` mints a session; `link` binds the address to the current account. */
  action?: "signin" | "link";
  label?: string;
  className?: string;
  onLinked?: (wallet: string) => void;
}) {
  const { busy, error, done, run } = useWalletConnect(action, onLinked);

  const text = label ?? (action === "link" ? "Link this wallet" : "Sign in with wallet");

  return (
    <>
      <button type="button" className={className} disabled={busy || done} onClick={() => void run()}>
        {done ? "Wallet linked" : busy ? "Check your wallet…" : text}
      </button>
      {error ? <p className="cb-visitor-fine" role="alert">{error}</p> : null}
    </>
  );
}
