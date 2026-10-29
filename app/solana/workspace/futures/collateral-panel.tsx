"use client";

import { useEffect, useRef, useState } from "react";

import { Button, Receipt, Review } from "@ryntra/core/ui";

import { dollarsFromMicro, microFromDollars, readSubaccounts, MIN_COLLATERAL_MICRO, type PhoenixMarginWire } from "@/lib/phoenix/collateral-model";
import type { GuardianAction } from "@/lib/phoenix/risk-guardian";
import type { FuturesAccount } from "@/lib/phoenix/market-data";
import { mayOpenWallet } from "@/lib/solana/blockhash-life";
import { explorerTxUrl } from "@/lib/solana/explorer";

import type { SolanaConnectionValue } from "../connection";
import { formatAmount, formatUsdMoney } from "../spot/spot-format";

import { FOLLOW_MS, reviewCollateral, walletSignsV1, signableMsOf, signAndRelay, useCollateralStates, useFollowedRelay, type CollateralRelay, type CollateralReview } from "./collateral-api";
import type { FuturesWordKey } from "./futures-words";
import { RiskGuardian } from "./risk-guardian";

import styles from "./futures.module.css";

type Action = "deposit" | "withdraw";
type Word = (key: FuturesWordKey, fill?: Readonly<Record<string, string>>) => string;

/* A Review, its signature and its receipt belong to the wallet it was built for (`signer`), whatever is connected later. */
type Phase =
  | Readonly<{ kind: "edit" }>
  | Readonly<{ kind: "reviewing" }>
  | Readonly<{ kind: "review"; review: CollateralReview; at: number; signer: string }>
  | Readonly<{ kind: "signing"; review: CollateralReview; at: number; signer: string }>
  | Readonly<{ kind: "done"; review: CollateralReview; relay: CollateralRelay; at: number; signer: string }>;

/* Every digit that is signed: a Review or a receipt never rounds the amount that moves. */
const usdc = (micro: string | bigint, intl: string) => new Intl.NumberFormat(intl, { minimumFractionDigits: 2, maximumFractionDigits: 6 }).format(Number(BigInt(micro)) / 1e6);
const sol = (lamports: string | bigint, intl: string) => `${formatAmount(Number(BigInt(lamports)) / 1e9, intl, 6)} SOL`;
const short = (address: string) => `${address.slice(0, 4)}…${address.slice(-4)}`;
const KNOWN_FAILURES = new Set(["ACTIONS_CLOSED", "CANARY_LIMIT", "INSUFFICIENT_USDC", "OVER_WITHDRAWABLE", "ACCOUNT_NEEDED", "DEPOSIT_CLOSED", "WITHDRAW_CLOSED", "NEEDS_SOL", "SIMULATION_FAILED", "RELAY_REFUSED", "WALLET_REFUSED", "WALLET_MISMATCH", "RATE_LIMITED", "NETWORK"]);
const failureText = (code: string, w: Word) => w((KNOWN_FAILURES.has(code) ? `fail.${code}` : "fail.general") as FuturesWordKey);

/**
 * «Застава» of Ф'ючерси (B6): USDC from the person's own wallet into their Phoenix account and back, each through one
 * Review and one signature of that wallet, ending in a receipt; and the margin those moves change — what the account
 * is worth, what positions hold, what is free to withdraw, how near liquidation. Phoenix's program holds the
 * collateral, never Ryntra, and no fee of Ryntra's is added. Closed until the gate opens (the operator's live check first).
 * The page draws it for a wallet with a Phoenix account only: a guest and a wallet without one get the account block's
 * one line and one action instead (SOL-C7).
 */
export function CollateralPanel({
  connection,
  account,
  lang,
  w,
  onHold,
  folded = false,
  stale = false,
  pro = false,
  onRiskAct,
}: {
  connection: SolanaConnectionValue["connection"];
  account: FuturesAccount | null;
  lang: "en" | "uk";
  w: Word;
  onHold?: (held: boolean) => void;
  /** The terminal's account panel under the ticket (PERP-2): the figures and «Поповнити · Вивести»; the form opens on a press. */
  folded?: boolean;
  /** Phoenix's reads stopped coming (PERP-4): the scale says the figures beside it are the last ones read. */
  stale?: boolean;
  /** Pro opens Phoenix's own risk mechanics under «Що це означає?» (PERP-7, spec §12). */
  pro?: boolean;
  /** «Зменшити», «Закрити» and «Скасувати заявки» belong to the terminal's own order flow; «Поповнити» is this panel's. */
  onRiskAct?: (action: Exclude<GuardianAction, "deposit">) => void;
}) {
  const intl = lang === "uk" ? "uk-UA" : "en-US";
  const owner = connection?.address ?? null;
  const [version, setVersion] = useState(0);
  const states = useCollateralStates(owner, version);
  const [action, setAction] = useState<Action>("deposit");
  /* Folded: the form stands only after «Поповнити» or «Вивести» is pressed, and folds again after a receipt. */
  const [formOpen, setFormOpen] = useState(!folded);
  const [text, setText] = useState("");
  const [phase, setPhase] = useState<Phase>({ kind: "edit" });
  const [failure, setFailure] = useState<string | null>(null);
  /*
   * Each Review is one attempt: an answer for an older one — another wallet, a Review asked again — is dropped. A
   * signature already given is not: once the wallet has signed, the relay's answer reaches the receipt even if another
   * wallet is connected meanwhile, and a receipt stays until the person moves on.
   */
  const attempt = useRef(0);
  const signingNow = useRef(false);
  const ownerNow = useRef(owner);
  /* While a Review is being signed or a receipt stands, the page keeps this panel on screen whatever wallet is connected. */
  const held = phase.kind === "signing" || phase.kind === "done";
  useEffect(() => {
    onHold?.(held);
  }, [held, onHold]);
  useEffect(() => {
    ownerNow.current = owner;
    if (signingNow.current) return;
    attempt.current += 1;
    setPhase((current) => (current.kind === "done" ? current : { kind: "edit" }));
    setFailure(null);
  }, [owner]);

  if (phase.kind === "done") return <CollateralReceipt relay={phase.relay} review={phase.review} at={phase.at} lang={lang} w={w} onAgain={() => {
          setPhase({ kind: "edit" });
          if (folded) setFormOpen(false);
        }} />;
  if (phase.kind === "signing") return reviewView(phase);

  if (!owner || !connection) return null;
  if (account === null || account.wallet !== owner) return <p className={styles.muted} aria-busy="true">{w("loading")}</p>;
  if (account.state === "none" || account.state === "uninitialized") {
    return (
      <p className={styles.muted} data-futures-collateral="no-account">
        {w("noAccount")}
      </p>
    );
  }
  const margin: PhoenixMarginWire | null = account.margin ?? null;
  const amount = microFromDollars(text);

  /* A fresh Review of the same action and amount when the last one aged out; otherwise the form's. */
  async function review(again?: CollateralReview) {
    const asked = again ? { action: again.action, amount: again.amount } : amount === null ? null : { action, amount: amount.toString() };
    if (!owner || asked === null) return;
    setFailure(null);
    setPhase({ kind: "reviewing" });
    const mine = ++attempt.current;
    const answer = await reviewCollateral({ ...asked, owner, ...(connection && walletSignsV1(connection.wallet) ? { format: "v1" as const } : {}) });
    if (mine !== attempt.current) return;
    if (!answer.ok) {
      setFailure(failureText(answer.code, w));
      setPhase({ kind: "edit" });
      return;
    }
    setPhase({ kind: "review", review: answer.value, at: Date.now(), signer: owner });
    if (again) setFailure(w("reviewRefreshed"));
  }

  async function sign(reviewed: CollateralReview, at: number, signer: string) {
    /* Only the wallet the Review was built for signs it. */
    if (!connection || connection.address !== signer) {
      setFailure(failureText("WALLET_MISMATCH", w));
      setPhase({ kind: "edit" });
      return;
    }
    /* The bytes live ~30 s: a Review signed later than its window is built again and read anew. */
    if (!mayOpenWallet({ receivedAtMs: at, signableMs: signableMsOf(reviewed) })) {
      await review(reviewed);
      return;
    }
    setFailure(null);
    setPhase({ kind: "signing", review: reviewed, at, signer });
    const mine = ++attempt.current;
    signingNow.current = true;
    const relayed = await signAndRelay({ wallet: connection.wallet, address: connection.address }, reviewed, at)
      .catch(() => ({ ok: false as const, code: "WALLET_REFUSED" }))
      .finally(() => {
        signingNow.current = false;
      });
    if (mine !== attempt.current) return;
    if (relayed.ok) {
      setText("");
      setVersion((v) => v + 1);
      setPhase({ kind: "done", review: reviewed, relay: relayed.value, at: Date.now(), signer });
      return;
    }
    /* Nothing was sent. Another wallet connected meanwhile starts from its own form, with the relay's own reason. */
    if (ownerNow.current !== signer) {
      setFailure(failureText(relayed.code, w));
      setPhase({ kind: "edit" });
      return;
    }
    if (relayed.code === "REVIEW_AGED" || relayed.code === "TICKET_EXPIRED") {
      await review(reviewed);
      return;
    }
    setFailure(failureText(relayed.code, w));
    setPhase(relayed.code === "WALLET_REFUSED" ? { kind: "review", review: reviewed, at, signer } : { kind: "edit" });
  }

  if (phase.kind === "review") return reviewView(phase);

  function reviewView(shown: Extract<Phase, { kind: "review" | "signing" }>) {
    const reviewed = shown.review;
    const deposit = reviewed.action === "deposit";
    const amountText = usdc(reviewed.amount, intl);
    const receiveText = usdc(reviewed.receive, intl);
    const costs = [
      { label: w("costRyntra"), value: w("costNone") },
      { label: w("costPhoenix"), value: BigInt(reviewed.phoenixFee) > 0n ? `${usdc(reviewed.phoenixFee, intl)} USDC` : w("costNone") },
      { label: w("costNetwork"), value: sol(reviewed.networkFeeLamports, intl) },
      ...(BigInt(reviewed.rentLamports) > 0n ? [{ label: w("costRent"), value: sol(reviewed.rentLamports, intl) }] : []),
    ];
    const solTotal = BigInt(reviewed.networkFeeLamports) + BigInt(reviewed.rentLamports);
    return (
      <div className={styles.collateral}>
        <Review
          lang={lang}
          titleAs="h3"
          title={w(deposit ? "reviewDeposit" : "reviewWithdraw", { x: amountText })}
          pay={w(deposit ? "payWallet" : "payAccount", { x: amountText })}
          get={w(deposit ? "getAccount" : "getWallet", { x: receiveText })}
          costs={costs}
          costsTotal={`${w("costsTotalWord")} · ${sol(solTotal, intl)}`}
          whatItIs={w(deposit ? "whatDeposit" : "whatWithdraw")}
          {...(deposit
            ? {}
            : {
                rows: [
                  ...(reviewed.freeAfter === null ? [] : [{ label: w("freeAfter"), value: `${usdc(reviewed.freeAfter, intl)} USDC` }]),
                  { label: w("marginAfter"), value: w("closerToLiquidation"), tone: "down" as const },
                ],
              })}
          risk={w("riskLine")}
          signer={short(shown.signer)}
          signing={shown.kind === "signing"}
          {...(shown.kind === "signing" ? {} : { onCancel: () => setPhase({ kind: "edit" }) })}
          onConfirm={() => void sign(reviewed, shown.at, shown.signer)}
          details={
            <dl className={styles.details}>
              <div><dt>{w("traderAccount")}</dt><dd translate="no">{reviewed.traderAccount}</dd></div>
              <div><dt>{w("program")}</dt><dd translate="no">EtrnLzgbS7nMMy5fbD42kXiUzGg8XQzJ972Xtk1cjWih</dd></div>
              <div><dt>{w("transactions")}</dt><dd>1</dd></div>
            </dl>
          }
        />
        {failure ? <p className={styles.alert} role="alert">{failure}</p> : null}
      </div>
    );
  }

  const open = action === "deposit" ? states.deposit : states.withdraw;
  const wallet = states.walletUsdc === null ? null : BigInt(states.walletUsdc);
  const withdrawable = margin?.withdrawableMicro == null ? null : BigInt(margin.withdrawableMicro);
  const limit = action === "deposit" ? wallet : withdrawable;
  /* The canary's ceiling holds for both ways. */
  const canary = states.maxMicro !== null ? BigInt(states.maxMicro) : null;
  const hint =
    amount === null || text.trim() === ""
      ? null
      : amount < MIN_COLLATERAL_MICRO
        ? w("minimum")
        : limit !== null && amount > limit
          ? w(action === "deposit" ? "overWallet" : "overWithdrawable")
          : canary !== null && amount > canary
            ? w("canaryLimit", { x: usdc(canary, intl) })
            : null;
  const busy = phase.kind === "reviewing";
  const ready = open && amount !== null && hint === null && amount >= MIN_COLLATERAL_MICRO && !busy;
  const maxOf = () => {
    const top = limit === null ? null : canary !== null && canary < limit ? canary : limit;
    if (top !== null && top > 0n) setText(dollarsFromMicro(top));
  };

  return (
    <div className={styles.collateral} data-futures-collateral={open ? "open" : "closed"}>
      {margin ? (
        <RiskGuardian
          margins={[margin, ...(account.subaccountMargins ?? [])]}
          stale={stale}
          hasPositions={account.positions.some((position) => position.subaccount === 0)}
          hasOrders={account.orders.some((order) => order.subaccount === 0)}
          partial={account.positions.some((position) => !readSubaccounts(account).has(position.subaccount))}
          pro={pro}
          lang={lang}
          intl={intl}
          w={w}
          onAct={(action) => {
            /* Collateral is this panel's own action: it opens the form here rather than travelling out and back. */
            if (action === "deposit") {
              setAction("deposit");
              setFailure(null);
              setFormOpen(true);
              return;
            }
            onRiskAct?.(action);
          }}
        />
      ) : null}
      {margin ? (
        <dl className={styles.marginFacts}>
          <div><dt>{w("portfolio")}</dt><dd>{formatUsdMoney(margin.portfolioUsd, intl)}</dd></div>
          <div><dt>{w("free")}</dt><dd>{withdrawable === null ? "—" : formatUsdMoney(Number(withdrawable) / 1e6, intl)}</dd></div>
          {/* Folded under the ticket: the two figures a trader reads there; the margin's own stand with the form. */}
          {folded && !formOpen ? null : (
            <>
              <div><dt>{w("initialMargin")}</dt><dd>{formatUsdMoney(margin.initialMarginUsd, intl)}</dd></div>
              <div><dt>{w("maintenance")}</dt><dd>{formatUsdMoney(margin.maintenanceMarginUsd, intl)}</dd></div>
            </>
          )}
        </dl>
      ) : null}
      {folded && !formOpen ? (
        <div className={styles.collateralActions}>
          {(["deposit", "withdraw"] as const).map((entry) => (
            <Button
              key={entry}
              variant="secondary"
              lang={lang}
              onClick={() => {
                setAction(entry);
                setFailure(null);
                setFormOpen(true);
              }}
              data-futures-collateral-open={entry}
            >
              {w(entry)}
            </Button>
          ))}
        </div>
      ) : (
        <>
      <div className={styles.segment} role="group" aria-label={w("collateralTitle")}>
        {(["deposit", "withdraw"] as const).map((entry) => (
          <button key={entry} type="button" aria-pressed={action === entry} disabled={busy} onClick={() => { setAction(entry); setFailure(null); }}>
            {w(entry)}
          </button>
        ))}
      </div>
      <label className={styles.amount}>
        <span>{w("amountUsdc")}</span>
        <span className={styles.amountRow}>
          <input inputMode="decimal" autoComplete="off" placeholder="0" value={text} disabled={busy} onChange={(event) => setText(event.target.value)} aria-invalid={hint ? true : undefined} data-futures-amount />
          <button type="button" className={styles.max} disabled={busy || limit === null || limit <= 0n} onClick={maxOf}>
            {w("max")}
          </button>
        </span>
      </label>
      <p className={styles.muted}>
        {action === "deposit" ? w("inWallet", { x: wallet === null ? "—" : usdc(wallet, intl) }) : w("canWithdraw", { x: withdrawable === null ? "—" : usdc(withdrawable, intl) })}
      </p>
      {/* Where the most comes from, and what it already keeps back (PERP-5, spec §16 «Withdrawal blocked»). */}
      {action === "withdraw" ? <p className={styles.muted} data-futures-withdraw-note>{w("withdrawNote")}</p> : null}
      {hint ? <p className={styles.hint} role="status">{hint}</p> : null}
      {failure ? <p className={styles.alert} role="alert">{failure}</p> : null}
      <Button variant="primary" block lang={lang} loading={busy} disabled={!ready} onClick={() => void review()}>
        {busy ? w("preparing") : w("review")}
      </Button>
      {open ? null : <p className={styles.muted}>{w("closedNote")}</p>}
      {folded ? (
        <Button variant="ghost" lang={lang} disabled={busy} onClick={() => setFormOpen(false)}>
          {w("fold")}
        </Button>
      ) : null}
        </>
      )}
    </div>
  );
}

/** The receipt: done when the transaction landed, waiting while the chain has not said, failed otherwise. */
function CollateralReceipt({ relay: answered, review, at, lang, w, onAgain }: { relay: CollateralRelay; review: CollateralReview; at: number; lang: "en" | "uk"; w: Word; onAgain: () => void }) {
  const intl = lang === "uk" ? "uk-UA" : "en-US";
  const relay = useFollowedRelay(answered);
  /* Bytes live ~30 s: once the follow window has passed, an unseen signature can no longer land, and the next move opens. */
  const [waited, setWaited] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setWaited(true), Math.max(0, FOLLOW_MS - (Date.now() - at)));
    return () => clearTimeout(timer);
  }, [at]);
  const result = relay.results[0];
  const state = result?.state ?? "UNKNOWN";
  const status = state === "LANDED" ? "completed" : state === "UNKNOWN" ? "pending" : "failed";
  const deposit = review.action === "deposit";
  const signature = result?.signature ?? "";
  /* What moved, by the chain's record of the wallet's USDC once landed; the Review's figures only until the chain says. */
  const moved = result?.usdcMoved == null ? null : BigInt(result.usdcMoved);
  /* A withdrawal's arrival is Phoenix's to settle at landing: until the chain shows it, the Review's figure is the expected one. */
  const expected = !deposit && moved === null;
  const sent = deposit && moved !== null && moved <= 0n ? -moved : BigInt(review.amount);
  const received = deposit ? BigInt(review.amount) : moved !== null && moved >= 0n ? moved : BigInt(review.receive);
  return (
    <div className={styles.collateral}>
      <Receipt
        lang={lang}
        variant="full"
        titleAs="h3"
        title={status === "completed" ? w(deposit ? "receiptDeposit" : "receiptWithdraw") : status === "pending" ? w("receiptPending") : w("receiptFailed")}
        status={status}
        amount={status === "completed" ? `${deposit ? "−" : "+"}${expected ? "≈" : ""}${usdc(deposit ? sent : received, intl)} USDC` : "—"}
        paid={status === "failed" ? "—" : w(deposit ? "payWallet" : "payAccount", { x: usdc(sent, intl) })}
        got={status === "failed" ? "—" : `${w(deposit ? "getAccount" : "getWallet", { x: usdc(received, intl) })}${expected ? ` · ${w("expected")}` : ""}`}
        costs={`${w("costRyntra")} ${w("costNone")} · ${sol(BigInt(review.networkFeeLamports) + (status === "failed" ? 0n : BigInt(review.rentLamports)), intl)}`}
        time={new Date(at).toLocaleTimeString(intl)}
        network="Solana · Phoenix"
        transaction={short(signature)}
        reason={status === "failed" ? w("receiptNothing") : undefined}
        onVerify={() => window.open(explorerTxUrl("mainnet", signature), "_blank", "noopener,noreferrer")}
        actionsDisabled={status === "pending"}
      />
      {/* While the chain has not answered, a second move could land beside the first: the next one waits. */}
      <Button variant="secondary" lang={lang} onClick={onAgain} disabled={status === "pending" && !waited}>
        {w("again")}
      </Button>
      {status === "pending" && !waited ? <p className={styles.muted}>{w("againWait")}</p> : null}
    </div>
  );
}
