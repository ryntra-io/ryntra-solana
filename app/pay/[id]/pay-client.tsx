"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { Review } from "@ryntra/core/ui";
/* The page sits outside the cabinet's shell: the core's Review brings its tokens, its components and the product's
   dark/light names for Graphite and Porcelain (`legacy.css`), in the shell's order. */
import "@ryntra/core/tokens.css";
import "@ryntra/core/ui.css";
import "@ryntra/core/legacy.css";

import type { PublicPaymentView } from "@/lib/pay/public";
import type { PublicPaymentStatus } from "@/lib/pay/model";
import type { PayCopy } from "@/lib/site/pay-copy";
import { writePublicLocaleCookie, type PublicLocale } from "@/lib/site/locale";
import { displayAmount, parseHumanAmount } from "@/lib/solana/amounts";
import { explorerTxUrl } from "@/lib/solana/explorer";
import { signFreshBytes } from "@/lib/solana/sign-fresh";
import { CLASSIC_MINTS, TOKEN_ACCOUNT_RENT_LAMPORTS, reviewNetworkFrom, reviewSol, reviewWord } from "@/lib/ticket/review-words";
import {
  connectWallet,
  detectWallets,
  signTransaction,
  subscribeWallets,
  type DetectedWallet,
  type WalletConnection,
} from "@/lib/solana/wallet.client";

import { PayBrand } from "../pay-brand";
import styles from "../pay.module.css";

type Phase =
  | { kind: "idle" }
  | { kind: "connecting"; wallet: string }
  | { kind: "connected"; connection: WalletConnection }
  /* The core's Review before the wallet (SOL-C14): nothing is built until «Підписати в гаманці». */
  | { kind: "review"; connection: WalletConnection }
  | { kind: "preparing"; connection: WalletConnection }
  | { kind: "signing"; connection: WalletConnection }
  | { kind: "sending"; connection: WalletConnection }
  | { kind: "sent"; connection: WalletConnection; signature: string }
  | { kind: "error"; connection: WalletConnection | null; message: string };

const POLL_MS = 10_000;

/**
 * Where a phone goes to pay.
 *
 * Phantom documents one mobile path: a QR or link that opens the page inside
 * its in-app browser (`https://phantom.app/ul/browse/<url>?ref=<ref>`), where
 * the page's own Pay with wallet then finds the wallet. Solflare mirrors it.
 * The founder's Phantom scanner refused our standard `solana:` transfer
 * request twice as "not a valid address", so the phone path is the page
 * itself: the QR carries the page's HTTPS link for any camera, and on a
 * phone the page offers the wallet apps that can open it.
 */
function phantomBrowseUrl(pageUrl: string, origin: string): string {
  return `https://phantom.app/ul/browse/${encodeURIComponent(pageUrl)}?ref=${encodeURIComponent(origin)}`;
}

function solflareBrowseUrl(pageUrl: string, origin: string): string {
  return `https://solflare.com/ul/v1/browse/${encodeURIComponent(pageUrl)}?ref=${encodeURIComponent(origin)}`;
}

function statusWord(status: PublicPaymentStatus, copy: PayCopy): string {
  switch (status) {
    case "AWAITING":
      return copy.statusAwaiting;
    case "PAID":
      return copy.statusPaid;
    case "EXPIRED":
      return copy.statusExpired;
    case "CHECKING":
      return copy.statusChecking;
    case "UNKNOWN":
      return copy.statusUnknown;
  }
}

const fill = (template: string, values: Readonly<Record<string, string>>) => template.replace(/\{(\w+)\}/g, (_, key: string) => values[key] ?? "");

/**
 * What the page says beside the status, with the figures the server counted (FIX-PAY-1): how much arrived in the
 * requested token, summed over every payment, and — when only the token's own transfer fee stands between that and the
 * amount — that it was the fee. «Paid» for more than was asked always says so.
 */
function paymentNote(request: PublicPaymentView["request"], copy: PayCopy): string | null {
  const units = (raw: string) => `${displayAmount(raw, request.token.decimals)} ${request.token.symbol}`;
  const received = request.received;
  if (request.note === "WRONG_TOKEN") return copy.noteWrongToken;
  if (request.note === "UNDERPAID") {
    if (!received || !request.amount) return copy.noteUnderpaid;
    const values = { received: units(received.raw), amount: units(request.amount.raw), fee: units(received.feeWithheldRaw ?? "0") };
    const byFee = received.feeWithheldRaw !== null && BigInt(received.raw) + BigInt(received.feeWithheldRaw) >= BigInt(request.amount.raw);
    return fill(byFee ? copy.noteUnderpaidFee : copy.noteUnderpaidBy, values);
  }
  if (request.note === "OVERPAID") {
    if (!received) return copy.noteOverpaid;
    /* An open request asked for no amount: «more» there is paid more than once. */
    if (!request.amount) return fill(copy.noteOverpaidOpen, { received: units(received.raw) });
    return fill(copy.noteOverpaidBy, { received: units(received.raw), amount: units(request.amount.raw) });
  }
  return null;
}

function formatWhen(iso: string, locale: PublicLocale): string {
  return new Intl.DateTimeFormat(locale === "uk" ? "uk-UA" : "en-US", { dateStyle: "medium", timeStyle: "short" }).format(new Date(iso));
}

/**
 * Everything that changes after the page loads: the status refresh, the
 * language switch, and the wallet payment. The first paint comes from the
 * server; this component only ever replaces it with a newer read of the same
 * public route.
 */
export function PayClient({
  initial,
  qr,
  pageUrl,
  paidAmount,
  locale,
  copy,
}: {
  initial: PublicPaymentView;
  qr: string | null;
  pageUrl: string;
  paidAmount: string | null;
  locale: PublicLocale;
  copy: PayCopy;
}) {
  const router = useRouter();
  const [view, setView] = useState<PublicPaymentView>(initial);
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const [wallets, setWallets] = useState<readonly DetectedWallet[]>([]);
  const [mobile, setMobile] = useState(false);
  const [amount, setAmount] = useState("");
  const [details, setDetails] = useState(false);
  const [pending, setPending] = useState<string | null>(null);
  const inFlight = useRef(false);

  const request = view.request;
  const live = request.status === "AWAITING" || request.status === "CHECKING" || request.status === "UNKNOWN" || pending !== null;

  /* The truth is the server's. While a payment can still arrive, ask again
     every ten seconds; stop the moment the request is paid or expired. */
  useEffect(() => {
    if (!live) return;
    let cancelled = false;
    const tick = async () => {
      try {
        const response = await fetch(`/api/pay/${encodeURIComponent(request.id)}`, { cache: "no-store" });
        if (!response.ok) return;
        const payload = (await response.json()) as { data?: PublicPaymentView };
        if (!cancelled && payload.data) {
          setView(payload.data);
          if (payload.data.request.status === "PAID") setPending(null);
        }
      } catch {
        /* The next tick tries again; the page keeps saying what it last knew. */
      }
    };
    const timer = window.setInterval(() => void tick(), POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [live, request.id]);

  useEffect(() => {
    setWallets(detectWallets());
    setMobile(/Android|iPhone|iPad|iPod/i.test(window.navigator.userAgent));
    return subscribeWallets(() => setWallets(detectWallets()));
  }, []);

  const origin = useMemo(() => {
    try {
      return new URL(pageUrl).origin;
    } catch {
      return "https://ryntra.io";
    }
  }, [pageUrl]);

  const switchLocale = useCallback(
    (next: PublicLocale) => {
      writePublicLocaleCookie(next);
      router.refresh();
    },
    [router],
  );

  const connect = useCallback(async (name: string) => {
    setPhase({ kind: "connecting", wallet: name });
    const result = await connectWallet(name);
    /* A wallet's own overlay closed by the payer (Seeker Connect): nothing went wrong, the choice is back. */
    if (!result.ok && result.state === "CANCELLED") {
      setPhase({ kind: "idle" });
      return;
    }
    if (!result.ok) {
      setPhase({ kind: "error", connection: null, message: result.reason });
      return;
    }
    setPhase({ kind: "connected", connection: result.connection });
  }, []);

  const connection = "connection" in phase ? phase.connection : null;

  const typedAmount = useMemo(() => {
    if (request.amount) return { ok: true as const, raw: request.amount.raw };
    if (amount.trim() === "") return { ok: false as const, reason: copy.errorAmount };
    const parsed = parseHumanAmount(amount.trim(), request.token.decimals);
    if (!parsed.ok) return { ok: false as const, reason: parsed.reason };
    if (parsed.raw === "0") return { ok: false as const, reason: copy.errorAmount };
    return { ok: true as const, raw: parsed.raw };
  }, [amount, copy.errorAmount, request.amount, request.token.decimals]);

  const pay = useCallback(async () => {
    if (!connection || inFlight.current) return;
    if (!typedAmount.ok) {
      setPhase({ kind: "error", connection, message: typedAmount.reason });
      return;
    }
    inFlight.current = true;
    try {
      /*
       * The payment's bytes live ~30 s (`lib/solana/blockhash-life.ts`). A signature that comes back later is not sent:
       * the same payment is prepared again and the wallet asked once more, so the network never refuses it for age.
       */
      const fresh = await signFreshBytes({
        build: async () => {
          setPhase({ kind: "preparing", connection });
          const prepared = await fetch(`/api/pay/${encodeURIComponent(request.id)}/transaction`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ payer: connection.address, amount: request.amount ? null : amount.trim() }),
          });
          const preparedBody = (await prepared.json().catch(() => ({}))) as {
            data?: { intentId: string; unsignedWireBase64: string; signableMs?: number };
            error?: { code: string; message: string };
          };
          return prepared.ok && preparedBody.data
            ? { ok: true as const, data: preparedBody.data }
            : { ok: false as const, code: preparedBody.error?.code ?? null, message: preparedBody.error?.message ?? null };
        },
        signableMsOf: (data) => data.signableMs,
        sign: async (data) => {
          setPhase({ kind: "signing", connection });
          const answer = await signTransaction({
            wallet: connection.wallet,
            address: connection.address,
            unsignedWireBase64: data.unsignedWireBase64,
            chain: "solana:mainnet",
          });
          return answer.ok ? { ok: true, value: answer.signedWireBase64 } : answer;
        },
      });
      if (!fresh.ok) {
        const message =
          fresh.stage === "build"
            ? fresh.failure.code === "SELF_PAYMENT" ? copy.errorSelf : fresh.failure.message ?? copy.errorGeneric
            : fresh.stage === "sign"
              ? /refus|reject|declin/i.test(fresh.reason) ? copy.errorRefused : fresh.reason
              : copy.errorGeneric;
        setPhase({ kind: "error", connection, message });
        return;
      }
      const preparedBody = { data: fresh.built };
      const signed = { signedWireBase64: fresh.signed };
      setPhase({ kind: "sending", connection });
      const submitted = await fetch(`/api/pay/${encodeURIComponent(request.id)}/submit`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ intentId: preparedBody.data.intentId, signedWireBase64: signed.signedWireBase64 }),
      });
      const submittedBody = (await submitted.json().catch(() => ({}))) as {
        data?: { signature: string; view: PublicPaymentView | null };
        error?: { code: string; message: string };
      };
      if (!submitted.ok || !submittedBody.data) {
        setPhase({ kind: "error", connection, message: submittedBody.error?.message ?? copy.errorGeneric });
        return;
      }
      setPending(submittedBody.data.signature);
      if (submittedBody.data.view) setView(submittedBody.data.view);
      setPhase({ kind: "sent", connection, signature: submittedBody.data.signature });
    } catch {
      setPhase({ kind: "error", connection, message: copy.errorGeneric });
    } finally {
      inFlight.current = false;
    }
  }, [amount, connection, copy.errorGeneric, copy.errorRefused, copy.errorSelf, request.amount, request.id, typedAmount]);

  /* «Оплатити» opens the core's Review; only its «Підписати в гаманці» builds the payment and asks the wallet. */
  const review = useCallback(() => {
    if (!connection || inFlight.current) return;
    if (!typedAmount.ok) {
      setPhase({ kind: "error", connection, message: typedAmount.reason });
      return;
    }
    setPhase({ kind: "review", connection });
  }, [connection, typedAmount]);

  const status = request.status;
  const expired = status === "EXPIRED";
  const paid = status === "PAID";
  const canPay = !paid && !expired && pending === null;
  const amountLine = request.amount ? `${request.amount.display} ${request.token.symbol}` : `${copy.amountAny} · ${request.token.symbol}`;
  const note = paymentNote(request, copy);

  const amountField = !request.amount ? (
    <label className={styles.field}>
      <span>{copy.amountLabel} · {request.token.symbol}</span>
      <input
        className={styles.input}
        value={amount}
        onChange={(event) => setAmount(event.target.value)}
        placeholder={copy.amountPlaceholder}
        inputMode="decimal"
        autoComplete="off"
        translate="no"
      />
    </label>
  ) : null;

  /* What the Review says, figure by figure: the amount the bytes will carry (typed amounts are fixed while it shows), every
     cost on its own line — the network's floor, and for a token the recipient's account a first payment may open — and
     what happens after. Nothing is built yet, so a figure the bytes decide is said as a floor, never as a ceiling: the
     wallet's priority fee, a Token-2022 account's larger rent and a token's own transfer fee all come on top. Only USDC
     and USDT are known here to be classic tokens without a fee. */
  const reviewing = phase.kind === "review" || phase.kind === "preparing" || phase.kind === "signing" || phase.kind === "sending";
  const reviewAmount = request.amount
    ? `${request.amount.display} ${request.token.symbol}`
    : typedAmount.ok
      ? `${displayAmount(typedAmount.raw, request.token.decimals)} ${request.token.symbol}`
      : "—";
  const opensAccount = request.token.mint !== null;
  const classic = request.token.mint !== null && CLASSIC_MINTS.has(request.token.mint);
  const accountRent = reviewSol(TOKEN_ACCOUNT_RENT_LAMPORTS, locale);
  const accountValue = reviewWord(locale, classic ? "upTo" : "from", { x: accountRent });
  const reviewBlock =
    reviewing && connection ? (
      <Review
        className={styles.review}
        lang={locale}
        titleAs="h2"
        title={fill(copy.reviewTitle, { amount: reviewAmount, to: request.recipient.abbreviated })}
        pay={reviewAmount}
        get={fill(opensAccount && !classic ? copy.reviewGetLessFee : copy.reviewGet, { amount: reviewAmount, to: request.recipient.abbreviated })}
        costs={[
          { label: reviewWord(locale, "ryntra"), value: reviewWord(locale, "none") },
          { label: reviewWord(locale, "network"), value: reviewNetworkFrom(locale) },
          ...(opensAccount ? [{ label: reviewWord(locale, "recipientAccount"), value: accountValue }] : []),
          ...(opensAccount && !classic ? [{ label: reviewWord(locale, "tokenFee"), value: reviewWord(locale, "tokenFeeIfAny") }] : []),
        ]}
        costsTotal={opensAccount ? reviewWord(locale, "plus", { a: reviewNetworkFrom(locale), b: accountValue }) : reviewNetworkFrom(locale)}
        rows={[
          ...(request.description ? [{ label: copy.forLabel, value: request.description }] : []),
          { label: copy.networkLabel, value: copy.network },
        ]}
        whatItIs={copy.reviewWhat}
        signer={<span translate="no">{connection.address.slice(0, 4)}…{connection.address.slice(-4)}</span>}
        /* The wallet is asked only in «signing»; while the payment is prepared or sent the action stays grey and says why. */
        ready={phase.kind === "review" || phase.kind === "signing"}
        blockedReason={phase.kind === "preparing" ? copy.preparing : phase.kind === "sending" ? copy.sending : undefined}
        signing={phase.kind === "signing"}
        {...(phase.kind === "review" ? { onCancel: () => setPhase({ kind: "connected", connection }) } : {})}
        onConfirm={() => void pay()}
        risk={reviewWord(locale, "walletShowsFee")}
        details={
          <dl className={styles.reviewDetails}>
            <dt>{copy.reviewRecipient}</dt>
            <dd translate="no">{request.recipient.address}</dd>
            <dt>{copy.reviewToken}</dt>
            <dd translate="no">{request.token.mint ?? copy.reviewNativeSol}</dd>
            <dt>{copy.referenceLabel}</dt>
            <dd translate="no">{request.reference}</dd>
          </dl>
        }
      />
    ) : null;

  const walletFlow = (
    <>
      {connection ? (
        <p className={styles.connected}>
          {copy.connectedAs} <b translate="no">{connection.address.slice(0, 4)}…{connection.address.slice(-4)}</b>
          <button type="button" className={styles.linkButton} onClick={() => setPhase({ kind: "idle" })}>{copy.change}</button>
        </p>
      ) : wallets.length > 0 ? (
        <div className={styles.wallets} role="group" aria-label={copy.chooseWallet}>
          {wallets.map((wallet) => (
            <button
              key={wallet.name}
              type="button"
              className={styles.walletButton}
              disabled={phase.kind === "connecting"}
              onClick={() => void connect(wallet.name)}
            >
              {wallet.icon ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={wallet.icon} alt="" width={20} height={20} />
              ) : null}
              {phase.kind === "connecting" && phase.wallet === wallet.name ? copy.connecting : wallet.name}
            </button>
          ))}
        </div>
      ) : null}

      {connection && phase.kind === "connected" ? (
        <button type="button" className={styles.primary} onClick={review} disabled={!request.amount && amount.trim() === ""}>
          {copy.payButton}
          {request.amount ? ` ${request.amount.display} ${request.token.symbol}` : typedAmount.ok ? ` ${displayAmount(typedAmount.raw, request.token.decimals)} ${request.token.symbol}` : ""}
        </button>
      ) : null}
      {phase.kind === "error" ? (
        <p className={styles.error} role="alert">
          {phase.message}{" "}
          <button type="button" className={styles.linkButton} onClick={() => setPhase(phase.connection ? { kind: "connected", connection: phase.connection } : { kind: "idle" })}>
            {copy.tryAgain}
          </button>
        </p>
      ) : null}
      {connection ? <p className={styles.fine}>{copy.feeNote}</p> : null}
    </>
  );

  /* The wallet apps a phone can hand this page to. Shown when there is no
     wallet in the browser (a phone's Safari or Chrome) — inside Phantom's own
     browser the wallet is detected and the ordinary flow runs instead. */
  const walletApps = (
    <div className={styles.apps} role="group" aria-label={copy.openInApp}>
      <a className={styles.walletButton} href={phantomBrowseUrl(pageUrl, origin)}>{copy.openInPhantom}</a>
      <a className={styles.walletButton} href={solflareBrowseUrl(pageUrl, origin)}>{copy.openInSolflare}</a>
      <a className={styles.secondary} href={view.payUrl}>{copy.otherWallet}</a>
    </div>
  );

  return (
    <div className={styles.frame}>
      <header className={styles.top}>
        <PayBrand />
        <div className={styles.lang} role="group" aria-label={copy.language}>
          <button type="button" className={styles.langButton} data-active={locale === "en"} onClick={() => switchLocale("en")}>EN</button>
          <button type="button" className={styles.langButton} data-active={locale === "uk"} onClick={() => switchLocale("uk")}>UA</button>
        </div>
      </header>

      <section className={styles.card} aria-labelledby="pay-title">
        <p className={styles.eyebrow}>{copy.eyebrow}</p>
        <h1 className={styles.title} id="pay-title">{amountLine}</h1>
        <p className={styles.status} data-status={pending && !paid ? "PENDING" : status}>
          <span className={styles.dot} aria-hidden />
          {pending && !paid ? copy.statusPending : statusWord(status, copy)}
        </p>
        {note ? <p className={styles.note}>{note}</p> : null}

        <dl className={styles.facts}>
          {request.description ? (
            <div>
              <dt>{copy.forLabel}</dt>
              <dd>{request.description}</dd>
            </div>
          ) : null}
          <div>
            <dt>{copy.toLabel}</dt>
            <dd translate="no" title={request.recipient.address}>{request.recipient.abbreviated}</dd>
          </div>
          <div>
            <dt>{copy.networkLabel}</dt>
            <dd>{copy.network}</dd>
          </div>
          <div>
            <dt>{expired ? copy.expiredLabel : copy.expiresLabel}</dt>
            <dd>{formatWhen(request.expiresAt, locale)}</dd>
          </div>
          {paid && request.paid ? (
            <div>
              <dt>{copy.paidOn}</dt>
              <dd>
                {request.paid.paidAt ? formatWhen(request.paid.paidAt, locale) : "—"}
                {paidAmount ? ` · ${paidAmount}` : ""}
              </dd>
            </div>
          ) : null}
        </dl>

        {paid && request.paid ? (
          <a className={styles.secondary} href={explorerTxUrl("mainnet", request.paid.signature)} target="_blank" rel="noreferrer noopener">
            {copy.viewTransaction}
          </a>
        ) : null}

        {canPay && reviewBlock ? (
          <div className={styles.reviewWrap}>
            {reviewBlock}
          </div>
        ) : canPay ? (
          <div className={styles.ways} data-mobile={mobile}>
            {mobile ? (
              <div className={styles.wallet}>
                <p className={styles.scanTitle}>{copy.payWithWallet}</p>
                {amountField}
                {wallets.length > 0 || connection ? walletFlow : (
                  <>
                    <p className={styles.scanBody}>{copy.mobileHint}</p>
                    {walletApps}
                  </>
                )}
              </div>
            ) : (
              <>
                <div className={styles.scan}>
                  {qr ? (
                    /* A data URI rendered on the server; there is no file for next/image to optimize. */
                    // eslint-disable-next-line @next/next/no-img-element
                    <img className={styles.qr} src={qr} alt={copy.scanTitle} width={256} height={256} />
                  ) : null}
                  <p className={styles.scanTitle}>{copy.scanTitle}</p>
                  <p className={styles.scanBody}>{copy.scanBody}</p>
                </div>

                <div className={styles.wallet}>
                  <p className={styles.scanTitle}>{copy.payWithWallet}</p>
                  {amountField}
                  {wallets.length > 0 || connection ? walletFlow : <p className={styles.scanBody}>{copy.noWallet}</p>}
                </div>
              </>
            )}
          </div>
        ) : null}

        {pending && !paid ? (
          <p className={styles.progress}>
            {copy.sent} {copy.payAgainHint}{" "}
            <a className={styles.inlineLink} href={explorerTxUrl("mainnet", pending)} target="_blank" rel="noreferrer noopener">{copy.viewTransaction}</a>
          </p>
        ) : null}

        <button type="button" className={styles.detailsToggle} onClick={() => setDetails((open) => !open)} aria-expanded={details}>
          {details ? copy.detailsHide : copy.detailsToggle}
        </button>
        {details ? (
          <dl className={styles.details}>
            <dt>{copy.pageLinkLabel}</dt>
            <dd translate="no">{pageUrl}</dd>
            <dt>{copy.walletLinkLabel}</dt>
            <dd translate="no">{view.payUrl}</dd>
            <dt>{copy.referenceLabel}</dt>
            <dd translate="no">{request.reference}</dd>
          </dl>
        ) : null}
      </section>

      <footer className={styles.foot}>
        <span>{copy.poweredBy}</span>
        {/* A whole page load, not a client navigation: /pay carries the core's stylesheets (SOL-C14), «/» its own. */}
        {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
        <a href="/">{copy.aboutRyntra}</a>
      </footer>
    </div>
  );
}
