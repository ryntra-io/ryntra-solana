"use client";

import { X } from "@phosphor-icons/react";
import QRCode from "qrcode";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import type { WorkspaceLocale } from "@/app/shell/locale";
import type { FundingView, WithdrawalView } from "@/lib/predictions/funding-account";
import { DESTINATION_MISMATCH, USDC_DECIMALS, fundingViewFor, parseUsdcAmount, rawToAmount, receiveFloorRaw, type DepositRow, type WithdrawPreview } from "@/lib/predictions/funding";

import { Custody } from "./custody-note";
import { timeShort, usd } from "./format";
import styles from "./predictions.module.css";
import type { usePaperAccount } from "./use-paper-account";
import { wordsFor, type PredictionWord } from "./words";

type Account = ReturnType<typeof usePaperAccount>;
type ApiFailure = { error?: { code?: string; message?: string } };
type Funding = FundingView & Readonly<{ wallet: string }>;

const short = (address: string) => (address.length > 12 ? `${address.slice(0, 4)}…${address.slice(-4)}` : address);
const usdOfRaw = (raw: string | null) => (raw === null ? null : rawToAmount(raw, USDC_DECIMALS));

async function post<T>(url: string, body: unknown): Promise<{ ok: true; body: T } | { ok: false; code: string }> {
  try {
    const response = await fetch(url, { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const parsed = (await response.json().catch(() => ({}))) as T & ApiFailure;
    return response.ok ? { ok: true, body: parsed } : { ok: false, code: parsed.error?.code ?? "UNAVAILABLE" };
  } catch {
    return { ok: false, code: "NETWORK" };
  }
}

/**
 * Real money for the prediction account, with one Solana wallet: the balance
 * the aggregator holds, *Deposit* — the account's own Solana address and its
 * QR — and *Withdraw* — back to the person's own Solana wallet, through a
 * Review that names the fee and what arrives. Switched off on the
 * deployment, it says so in one line and shows no address. A withdrawal the
 * aggregator did not confirm is shown as unknown and checked again under the
 * same request — never as sent, never as not sent.
 *
 * Everything it draws belongs to the wallet the account is signed in with
 * now: the parent keys it by that wallet, a switch or a sign-out drops what
 * was read before, an answer read for another wallet is never drawn
 * (`fundingViewFor`), and a failed read clears the old figures so the
 * failure shows instead of them.
 */
export function FundingCard({ account, locale }: { account: Account; locale: WorkspaceLocale }) {
  const word = wordsFor(locale);
  const linked = account.state.status === "ready" && account.state.account.link.state === "active";
  const accountWallet = account.state.status === "ready" ? account.state.account.wallet : null;
  const [stored, setFunding] = useState<Funding | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [panel, setPanel] = useState<"deposit" | "withdraw" | null>(null);
  const walletNow = useRef(accountWallet);
  walletNow.current = accountWallet;

  /* Another wallet, or none: nothing read for the one before stays on the screen. */
  useEffect(() => {
    setFunding(null);
    setFailed(null);
    setPanel(null);
  }, [accountWallet]);

  const read = useCallback(async () => {
    const asked = walletNow.current;
    try {
      const response = await fetch("/api/predictions/funding", { credentials: "same-origin", cache: "no-store" });
      const body = (await response.json().catch(() => ({}))) as Funding & ApiFailure;
      /* An answer that lands after a switch is for the wallet before: dropped. */
      if (walletNow.current !== asked) return;
      if (!response.ok) {
        setFunding(null);
        setFailed(body.error?.code ?? "UNAVAILABLE");
        return;
      }
      setFailed(null);
      setFunding(body);
    } catch {
      if (walletNow.current !== asked) return;
      setFunding(null);
      setFailed("NETWORK");
    }
  }, []);

  const funding = fundingViewFor(stored, accountWallet);

  useEffect(() => {
    if (linked) void read();
  }, [linked, accountWallet, read]);

  /* While the address is being created, or a deposit is confirming, read again a little later. */
  const waiting = funding?.deposit.state === "preparing" || (funding?.deposits ?? []).some((d) => d.phase === "pending");
  useEffect(() => {
    if (!waiting) return undefined;
    const timer = setTimeout(() => void read(), 6_000);
    return () => clearTimeout(timer);
  }, [waiting, funding, read]);

  if (!linked) return null;

  const head = (
    <div className={`${styles.cardHead} ${styles.cardHeadWrap}`}>
      <h2 id="pred-money" className={styles.cardTitle}>
        {word("moneyTitle")}
      </h2>
      {funding?.enabled ? <span className={styles.stateChip}>{word("moneyBadge")}</span> : null}
    </div>
  );

  if (!funding) {
    return (
      <section className={styles.card} aria-labelledby="pred-money" data-funding-card="" aria-busy={!failed}>
        {head}
        {failed ? (
          <div className={styles.linkCard}>
            <p className={styles.note}>{word("unavailable")}</p>
            <button type="button" className="rw-btn" onClick={() => void read()}>
              {word("retry")}
            </button>
          </div>
        ) : (
          <div className={styles.skeleton}>
            <span className={styles.bone} />
          </div>
        )}
      </section>
    );
  }

  if (!funding.enabled) {
    return (
      <section className={styles.card} aria-labelledby="pred-money" data-funding-card="">
        {head}
        <div className={styles.cardBody}>
          <p className={styles.note}>{word("moneyOff")}</p>
        </div>
        <Custody locale={locale} />
        {funding.withdrawals.length > 0 ? <Withdrawals rows={funding.withdrawals} locale={locale} onChanged={read} live={false} /> : null}
      </section>
    );
  }

  const balance = funding.balance;
  return (
    <section className={styles.card} aria-labelledby="pred-money" data-funding-card="">
      {head}
      <div className={styles.accountStrip}>
        <div className={styles.metric}>
          <span className={styles.metricLabel}>{word("moneyBalance")}</span>
          <span className={styles.metricValue}>{balance ? usd(balance.cashUsd) : "—"}</span>
          {balance ? (
            <span className={styles.metricSub}>
              {usd(balance.availableUsd)} {word("moneyAvailable")}
            </span>
          ) : null}
          {balance && balance.reservedUsd > 0 ? (
            <span className={styles.metricSub}>
              {usd(balance.reservedUsd)} {word("moneyReserved")}
            </span>
          ) : null}
        </div>
        {balance && balance.positionsUsd > 0 ? (
          <div className={styles.metric}>
            <span className={styles.metricLabel}>{word("moneyPositions")}</span>
            <span className={styles.metricValue}>{usd(balance.positionsUsd)}</span>
          </div>
        ) : null}
      </div>
      <div className={styles.cardBody}>
        <p className={styles.muted}>{word("custodyLine")}</p>
        <div className={styles.moneyActions}>
          {/* One orange action: «Deposit», until «Withdraw» is open — then its own Review is the one. */}
          <button type="button" className={panel === "withdraw" ? "rw-btn" : "rw-btn rw-btn--primary"} aria-expanded={panel === "deposit"} onClick={() => setPanel(panel === "deposit" ? null : "deposit")}>
            {word("deposit")}
          </button>
          <button type="button" className="rw-btn" aria-expanded={panel === "withdraw"} onClick={() => setPanel(panel === "withdraw" ? null : "withdraw")}>
            {word("withdraw")}
          </button>
        </div>
        {funding.providerFailure ? <p className={styles.notice}>{word("unavailable")}</p> : null}
        {panel === "deposit" ? <DepositPanel funding={funding} locale={locale} onRetry={read} /> : null}
        {panel === "withdraw" ? <WithdrawPanel funding={funding} locale={locale} onDone={read} /> : null}
      </div>
      {funding.deposits.length > 0 ? <Deposits rows={funding.deposits} locale={locale} /> : null}
      {funding.withdrawals.length > 0 ? <Withdrawals rows={funding.withdrawals} locale={locale} onChanged={read} live /> : null}
    </section>
  );
}

function DepositPanel({ funding, locale, onRetry }: { funding: Funding; locale: WorkspaceLocale; onRetry: () => void }) {
  const word = wordsFor(locale);
  const target = funding.deposit;
  const [qr, setQr] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const address = target.state === "ready" ? target.address : null;

  useEffect(() => {
    if (!address) return undefined;
    let live = true;
    void QRCode.toDataURL(address, { errorCorrectionLevel: "M", margin: 1, width: 360 })
      .then((url) => {
        if (live) setQr(url);
      })
      .catch(() => null);
    return () => {
      live = false;
    };
  }, [address]);

  if (target.state === "preparing") return <p className={styles.note} role="status">{word("depositPreparing")}</p>;
  if (target.state !== "ready") {
    return (
      <div className={styles.moneyPanel} role="status">
        <p className={styles.notice}>{target.state === "unsupported" ? word("depositUnsupported") : word("depositFailed")}</p>
        {target.state === "failed" ? (
          <button type="button" className="rw-btn" onClick={onRetry}>
            {word("retry")}
          </button>
        ) : null}
      </div>
    );
  }
  return (
    <div className={styles.moneyPanel}>
      <span className={styles.fieldLabel}>{word("depositAddress")}</span>
      <div className={styles.moneyAddress}>
        {qr ? (
          // eslint-disable-next-line @next/next/no-img-element -- a QR code drawn here as a data: URL; next/image has nothing to optimise
          <img className={styles.moneyQr} src={qr} alt="" width={132} height={132} />
        ) : (
          <span className={styles.moneyQr} aria-hidden="true" />
        )}
        <div className={styles.moneyAddressText}>
          <code className={styles.mono} data-testid="deposit-address">
            {target.address}
          </code>
          <button
            type="button"
            className="rw-btn"
            onClick={() => {
              void navigator.clipboard
                ?.writeText(target.address)
                .then(() => {
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1_800);
                })
                .catch(() => null);
            }}
          >
            {copied ? word("copied") : word("copy")}
          </button>
        </div>
      </div>
      <p className={styles.hint} data-tone="caution">
        {word("depositOnly")}
      </p>
    </div>
  );
}

type WithdrawFlow =
  | Readonly<{ stage: "idle" }>
  | Readonly<{ stage: "pricing" }>
  /* `destination` — the one the server's preview answered for, never the card's own copy. */
  | Readonly<{ stage: "review"; preview: WithdrawPreview; destination: string; requestId: string; repriced: boolean }>
  | Readonly<{ stage: "sending"; preview: WithdrawPreview; destination: string; requestId: string }>
  /* `after` — what failed: a confirmation may have left a record, so the person looks at the list first. */
  | Readonly<{ stage: "failed"; code: string; after: "price" | "confirm" }>;

function unviableWord(reason: WithdrawPreview["reason"]): PredictionWord {
  switch (reason) {
    case "below_minimum":
      return "wBelowMin";
    case "insufficient":
      return "wInsufficient";
    case "above_max":
      return "wAboveMax";
    case "fee_exceeds":
      return "wFeeExceeds";
    case "route_unavailable":
      return "wRoute";
    default:
      return "wOther";
  }
}

function newRequestId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : "";
}

function WithdrawPanel({ funding, locale, onDone }: { funding: Funding; locale: WorkspaceLocale; onDone: () => Promise<void> }) {
  const word = wordsFor(locale);
  const [amount, setAmount] = useState("");
  const [flow, setFlow] = useState<WithdrawFlow>({ stage: "idle" });
  const reading = parseUsdcAmount(amount);

  const price = useCallback(async (body: { amountRaw: string } | { max: true }) => {
    setFlow({ stage: "pricing" });
    const answer = await post<{ wallet?: string; destination?: string; preview: WithdrawPreview }>("/api/predictions/funding/preview", body);
    if (!answer.ok) {
      setFlow({ stage: "failed", code: answer.code, after: "price" });
      return;
    }
    /* The Review names where the server will send it; a preview answered for another wallet than this card's is not reviewed. */
    const destination = answer.body.destination;
    if (!destination || destination !== funding.wallet || answer.body.wallet !== funding.wallet) {
      setFlow({ stage: "failed", code: "UNAVAILABLE", after: "price" });
      return;
    }
    const preview = answer.body.preview;
    if ("max" in body) setAmount(String(usdOfRaw(preview.amountRaw) ?? ""));
    /* The request id is made once per Review: confirming it twice is one withdrawal. */
    setFlow({ stage: "review", preview, destination, requestId: newRequestId(), repriced: false });
  }, [funding.wallet]);

  const confirm = useCallback(
    async (preview: WithdrawPreview, requestId: string, destination: string) => {
      if (preview.status !== "quoted" || !preview.receiveRaw || !requestId) return;
      setFlow({ stage: "sending", preview, destination, requestId });
      const answer = await post<{ outcome: "recorded" | "repriced"; preview?: WithdrawPreview }>("/api/predictions/funding/withdraw", { requestId, amountRaw: preview.amountRaw, reviewedReceiveRaw: preview.receiveRaw, reviewedFeeRaw: preview.feeRaw });
      if (answer.ok && answer.body.outcome === "repriced" && answer.body.preview) {
        setFlow({ stage: "review", preview: answer.body.preview, destination, requestId: newRequestId(), repriced: true });
        return;
      }
      if (!answer.ok && answer.code !== "NETWORK") {
        /* Whatever the answer, the server may hold a record of this confirmation: the list is read again before anything else is asked. */
        setFlow({ stage: "failed", code: answer.code, after: "confirm" });
        await onDone();
        return;
      }
      /* Recorded — or no answer reached the browser: either way the list below says where it stands, read from the server. */
      setFlow({ stage: "idle" });
      setAmount("");
      await onDone();
    },
    [onDone],
  );

  return (
    <div className={styles.moneyPanel}>
      <div className={styles.field}>
        <label className={styles.fieldLabel} htmlFor="pred-withdraw-amount">
          {word("withdrawAmount")}
        </label>
        <span className={styles.moneyAmountRow}>
          <input id="pred-withdraw-amount" className={styles.input} inputMode="decimal" autoComplete="off" value={amount} aria-invalid={amount !== "" && !reading.ok} onChange={(e) => setAmount(e.target.value)} />
          <button type="button" className="rw-btn" onClick={() => void price({ max: true })} disabled={flow.stage === "pricing"}>
            {word("withdrawAll")}
          </button>
        </span>
        {amount !== "" && !reading.ok ? <span className={styles.hint} data-tone="caution">{word("withdrawBadAmount")}</span> : <span className={styles.hint}>{word("withdrawLimits")}</span>}
      </div>
      <p className={styles.muted}>
        {word("withdrawTo")} · <span className={styles.mono}>{short(funding.destination)}</span>
      </p>
      <div className={styles.formActions}>
        <button type="button" className="rw-btn rw-btn--primary" disabled={!reading.ok || flow.stage === "pricing"} onClick={() => reading.ok && void price({ amountRaw: reading.raw })}>
          {flow.stage === "pricing" ? word("withdrawPricing") : word("withdrawPreview")}
        </button>
      </div>
      {flow.stage === "failed" ? (
        <p className={styles.error}>{flow.code === "WITHDRAWAL_OPEN" ? word("withdrawOpen") : flow.after === "confirm" ? word("withdrawCheckBelow") : word("unavailable")}</p>
      ) : null}
      {flow.stage === "review" || flow.stage === "sending" ? <WithdrawReview flow={flow} locale={locale} onClose={() => setFlow({ stage: "idle" })} onConfirm={confirm} /> : null}
    </div>
  );
}

function WithdrawReview({
  flow,
  locale,
  onClose,
  onConfirm,
}: {
  flow: Extract<WithdrawFlow, { stage: "review" | "sending" }>;
  locale: WorkspaceLocale;
  onClose: () => void;
  onConfirm: (preview: WithdrawPreview, requestId: string, destination: string) => void;
}) {
  const word = wordsFor(locale);
  const { preview, destination } = flow;
  const sending = flow.stage === "sending";
  const quoted = preview.status === "quoted";
  const [nowMs, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(timer);
  }, []);
  const expired = preview.expiresAt ? Date.parse(preview.expiresAt) <= nowMs : false;
  const maxUsd = usdOfRaw(preview.maxDeliverableRaw);
  /* The bound the send is held to: priced again below it, nothing is sent and the person reviews again. */
  const floorUsd = quoted ? usdOfRaw(receiveFloorRaw(preview.receiveRaw)) : null;
  return createPortal(
    <div className="ry-product">
      <div className={styles.overlay} role="presentation" onClick={(e) => { if (e.target === e.currentTarget && !sending) onClose(); }}>
        <div className={styles.sheet} role="dialog" aria-modal="true" aria-labelledby="pred-withdraw-title">
          <div className={styles.sheetHead}>
            <h2 id="pred-withdraw-title">{word("withdrawReviewTitle")}</h2>
            <span className={styles.actions}>
              <span className={styles.stateChip}>{word("moneyBadgeShort")}</span>
              <button type="button" className={styles.iconButton} aria-label={word("close")} onClick={onClose} disabled={sending}>
                <X size={18} />
              </button>
            </span>
          </div>
          <div className={styles.cardBody}>
            {flow.stage === "review" && flow.repriced ? <p className={styles.notice}>{word("withdrawRepriced")}</p> : null}
            {quoted && expired && !sending ? <p className={styles.notice}>{word("expired")}</p> : null}
            <dl className={styles.kv}>
              <dt>{word("withdrawSum")}</dt>
              <dd data-strong="true">{usd(usdOfRaw(preview.amountRaw))}</dd>
              {quoted ? (
                <>
                  <dt>{word("withdrawFee")}</dt>
                  <dd>{usd(usdOfRaw(preview.feeRaw), 2)}</dd>
                  <dt>{word("withdrawReceive")}</dt>
                  <dd data-tone="pos">≈ {usd(usdOfRaw(preview.receiveRaw))}</dd>
                </>
              ) : null}
              <dt>{word("withdrawTo")}</dt>
              <dd className={styles.mono}>{short(destination)}</dd>
              <dt>{word("custodyReview")}</dt>
              <dd data-prose="true">{word("custodyLive")}</dd>
            </dl>
            {quoted ? (
              <>
                <p className={styles.hint}>{word("withdrawReprice")}</p>
                {floorUsd !== null ? <p className={styles.hint}>{word("withdrawFloor").replace("{x}", usd(floorUsd))}</p> : null}
              </>
            ) : (
              <p className={styles.error}>
                {word(unviableWord(preview.reason))}
                {preview.reason === "above_max" && maxUsd !== null ? ` ${usd(maxUsd)}.` : ""}
              </p>
            )}
            <div className={styles.formActions}>
              <button type="button" className="rw-btn" onClick={onClose} disabled={sending}>
                {word("cancel")}
              </button>
              <button type="button" className="rw-btn rw-btn--primary" disabled={!quoted || expired || sending || !flow.requestId} onClick={() => onConfirm(preview, flow.requestId, destination)}>
                {sending ? word("wSending") : word("withdrawConfirm")}
              </button>
            </div>
            <details className={styles.disclosure}>
              <summary>{word("details")}</summary>
              <div className={styles.disclosureBody}>
                <p>{word("custodyLine")}</p>
                <p className={styles.mono}>{destination}</p>
                {preview.expiresAt ? (
                  <p>
                    {word("expires")} {timeShort(preview.expiresAt, locale)}
                  </p>
                ) : null}
                {preview.providerReason ? <p lang="en">{preview.providerReason}</p> : null}
              </div>
            </details>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}

function depositWord(phase: DepositRow["phase"]): PredictionWord {
  return phase === "credited" ? "depCredited" : phase === "pending" ? "depPending" : "depUnknown";
}

function Deposits({ rows, locale }: { rows: readonly DepositRow[]; locale: WorkspaceLocale }) {
  const word = wordsFor(locale);
  return (
    <>
      <div className={styles.cardHead} style={{ borderTop: "1px solid var(--ry-border)" }}>
        <h3 className={styles.sectionTitle}>{word("deposits")}</h3>
      </div>
      <ul className={styles.moneyList}>
        {rows.slice(0, 5).map((d) => (
          <li key={d.id}>
            <span>
              <span className={styles.moneyListLine}>
                <b>{d.amount !== null ? usd(d.amount) : "—"}</b> {d.symbol} <small className={styles.muted}>· {timeShort(d.at || null, locale)}</small>
              </span>
            </span>
            <span className={styles.stateChip} data-tone={d.phase === "credited" ? "good" : "wait"} title={d.phase === "unknown" ? d.providerStatus : undefined}>
              {word(depositWord(d.phase))}
            </span>
          </li>
        ))}
      </ul>
    </>
  );
}

const PHASE_WORD: Readonly<Record<WithdrawalView["phase"], PredictionWord>> = {
  sending: "wSending",
  in_flight: "wInFlight",
  completed: "wCompleted",
  partial: "wPartial",
  failed: "wFailed",
  refused: "wRefused",
  unknown: "wUnknown",
};

/**
 * The figure a withdrawal row leads with. Delivered: what AGG says arrived —
 * or, while it has not said, about what the Review said would (never the
 * gross amount, which includes the fee). Partly delivered without a figure:
 * none. Otherwise the amount asked for.
 */
function withdrawalFigure(w: WithdrawalView): string {
  if (w.phase === "completed") return w.completedUsd !== null ? usd(w.completedUsd) : w.reviewedReceiveUsd !== null ? `≈ ${usd(w.reviewedReceiveUsd)}` : "—";
  if (w.phase === "partial") return usd(w.completedUsd);
  return usd(w.amountUsd);
}

function phaseTone(phase: WithdrawalView["phase"]): "good" | "wait" | "bad" {
  if (phase === "completed") return "good";
  if (phase === "failed" || phase === "refused") return "bad";
  return "wait";
}

/** `live` — real funds are switched on: an unknown withdrawal is checked; switched off, it waits and says so. */
function Withdrawals({ rows, locale, onChanged, live }: { rows: readonly WithdrawalView[]; locale: WorkspaceLocale; onChanged: () => Promise<void>; live: boolean }) {
  const word = wordsFor(locale);
  const [checking, setChecking] = useState<string | null>(null);
  const check = useCallback(
    async (requestId: string) => {
      setChecking(requestId);
      await post(`/api/predictions/funding/withdrawals/${requestId}`, {});
      setChecking(null);
      await onChanged();
    },
    [onChanged],
  );
  /* One moving withdrawal is followed on its own: every few seconds while it is on the way, a single check while it is unknown. An aged one is not asked about on its own. */
  const moving = live ? rows.find((r) => !r.aged && (r.phase === "in_flight" || r.phase === "sending" || r.phase === "unknown")) : undefined;
  const checkedOnce = useRef<string | null>(null);
  useEffect(() => {
    if (!moving) return undefined;
    if (moving.phase === "unknown") {
      if (checkedOnce.current === moving.requestId) return undefined;
      checkedOnce.current = moving.requestId;
    }
    const timer = setTimeout(() => void check(moving.requestId), moving.phase === "unknown" ? 5_000 : 4_000);
    return () => clearTimeout(timer);
  }, [moving, check]);

  return (
    <>
      <div className={styles.cardHead} style={{ borderTop: "1px solid var(--ry-border)" }}>
        <h3 className={styles.sectionTitle}>{word("withdrawals")}</h3>
      </div>
      <ul className={styles.moneyList}>
        {rows.slice(0, 5).map((w) => (
          <li key={w.requestId}>
            <span>
              <span className={styles.moneyListLine}>
                <b>{withdrawalFigure(w)}</b> USDC{" "}
                <small className={styles.muted}>
                  · {timeShort(w.createdAt, locale)}
                  {w.phase === "partial" && w.amountUsd !== null ? ` · ${usd(w.amountUsd)}` : ""}
                </small>
              </span>
              {w.phase === "unknown" || (w.phase === "sending" && w.aged) ? (
                <span className={styles.hint} data-tone="caution">
                  {word(w.note === DESTINATION_MISMATCH ? "wMismatchText" : w.aged ? "wAgedText" : live ? "wUnknownText" : "wUnknownOffText")}
                </span>
              ) : null}
              {w.phase === "failed" ? <span className={styles.hint}>{word("wFailedText")}</span> : null}
              {w.phase === "refused" ? <span className={styles.hint}>{word("wRefusedText")}</span> : null}
            </span>
            <span className={styles.moneyListEnd}>
              <span className={styles.stateChip} data-tone={phaseTone(w.phase)}>
                {word(PHASE_WORD[w.phase])}
              </span>
              {w.phase === "unknown" && live && !w.aged ? (
                <button type="button" className="rw-btn" disabled={checking === w.requestId} onClick={() => void check(w.requestId)}>
                  {word("wCheck")}
                </button>
              ) : null}
            </span>
          </li>
        ))}
      </ul>
    </>
  );
}
