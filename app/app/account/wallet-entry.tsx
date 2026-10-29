"use client";

import { useState } from "react";
import { useSolanaConnection } from "@/app/solana/workspace/connection";
import { ConnectWalletButton } from "@/app/solana/workspace/wallet-gate";
import { useWalletProof } from "@/app/solana/workspace/wallet-proof";
import { useAccount } from "./account-context";

const COPY = {
  en: { connect: "Connect a wallet", choose: "Choose your Solana wallet", absent: "Open this page in a supported wallet browser or enable your wallet extension.",
    consent: "Sign in with your wallet. The first signature creates your Ryntra account; the same signature opens it later. It moves no funds and allows no trading on your behalf.",
    linkConsent: "Link this wallet to your current Ryntra account as a second key. Your saved plans stay here. This does not give Ryntra permission to trade.",
    sign: "Confirm sign-in", link: "Confirm wallet link", signing: "Confirm the message in your wallet…", linked: "Wallet linked. It opens this account too.",
    refused: "Sign-in was cancelled. You can still view public quotes.", failed: "Sign-in could not be completed. Try again with the connected wallet.",
    unsupported: "This wallet cannot sign a sign-in message. Choose another supported wallet.", taken: "This wallet belongs to another account. No data was moved.",
    connecting: "Connecting…", connected: "Connected wallet", change: "Choose another wallet", expires: "Sign-in is reused while this session is valid." },
  uk: { connect: "Підключити гаманець", choose: "Вибери гаманець Solana", absent: "Відкрий сторінку в браузері підтримуваного гаманця або увімкни його розширення.",
    consent: "Увійди гаманцем. Перший підпис створює твій акаунт Ryntra; той самий підпис відкриває його надалі. Він не переміщує кошти й не дозволяє торгувати від твого імені.",
    linkConsent: "Прив’яжи цей гаманець до поточного акаунта Ryntra як другий ключ. Збережені плани залишаться тут. Це не дає Ryntra дозволу торгувати.",
    sign: "Підтвердити вхід", link: "Підтвердити прив’язку", signing: "Підтверди повідомлення в гаманці…", linked: "Гаманець прив’язано. Він теж відкриває цей акаунт.",
    refused: "Вхід скасовано. Публічні котирування залишаються доступними.", failed: "Не вдалося виконати вхід. Спробуй ще раз із підключеним гаманцем.",
    unsupported: "Цей гаманець не підтримує підпис повідомлення для входу. Вибери інший підтримуваний гаманець.", taken: "Цей гаманець належить іншому акаунту. Дані не перенесено.",
    connecting: "Підключення…", connected: "Підключений гаманець", change: "Вибрати інший гаманець", expires: "Вхід діє на всіх сторінках, доки сесія чинна." },
} as const;

export function WalletEntry({ mode = "signin", onSuccess }: { mode?: "signin" | "link"; onSuccess: () => void }) {
  const { locale } = useAccount();
  const c = locale === "uk" ? COPY.uk : COPY.en;
  const { wallets, connection, connect, connecting, errorKind } = useSolanaConnection();
  const proof = useWalletProof();
  const [choose, setChoose] = useState(false);
  const [linked, setLinked] = useState(false);
  const working = proof.state.status === "signing" || connecting;
  const error = ["refused", "failed", "unsupported", "taken"].includes(proof.state.status)
    ? c[proof.state.status as "refused" | "failed" | "unsupported" | "taken"] : errorKind ? (errorKind === "REFUSED" ? c.refused : c.failed) : null;
  const confirm = async () => {
    const success = await (mode === "link" ? proof.link() : proof.signIn());
    if (success) { setLinked(mode === "link"); onSuccess(); }
  };
  return <div className="ry-wallet-entry">
    <p className="ry-login-lead">{mode === "link" ? c.linkConsent : c.consent}</p>
    {(!connection || choose) ? <div className="ry-account-actions" aria-label={c.choose}>
      {/* No wallet in this browser: the one button (B14) — the header's panel to install one, Phantom's browser on a phone. */}
      {wallets.length === 0 ? <><p className="ry-muted">{c.absent}</p><ConnectWalletButton /></> : wallets.map((wallet) =>
        <button key={wallet.name} type="button" className="rw-btn" disabled={working} onClick={async () => { await connect(wallet.name); setChoose(false); }}>
          {connecting ? c.connecting : `${c.connect} · ${wallet.name}`}
        </button>)}
    </div> : <>
      <p className="ry-muted">{c.connected}: {connection.wallet} · {connection.address.slice(0, 6)}…{connection.address.slice(-4)}</p>
      <button type="button" className="rw-btn" data-variant="primary" disabled={working} onClick={() => void confirm()}>
        {working ? c.signing : mode === "link" ? c.link : c.sign}
      </button>
      {mode === "signin" ? <button type="button" className="ry-action-link" disabled={working} onClick={() => setChoose(true)}>{c.change}</button> : null}
    </>}
    {error ? <p className="ry-login-error" role="alert">{error}</p> : null}
    {linked ? <p role="status">{c.linked}</p> : null}
    <p className="ry-muted">{c.expires}</p>
  </div>;
}
