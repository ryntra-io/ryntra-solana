"use client";

/**
 * Receive — an address somebody can pay, and a request for an exact amount.
 *
 * Two modes, because they are two different jobs and folding them into one
 * screen is how both get worse. "My address" is the thing a person needs
 * ninety percent of the time and it should be one glance and one tap. "Request
 * a payment" is an invoice: a token, an amount, a note, how long it stays
 * valid — and it is a normal link. The person being asked opens
 * `https://ryntra.io/pay/<id>` in any browser and sees what they are paying
 * for, whether it has been paid, and two ways to pay.
 *
 * The request form is a form, not a column squeezed beside an empty QR slot:
 * four fields in two rows, one primary action, and the proof-of-ownership
 * step stated as the step it is. What is deliberately not on this screen: the
 * reference public key, the mint address, the `solana:` URI and any
 * explanation of Solana Pay. A person asking for money does not need to learn
 * a protocol, and every one of those is available under Details.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import QRCode from "qrcode";
import { Wallet } from "@phosphor-icons/react";
import { NAV_WORDS } from "@ryntra/core/nav";
import { Button } from "@ryntra/core/ui";

import { PAYMENT_DESCRIPTION_MAX, PAYMENT_EXPIRATIONS, type PaymentExpiration } from "@/lib/pay/model";
import { displayAmount } from "@/lib/solana/amounts";
import { buildSolanaPayUrl } from "@/lib/solana/payment-request";
import { NATIVE_SOL_DECIMALS } from "@/lib/solana/send-kinds";
import { SOLANA_USDC_MINT } from "@/lib/swap/catalog";
import { useSolanaConnection } from "../connection.tsx";
import { useSolanaI18n } from "../i18n/provider.tsx";
import { useWalletProof } from "../wallet-proof.tsx";
import { ConnectWalletButton } from "../wallet-gate.tsx";
import { NetworkMark } from "../money/marks.tsx";
import { MoneyAction, MoneyCard, MoneyPage } from "../money/money-page.tsx";
import { PaymentRequests } from "../money/payment-requests.tsx";
import { RecentTransfers } from "../money/recent-transfers.tsx";
import styles from "./receive.module.css";
import { ensureWalletActs } from "@/lib/account/wallet-proof-store.client";

type Holding = Readonly<{
  kind?: "NATIVE_SOL" | "TOKEN";
  mint: string | null;
  amountRaw: string;
  spendableRaw: string;
  decimals: number;
  symbol: string | null;
  name: string | null;
}>;

type Mode = "ADDRESS" | "REQUEST";

type Created = Readonly<{
  id: string;
  url: string;
  payUrl: string | null;
  reference: string;
  mint: string | null;
  symbol: string;
  amountDisplay: string | null;
  description: string | null;
  expiresAt: string;
}>;

const EXPIRATION_WORDS: Readonly<Record<PaymentExpiration, string>> = {
  "1h": "1 hour",
  "24h": "24 hours",
  "7d": "7 days",
  "30d": "30 days",
};

function tickerOf(holding: Holding, fallback: string): string {
  return holding.symbol?.trim() || holding.name?.trim() || fallback;
}

export function ReceiveCard() {
  const { text, locale } = useSolanaI18n();
  const { connection } = useSolanaConnection();
  const proof = useWalletProof();

  const [mode, setMode] = useState<Mode>("ADDRESS");
  const [holdings, setHoldings] = useState<readonly Holding[]>([]);
  /* Dollars first, as on «Надіслати» (B18); SOL where the wallet holds no USDC. */
  const [assetKey, setAssetKey] = useState<string>(SOLANA_USDC_MINT);
  const [amount, setAmount] = useState("");
  const [description, setDescription] = useState("");
  const [expiration, setExpiration] = useState<PaymentExpiration>("7d");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [created, setCreated] = useState<Created | null>(null);
  const [qr, setQr] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [advanced, setAdvanced] = useState(false);
  /* Bumped when a request is created, so «Запити на оплату» beside the form reads the list again. */
  const [requestsVersion, setRequestsVersion] = useState(0);

  const address = connection?.address ?? null;

  /* Balances are only read to name what a person can be paid in. A request for
     a token the wallet has never held is still perfectly valid, which is why
     SOL is always offered and the rest are additions rather than a filter. */
  useEffect(() => {
    if (!address) {
      setHoldings([]);
      return;
    }
    let live = true;
    void (async () => {
      try {
        const response = await fetch("/api/solana/holdings", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ owner: address, network: "mainnet" }),
        });
        if (!response.ok) return;
        const payload = (await response.json()) as { data?: { holdings?: readonly Holding[] } };
        if (live) setHoldings(payload.data?.holdings ?? []);
      } catch {
        /* A request can still be made without a balance list. */
      }
    })();
    return () => {
      live = false;
    };
  }, [address]);

  /* A new wallet means somebody else's requests; nothing from the last one carries over. */
  useEffect(() => {
    setCreated(null);
    setCreateError(null);
  }, [address]);

  const assets = useMemo(() => {
    const rows = holdings.filter((holding) => holding.kind !== "NATIVE_SOL" && holding.mint !== null);
    return [
      { key: "SOL", mint: null as string | null, decimals: NATIVE_SOL_DECIMALS, ticker: "SOL" },
      ...rows.map((holding) => ({
        key: holding.mint as string,
        mint: holding.mint,
        decimals: holding.decimals,
        ticker: tickerOf(holding, `${(holding.mint as string).slice(0, 4)}…`),
      })),
    ];
  }, [holdings]);

  const asset = assets.find((entry) => entry.key === assetKey) ?? assets[0];

  /* The address mode's scannable link; the request mode's link comes from the server. */
  const addressUrl = useMemo(() => {
    if (!address) return null;
    const built = buildSolanaPayUrl({ recipient: address });
    return built.ok ? built.url : null;
  }, [address]);

  /* What the code carries: the bare address in «Моя адреса» — every wallet's and exchange's scanner reads it, while
     Phantom's refuses a `solana:` link (decision of 2026-09-07; «Поповнити» draws its code the same way, B18) — and
     the payment page's own link for a request. The `solana:` link stays under «Деталі». */
  const qrValue = mode === "ADDRESS" ? address : (created?.url ?? null);

  useEffect(() => {
    if (!qrValue) {
      setQr(null);
      return;
    }
    let live = true;
    void QRCode.toDataURL(qrValue, { errorCorrectionLevel: "M", margin: 1, width: 512 })
      .then((data) => {
        if (live) setQr(data);
      })
      .catch(() => {
        if (live) setQr(null);
      });
    return () => {
      live = false;
    };
  }, [qrValue]);

  const copy = useCallback(async (value: string, what: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(what);
      window.setTimeout(() => setCopied(null), 2_000);
    } catch {
      setCopied(null);
    }
  }, []);

  /* What «Поділитися» hands on: the address itself — what a person pastes into a wallet — or the payment page's link. */
  const shareValue = mode === "ADDRESS" ? address : (created?.url ?? null);
  const share = useCallback(async () => {
    if (!shareValue) return;
    /* `navigator.share` is the native sheet on a phone and absent on most
       desktops. Falling back to the clipboard is the honest substitute; a
       button that silently does nothing on a laptop is not. */
    if (typeof navigator.share === "function") {
      try {
        await navigator.share(mode === "REQUEST" ? { url: shareValue } : { text: shareValue });
        return;
      } catch {
        /* Dismissing the sheet is an ordinary answer, not a failure. */
        return;
      }
    }
    await copy(shareValue, "link");
  }, [copy, mode, shareValue]);

  const create = useCallback(async () => {
    if (!address || creating || proof.state.status !== "proven") return;
    setCreating(true);
    setCreateError(null);
    try {
      /* A request is a write: a wallet linked to an email account signs once for it (decision 62). */
      if (!(await ensureWalletActs())) return;
      const response = await fetch("/api/pay/requests", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          mint: asset?.mint ?? null,
          amount: amount.trim() === "" ? null : amount.trim(),
          description: description.trim() === "" ? null : description.trim(),
          expiration,
        }),
      });
      const payload = (await response.json().catch(() => ({}))) as {
        ok?: boolean;
        id?: string;
        url?: string;
        payUrl?: string | null;
        message?: string;
        request?: { reference: string; token: { symbol: string; mint: string | null }; amount: { display: string } | null; description: string | null; expiresAt: string };
      };
      if (!response.ok || !payload.ok || !payload.id || !payload.url || !payload.request) {
        setCreateError(payload.message ?? text("The payment link could not be created."));
        return;
      }
      setRequestsVersion((value) => value + 1);
      setCreated({
        id: payload.id,
        url: payload.url,
        payUrl: payload.payUrl ?? null,
        reference: payload.request.reference,
        mint: payload.request.token.mint,
        symbol: payload.request.token.symbol,
        amountDisplay: payload.request.amount?.display ?? null,
        description: payload.request.description,
        expiresAt: payload.request.expiresAt,
      });
    } catch {
      setCreateError(text("The payment link could not be created."));
    } finally {
      setCreating(false);
    }
  }, [address, amount, asset, creating, description, expiration, proof.state.status, text]);

  const balanceOf = (key: string) => {
    const holding =
      key === "SOL"
        ? holdings.find((entry) => entry.kind === "NATIVE_SOL")
        : holdings.find((entry) => entry.mint === key);
    return holding ? displayAmount(holding.amountRaw, holding.decimals) : null;
  };

  const proven = proof.state.status === "proven";
  const signing = proof.state.status === "signing" || proof.state.status === "checking";
  const proofProblem =
    proof.state.status === "refused" || proof.state.status === "failed" || proof.state.status === "unsupported" || proof.state.status === "taken"
      ? proof.state.reason
      : null;

  const whenValid = (iso: string) =>
    new Intl.DateTimeFormat(locale === "uk" ? "uk-UA" : "en-US", { dateStyle: "medium", timeStyle: "short" }).format(new Date(iso));

  const lang = locale === "uk" ? "uk" : "en";

  const modeTabs = (
    <div className={styles.modes} role="tablist" aria-label={NAV_WORDS[lang].items.receive}>
      <button
        className={styles.mode}
        type="button"
        role="tab"
        aria-selected={mode === "ADDRESS"}
        data-active={mode === "ADDRESS"}
        onClick={() => setMode("ADDRESS")}
      >
        {text("My address")}
      </button>
      <button
        className={styles.mode}
        type="button"
        role="tab"
        aria-selected={mode === "REQUEST"}
        data-active={mode === "REQUEST"}
        onClick={() => setMode("REQUEST")}
      >
        {text("Request a payment")}
      </button>
    </div>
  );

  const details = (
    <>
      <button className={styles.advancedToggle} type="button" onClick={() => setAdvanced((open) => !open)}>
        {advanced ? text("Hide details") : text("Details")}
      </button>
      {advanced ? (
        <dl className={styles.advanced}>
          <dt>{text("Wallet link")}</dt>
          <dd translate="no">{mode === "ADDRESS" ? (addressUrl ?? "—") : (created?.payUrl ?? "—")}</dd>
          {mode === "REQUEST" && created ? (
            <>
              <dt>{text("Token address")}</dt>
              <dd translate="no">{created.mint ?? text("Native SOL")}</dd>
              <dt>{text("Request identifier")}</dt>
              <dd translate="no">{created.reference}</dd>
            </>
          ) : null}
        </dl>
      ) : null}
    </>
  );

  /* The network, said once as a chip with its mark — the line under it is the one rule a sender must keep. */
  const networkChip = (
    <span className={styles.networkChip}>
      <NetworkMark network="solana" size={16} />
      {text("Network")} · <b translate="no">Solana</b>
    </span>
  );

  let body;
  if (!connection) {
    /* A guest: the page keeps its shape — a grey square where the code will be, one sentence, the one button (B14). */
    body = (
      <>
        {modeTabs}
        <div className={styles.body}>
          <div className={styles.qrGuest} aria-hidden="true">
            <Wallet size={40} weight="regular" />
          </div>
          <div className={styles.detail}>
            <p className={styles.guestLine}>
              {mode === "ADDRESS"
                ? text("Connect a wallet — your Solana address and its code will be here.")
                : text("Connect a wallet — then ask for an exact amount with a link anyone can pay.")}
            </p>
            {networkChip}
          </div>
        </div>
        <MoneyAction>
          <ConnectWalletButton block />
        </MoneyAction>
      </>
    );
  } else if (mode === "REQUEST" && !created) {
    /* The form. Two rows of two fields inside the card's width, one
       primary action, and the proof step stated as a step. Nothing here is
       a QR yet: the link does not exist until the server has minted it. */
    body = (
      <>
        {modeTabs}
        <form
          className={styles.form}
          onSubmit={(event) => {
            event.preventDefault();
            if (proven) void create();
            else void proof.prove();
          }}
        >
          <div className={styles.fields}>
            <label className={styles.field}>
              <span className={styles.fieldLabel}>{text("Token")}</span>
              <select className={styles.select} value={assetKey} onChange={(event) => setAssetKey(event.target.value)}>
                {assets.map((entry) => {
                  const held = balanceOf(entry.key);
                  return (
                    <option key={entry.key} value={entry.key}>
                      {entry.ticker}
                      {held ? ` · ${held}` : ""}
                    </option>
                  );
                })}
              </select>
            </label>
            <label className={styles.field}>
              <span className={styles.fieldLabel}>
                {text("Amount")} <span className={styles.optional}>{text("optional")}</span>
              </span>
              <input
                className={styles.input}
                value={amount}
                onChange={(event) => setAmount(event.target.value.replace(",", "."))}
                placeholder="0"
                inputMode="decimal"
                autoComplete="off"
                translate="no"
              />
            </label>
            <label className={styles.field}>
              <span className={styles.fieldLabel}>
                {text("What is it for")} <span className={styles.optional}>{text("optional")}</span>
              </span>
              <input
                className={styles.input}
                value={description}
                onChange={(event) => setDescription(event.target.value.slice(0, PAYMENT_DESCRIPTION_MAX))}
                maxLength={PAYMENT_DESCRIPTION_MAX}
                autoComplete="off"
              />
            </label>
            <label className={styles.field}>
              <span className={styles.fieldLabel}>{text("Expires in")}</span>
              <select className={styles.select} value={expiration} onChange={(event) => setExpiration(event.target.value as PaymentExpiration)}>
                {PAYMENT_EXPIRATIONS.map((preset) => (
                  <option key={preset} value={preset}>{text(EXPIRATION_WORDS[preset])}</option>
                ))}
              </select>
            </label>
          </div>

          <p className={styles.note}>
            {amount.trim() === "" ? text("The payer chooses the amount.") : null}
            {amount.trim() === "" ? " " : ""}
            {text("Send this link to the person who should pay. It opens in any browser, no app needed.")}
          </p>

          {proofProblem ? <p className={styles.error}>{proofProblem}</p> : null}
          {proven && createError ? <p className={styles.error}>{createError}</p> : null}
          <MoneyAction>
            {!proven ? (
              <Button variant="primary" block type="submit" disabled={signing} lang={lang}>
                {signing ? text("Check your wallet…") : text("Confirm in wallet to create a link")}
              </Button>
            ) : (
              <Button variant="primary" block type="submit" disabled={creating} lang={lang}>
                {creating ? text("Creating…") : text("Create payment link")}
              </Button>
            )}
          </MoneyAction>
        </form>
      </>
    );
  } else {
    body = (
      <>
        {modeTabs}

        <div className={styles.body}>
          <div className={styles.qrWrap}>
            {qr ? (
              /* A data URI this component just produced; `next/image`
                 optimizes remote files and there is no file here. */
              // eslint-disable-next-line @next/next/no-img-element
              <img className={styles.qr} src={qr} alt={mode === "ADDRESS" ? text("Scan to pay this address") : text("Scan to open this payment link")} width={256} height={256} />
            ) : (
              <div className={styles.qrPending} aria-hidden />
            )}
          </div>

          <div className={styles.detail}>
            {mode === "ADDRESS" ? (
              <>
                <span className={styles.fieldLabel}>{text("Your Solana address")}</span>
                <p className={styles.address} translate="no">
                  {address}
                </p>
                {networkChip}
                <p className={styles.note}>{text("Send only on the Solana network.")}</p>
              </>
            ) : created ? (
              <>
                <span className={styles.fieldLabel}>{text("Payment link")}</span>
                <p className={styles.address} translate="no">
                  {created.url}
                </p>
                <dl className={styles.summary}>
                  <div>
                    <dt>{text("Amount")}</dt>
                    <dd translate="no">{created.amountDisplay ? `${created.amountDisplay} ${created.symbol}` : `${created.symbol} · ${text("The payer chooses the amount.")}`}</dd>
                  </div>
                  {created.description ? (
                    <div>
                      <dt>{text("What is it for")}</dt>
                      <dd>{created.description}</dd>
                    </div>
                  ) : null}
                  <div>
                    <dt>{text("Valid until")}</dt>
                    <dd>{whenValid(created.expiresAt)}</dd>
                  </div>
                </dl>
                <p className={styles.note}>{text("Send this link to the person who should pay. It opens in any browser, no app needed.")}</p>
              </>
            ) : null}
          </div>
        </div>

        {/* The one orange action — copy what the other person needs — and its two companions; pinned on a phone (B18). */}
        <MoneyAction>
          <div className={styles.actions}>
            <Button
              variant="primary"
              onClick={() => void copy(mode === "ADDRESS" ? (address ?? "") : (created?.url ?? ""), "value")}
              disabled={mode === "REQUEST" && !created}
              lang={lang}
            >
              {copied === "value" ? text("Copied") : mode === "ADDRESS" ? text("Copy address") : text("Copy payment link")}
            </Button>
            <Button variant="secondary" onClick={() => void share()} disabled={shareValue === null} lang={lang}>
              {copied === "link" ? text("Copied") : text("Share")}
            </Button>
            {mode === "REQUEST" && created ? (
              <Button
                variant="secondary"
                onClick={() => {
                  setCreated(null);
                  setAmount("");
                  setDescription("");
                }}
                lang={lang}
              >
                {text("New request")}
              </Button>
            ) : null}
          </div>
        </MoneyAction>

        {details}
      </>
    );
  }

  return (
    <MoneyPage
      id="receive"
      title={NAV_WORDS[lang].items.receive}
      help={text("Your Solana address to be paid at, and a link that asks for an exact amount — it opens in any browser.")}
      lang={lang}
      form={<MoneyCard>{body}</MoneyCard>}
      aside={
        <>
          {connection ? <PaymentRequests address={connection.address} proven={proven} version={requestsVersion} /> : null}
          <RecentTransfers kind="incoming" title={text("Recent incoming")} />
        </>
      }
    />
  );
}
