"use client";

import { CheckMark, ExternalMark } from "@/app/components/mark";
import { InfoControl } from "@/app/shell/info-control";
import { useStellarWallet } from "./stellar-wallet-provider.tsx";

/**
 * The wallet control in the top bar.
 *
 * It shows one state at a time and offers the one action that state allows —
 * never a button that cannot work. A disabled connect button beside "Freighter
 * is not installed" makes a person press it to find out why; an install link
 * answers the question the state already asked.
 *
 * The explanation for every state lives in the info control beside it, so the
 * bar carries a status and an action rather than a paragraph.
 */

/** `GABC…WXYZ`. The full address belongs on a page, not in a top bar. */
function shorten(address: string): string {
  return `${address.slice(0, 4)}…${address.slice(-4)}`;
}

export function ConnectWalletButton() {
  const { state, copy, address, walletName, installUrl, expectedNetwork, connect, disconnect } =
    useStellarWallet();

  const busy = state === "CONNECTING" || state === "SIGNING";

  return (
    <div className="st-wallet" data-state={state}>
      {address && state === "CONNECTED" ? (
        <>
          <span className="st-wallet-addr" translate="no">
            <CheckMark size={12} />
            {shorten(address)}
          </span>
          <button type="button" className="st-wallet-btn" onClick={() => void disconnect()}>
            Disconnect
          </button>
        </>
      ) : state === "NOT_INSTALLED" ? (
        <a className="st-wallet-btn" href={installUrl} target="_blank" rel="noreferrer">
          Install {walletName}
          <ExternalMark size={12} />
        </a>
      ) : (
        <button
          type="button"
          className="st-wallet-btn"
          onClick={() => void connect()}
          disabled={busy}
          data-tone={state === "WRONG_NETWORK" ? "caution" : undefined}
        >
          {busy ? "Waiting for the wallet…" : (copy.action ?? `Connect ${walletName}`)}
        </button>
      )}

      <InfoControl label={copy.title}>
        <p>
          <strong>{copy.title}.</strong> {copy.body}
        </p>
        <p>
          This workspace expects <strong>{expectedNetwork}</strong>. Ryntra never receives a key, never signs on
          your behalf, and a signature is never a submission.
        </p>
      </InfoControl>
    </div>
  );
}
