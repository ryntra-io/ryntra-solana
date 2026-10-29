"use client";

import { Receipt as CoreReceipt, Review } from "@ryntra/core/ui";
import { useCallback, useEffect, useRef, useState } from "react";

import type { WorkspaceLocale } from "@/app/shell/locale";
import { useSolanaConnection } from "@/app/solana/workspace/connection";
import type { AllowanceBuildRequest, AllowanceBuildResponse, AllowanceReview, AllowanceSubmitResponse } from "@/lib/solana/allowances/contract";
import { PERIODS, SUBSCRIPTIONS_PROGRAM, USDC, formatRaw, type AllowanceChain } from "@/lib/solana/allowances/model";
import { END_DRIFT_S, sameTerms } from "@/lib/solana/allowances/review-terms";
import { explorerAddressUrl, explorerTxUrl } from "@/lib/solana/explorer";
import { signFreshBytes } from "@/lib/solana/sign-fresh";
import { signTransactions } from "@/lib/solana/wallet.client";

import { allowanceApi, followSent, followsAfter, submitFailure, type Failure, type Follow } from "./allowances-send";
import { FAILURE_WORDS, allowanceWords, issueWord } from "./allowances-words";
import styles from "./allowances.module.css";

export { allowanceApi, type Answer } from "./allowances-send";

export const lang = (locale: WorkspaceLocale) => (locale === "uk" ? "uk" : "en");
export const short = (address: string) => (address.length > 12 ? `${address.slice(0, 4)}…${address.slice(-4)}` : address);
export const networkOf = (chain: AllowanceChain) => (chain === "solana:devnet" ? "devnet" : "mainnet");

/** Base units → «12 500,5 USDC» / «12,500.5 USDC»: every digit the token holds, grouped as the page's language groups them. */
export function money(raw: string | bigint, locale: WorkspaceLocale, token: Readonly<{ decimals: number | null; symbol: string }> = USDC): string {
  if (token.decimals === null) return `${String(raw)} ${token.symbol}`;
  const [whole = "0", fraction] = formatRaw(BigInt(raw), token.decimals).split(".");
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, locale === "uk" ? " " : ",");
  return `${grouped}${fraction ? `${locale === "uk" ? "," : "."}${fraction}` : ""} ${token.symbol}`;
}

const lamports = (raw: string | bigint, locale: WorkspaceLocale) => money(raw, locale, { decimals: 9, symbol: "SOL" });

/** Unix seconds → a date and time in the page's language. */
export function when(ts: string | bigint | number, locale: WorkspaceLocale): string {
  return new Date(Number(ts) * 1000).toLocaleString(locale === "uk" ? "uk-UA" : "en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

/** A period in words: the page's three periods by name, any other (a plan's hours) in units. */
export function periodText(seconds: number, locale: WorkspaceLocale): string {
  const word = allowanceWords(locale);
  if (seconds === PERIODS.day) return word("period_day").toLowerCase();
  if (seconds === PERIODS.week) return word("period_week").toLowerCase();
  if (seconds === PERIODS.month) return word("period_month").toLowerCase();
  const unit = seconds % 86_400 === 0 ? word("unit_d", { n: seconds / 86_400 }) : seconds % 3_600 === 0 ? word("unit_h", { n: seconds / 3_600 }) : word("unit_min", { n: Math.round(seconds / 60) });
  return word("every_s", { n: unit });
}

type Phase = "idle" | "prepare" | "review" | "sign" | "send" | "done" | "error";
type Held = { build: AllowanceBuildResponse; receivedAt: number };
export type AllowanceAction = Readonly<{
  phase: Phase;
  request: AllowanceBuildRequest | null;
  held: Held | null;
  result: AllowanceSubmitResponse | null;
  failure: Failure | null;
  follow: Follow;
  prepare: (request: AllowanceBuildRequest) => Promise<void>;
  confirm: () => Promise<void>;
  reset: () => void;
}>;

/**
 * One spending-limit action from request to receipt: the server builds and answers a Review; on «Підписати» the wallet
 * signs the very bytes reviewed — built again first if they aged on the Review, and again if they aged in the wallet —
 * and the server sends them. Nothing is sent without the wallet's signature.
 */
export function useAllowanceAction(onDone?: (result: AllowanceSubmitResponse | null) => void): AllowanceAction {
  const { connection } = useSolanaConnection();
  const [phase, setPhase] = useState<Phase>("idle");
  const [request, setRequest] = useState<AllowanceBuildRequest | null>(null);
  const [held, setHeld] = useState<Held | null>(null);
  const [result, setResult] = useState<AllowanceSubmitResponse | null>(null);
  const [failure, setFailure] = useState<AllowanceAction["failure"]>(null);
  const heldRef = useRef<Held | null>(null);
  const [follow, setFollow] = useState<Follow>("none");
  /* Each follow has its ticket: only a newer send or leaving the page stops one. A new action, a revoke or a reset
     never does — what was sent stays not known, and said so, until the chain's word is final. */
  const ticket = useRef(0);
  /* Each action has its turn: a follow that ends after the person moved on says its word in the list, not over them. */
  const turn = useRef(0);
  useEffect(
    () => () => {
      ticket.current += 1;
    },
    [],
  );

  /** Reads what was sent until the chain's word is final, and says it: a receipt, «not done», or still not known. */
  const followUp = useCallback(
    async (where: Readonly<{ build: string; wallet: string }>) => {
      const mine = ++ticket.current;
      const at = turn.current;
      setFollow("watching");
      const word = await followSent(where, { stopped: () => ticket.current !== mine });
      if (ticket.current !== mine) return;
      if (!word) {
        setFollow("timeout");
        onDone?.(null);
        return;
      }
      /* The person moved on: the word is said on its own line — a landed one shows in the list, a refused one here. */
      if (turn.current !== at) {
        setFollow(word.state === "FAILED" ? "failed" : word.state === "NOT_LANDED" ? "notLanded" : "none");
        onDone?.(null);
        return;
      }
      setFollow("none");
      if (word.state === "CONFIRMED" && word.signature) {
        const landed: AllowanceSubmitResponse = { state: "CONFIRMED", signature: word.signature, kind: word.kind, delegation: word.delegation, at: word.at };
        setFailure(null);
        setResult(landed);
        setPhase("done");
        onDone?.(landed);
        return;
      }
      setResult(null);
      setFailure({ code: word.state === "FAILED" ? "ALLOWANCE_FAILED_ON_CHAIN" : "ALLOWANCE_NOT_LANDED", message: "" });
      setPhase("error");
      onDone?.(null);
    },
    [onDone],
  );

  const build = useCallback(async (next: AllowanceBuildRequest) => allowanceApi<AllowanceBuildResponse>("/api/solana/allowances/build", { method: "POST", body: JSON.stringify(next) }), []);

  const prepare = useCallback(
    async (next: AllowanceBuildRequest) => {
      turn.current += 1;
      setFollow((now) => (now === "watching" ? now : "none"));
      /* The previous Review is not shown while this one is built. */
      heldRef.current = null;
      setHeld(null);
      setRequest(next);
      setFailure(null);
      setResult(null);
      setPhase("prepare");
      const answer = await build(next);
      if (!answer.ok) {
        setFailure(answer);
        setPhase("error");
        return;
      }
      const fresh = { build: answer.data, receivedAt: Date.now() };
      heldRef.current = fresh;
      setHeld(fresh);
      setPhase("review");
    },
    [build],
  );

  const confirm = useCallback(async () => {
    const current = heldRef.current;
    if (!current || !request || !connection || connection.address !== request.wallet) {
      setFailure({ code: "WALLET_CHANGED", message: "" });
      setPhase("error");
      return;
    }
    let first = true;
    const signed = await signFreshBytes({
      /* The reviewed bytes first; built again only once they can no longer be signed in time. */
      build: async () => {
        if (first) {
          first = false;
          return { ok: true as const, data: current.build };
        }
        setPhase("prepare");
        const again = await build(request);
        if (again.ok) {
          const fresh = { build: again.data, receivedAt: Date.now() };
          heldRef.current = fresh;
          setHeld(fresh);
          /* The chain moved under the Review (a plan made anew, an approval taken): the wallet is not opened on terms
             the person has not read — the new Review is shown instead. */
          if (!sameTerms(current.build.review, again.data.review)) return { ok: false as const, code: "ALLOWANCE_TERMS_CHANGED", message: "" };
        }
        return again;
      },
      signableMsOf: (data) => (data === current.build ? data.signableMs - (Date.now() - current.receivedAt) : data.signableMs),
      sign: async (data) => {
        setPhase("sign");
        const answer = await signTransactions({ wallet: connection.wallet, address: request.wallet, unsignedWireBase64: [...data.unsignedWireBase64], chain: data.network });
        return answer.ok ? { ok: true, value: answer.signedWireBase64 } : answer;
      },
    });
    if (!signed.ok) {
      if (signed.stage === "sign") {
        setFailure({ code: "WALLET_REFUSED", message: signed.reason });
        setPhase("review");
        return;
      }
      if (signed.stage === "build" && signed.failure.code === "ALLOWANCE_TERMS_CHANGED") {
        setFailure(signed.failure);
        setPhase("review");
        return;
      }
      setFailure(signed.stage === "build" ? signed.failure : { code: "ALLOWANCE_BUILD_EXPIRED", message: "" });
      setPhase("error");
      return;
    }
    setPhase("send");
    const sent = await allowanceApi<AllowanceSubmitResponse>("/api/solana/allowances/submit", {
      method: "POST",
      body: JSON.stringify({ buildId: signed.built.buildId, wallet: request.wallet, signedWireBase64: signed.signed }),
    });
    const where = { build: signed.built.buildId, wallet: request.wallet };
    if (!sent.ok) {
      const said = submitFailure(sent);
      setFailure(said);
      setPhase("error");
      /* Not known whether it reached the chain: the list is read again now, and the build's own word until it is final. */
      if (followsAfter(said.code)) {
        onDone?.(null);
        void followUp(where);
      }
      return;
    }
    setResult(sent.data);
    setPhase("done");
    onDone?.(sent.data);
    if (sent.data.state === "PENDING") void followUp(where);
  }, [build, connection, followUp, onDone, request]);

  const reset = useCallback(() => {
    turn.current += 1;
    setFollow((now) => (now === "watching" ? now : "none"));
    heldRef.current = null;
    setHeld(null);
    setRequest(null);
    setResult(null);
    setFailure(null);
    setPhase("idle");
  }, []);

  return { phase, request, held, result, failure, follow, prepare, confirm, reset };
}

/** Which of the revoke's three faces this build is: a limit revoked, a subscription cancelled, or an account closed. */
const revokeFace = (review: AllowanceReview): "revoke" | "cancel" | "close" => (review.revokes === "cancel" ? "cancel" : review.revokes === "close" ? "close" : "revoke");

function titleOf(review: AllowanceReview, locale: WorkspaceLocale): string {
  const word = allowanceWords(locale);
  switch (review.kind) {
    case "fixed":
      return word("reviewFixed");
    case "recurring":
      return word("reviewRecurring");
    case "subscribe":
      return word("reviewSubscribe");
    case "stopAll":
      return word("reviewStopAll");
    case "spend":
      return word("reviewSpend");
    case "revoke": {
      const face = revokeFace(review);
      return face === "cancel" ? word("reviewCancel") : face === "close" ? word("reviewClose") : word("reviewRevoke");
    }
  }
}

/** The core's Review for a built action: what may leave the wallet, to whom and until when, every cost on its own line. */
export function AllowanceReviewCard({ action, locale, network }: { action: AllowanceAction; locale: WorkspaceLocale; network: AllowanceChain }) {
  const word = allowanceWords(locale);
  const held = action.held;
  const request = action.request;
  if (!held || !request) return null;
  const { review } = held.build;
  const amount = review.amountRaw ? money(review.amountRaw, locale) : "";
  const per = review.periodSeconds ? ` ${periodText(review.periodSeconds, locale)}` : "";
  const who = review.counterparty ? short(review.counterparty) : "";
  const ends = review.endsAt && review.endsAt !== "0" ? when(review.endsAt, locale) : null;
  const face = review.kind === "revoke" ? revokeFace(review) : null;

  const pay =
    review.kind === "fixed" || review.kind === "recurring" || review.kind === "subscribe"
      ? word("payUpTo", { amount: `${amount}${per}` })
      : review.kind === "spend"
        ? word("paySpend", { amount, from: who })
        : word("payNothing");
  const get =
    review.kind === "fixed" || review.kind === "recurring" || review.kind === "subscribe"
      ? ends
        ? word("getLimit", { who, date: ends })
        : word("getLimitNoEnd", { who })
      : review.kind === "spend"
        ? word("getSpend", { amount, to: short(review.to ?? "") })
        : review.kind === "stopAll"
          ? review.stops === null
            ? word("getStopAllUnknown")
            : word("getStopAll", { n: review.stops })
          : face === "cancel"
            ? word("getCancel")
            : face === "close"
              ? word("getClose")
              : word("getRevoke");

  const network$ = BigInt(held.build.networkCostLamports);
  const rent = BigInt(review.rentLamports);
  const refund = BigInt(review.refundLamports);
  const costs = [
    { label: word("costNetwork"), value: lamports(network$, locale) },
    ...(rent > 0n ? [{ label: word("costRent"), value: `≈ ${lamports(rent, locale)}` }] : []),
    ...(refund > 0n ? [{ label: word("costRefund"), value: `− ${lamports(refund, locale)}` }] : []),
    { label: word("costRyntra"), value: lamports(0n, locale) },
  ];
  const rows = [
    ...(review.approves === "first" ? [{ label: "USDC", value: word("rowApprovesFirst") }] : []),
    ...(review.approves === "again" ? [{ label: "USDC", value: word("rowApprovesAgain"), tone: "down" as const }] : []),
    ...(review.replacesDelegate ? [{ label: "USDC", value: word("rowReplaces", { who: short(review.replacesDelegate) }), tone: "down" as const }] : []),
    ...(review.grace ? [{ label: word("status"), value: word("rowGrace", { amount: money(review.grace.raw, locale), date: when(review.grace.until, locale) }), tone: "down" as const }] : []),
    ...(review.graceUnknown ? [{ label: word("status"), value: word("rowGraceUnknown"), tone: "down" as const }] : []),
    ...(review.closesOnly ? [{ label: "USDC", value: word("rowClosesOnly") }] : []),
    ...(review.remainsDelegate ? [{ label: "USDC", value: word("rowRemains", { who: short(review.remainsDelegate) }), tone: "down" as const }] : []),
    ...(ends && (review.kind === "fixed" || review.kind === "recurring") ? [{ label: word("until"), value: word("rowEndDrift", { date: ends, n: Number(END_DRIFT_S / 60n) }) }] : []),
    ...(review.plan ? [{ label: word("rowPlanTo"), value: `${review.plan.destinations.map(short).join(", ") || word("rowPlanAnywhere")} · ${word("rowPlanToFixed")}` }] : []),
    ...(review.plan ? [{ label: word("rowPullers"), value: `${[short(review.plan.merchant), ...review.plan.pullers.map(short)].join(", ")} · ${word("rowPullersMay")}` }] : []),
    ...(review.opensTokenAccount ? [{ label: word("to"), value: word("rowOpens") }] : []),
  ];
  const what =
    review.kind === "fixed"
      ? word("whatFixed")
      : review.kind === "recurring"
        ? word("whatRecurring")
        : review.kind === "subscribe"
          ? word("whatSubscribe")
          : review.kind === "stopAll"
            ? word("whatStopAll")
            : review.kind === "spend"
              ? word("whatSpend")
              : face === "cancel"
                ? word("whatCancel")
                : face === "close"
                  ? word("whatClose")
                  : word("whatRevoke");
  const net = networkOf(network);
  return (
    <Review
      className={styles.review}
      title={titleOf(review, locale)}
      titleAs="h2"
      pay={pay}
      get={get}
      costs={costs}
      costsTotal={lamports(network$ + rent > refund ? network$ + rent - refund : 0n, locale)}
      rows={rows}
      whatItIs={what}
      details={
        <dl className={styles.details}>
          {review.delegation ? (
            <div>
              <dt>{word("detailAccount")}</dt>
              <dd>
                <a className={styles.mono} href={explorerAddressUrl(net, review.delegation)} target="_blank" rel="noreferrer">
                  {review.delegation}
                </a>
              </dd>
            </div>
          ) : null}
          {review.counterparty ? (
            <div>
              <dt>{review.kind === "spend" ? word("detailFrom") : review.kind === "subscribe" || face === "cancel" ? word("detailMerchant") : word("detailWho")}</dt>
              <dd>
                <a className={styles.mono} href={explorerAddressUrl(net, review.counterparty)} target="_blank" rel="noreferrer">
                  {review.counterparty}
                </a>
              </dd>
            </div>
          ) : null}
          {review.to ? (
            <div>
              <dt>{word("detailTo")}</dt>
              <dd>
                <a className={styles.mono} href={explorerAddressUrl(net, review.to)} target="_blank" rel="noreferrer">
                  {review.to}
                </a>
              </dd>
            </div>
          ) : null}
          {review.plan ? (
            <div>
              <dt>{word("detailPlan")}</dt>
              <dd className={styles.mono}>{review.plan.address}</dd>
            </div>
          ) : null}
          <div>
            <dt>{word("detailProgram")}</dt>
            <dd className={styles.mono}>Subscriptions · {SUBSCRIPTIONS_PROGRAM}</dd>
          </div>
          <div>
            <dt>{word("detailNetwork")}</dt>
            <dd>{network === "solana:devnet" ? "Solana Devnet" : "Solana"}</dd>
          </div>
        </dl>
      }
      signWith="wallet"
      ready={action.phase === "review"}
      signing={action.phase === "sign" || action.phase === "send" || action.phase === "prepare"}
      blockedReason={action.phase === "sign" ? word("signing") : action.phase === "send" ? word("sending") : action.phase === "prepare" ? word("preparing") : undefined}
      risk={review.kind === "fixed" || review.kind === "recurring" ? word("risk") : review.kind === "subscribe" ? (review.endsAt === "0" ? word("riskSubscribeNoEnd") : word("riskSubscribe")) : undefined}
      onCancel={action.reset}
      onConfirm={() => void action.confirm()}
      lang={lang(locale)}
    />
  );
}

/** The core's receipt after a send: what happened, its signature on the explorer. */
export function AllowanceReceiptCard({ action, locale, network }: { action: AllowanceAction; locale: WorkspaceLocale; network: AllowanceChain }) {
  const word = allowanceWords(locale);
  const result = action.result;
  const review = action.held?.build.review;
  if (!result) return null;
  const net = networkOf(network);
  const amount = review?.amountRaw ? `${money(review.amountRaw, locale)}${review.periodSeconds ? ` ${periodText(review.periodSeconds, locale)}` : ""}` : review?.delegation ? short(review.delegation) : "";
  const pending = result.state !== "CONFIRMED";
  return (
    <div className={styles.receiptWrap}>
      <CoreReceipt
        variant="full"
        /* Sent is not done: a PENDING receipt names no result until the chain's word is final. */
        title={pending ? word("receiptTitle_pending") : word(`receiptTitle_${result.kind}`)}
        status={pending ? "pending" : "completed"}
        amount={amount}
        time={new Date(result.at).toLocaleString(locale === "uk" ? "uk-UA" : "en-GB")}
        network={network === "solana:devnet" ? "Solana Devnet" : "Solana"}
        transaction={short(result.signature)}
        onVerify={() => window.open(explorerTxUrl(net, result.signature), "_blank", "noopener")}
        lang={lang(locale)}
      />
      <div className={styles.actionsRow}>
        <button type="button" className={styles.linkButton} onClick={action.reset}>
          {word("done")}
        </button>
      </div>
    </div>
  );
}

/** What is still not known after a send, outside the core's Receipt: read again now, or no final word in time. */
export function FollowLine({ follow, locale }: { follow: Follow; locale: WorkspaceLocale }) {
  const word = allowanceWords(locale);
  if (follow === "none") return null;
  return (
    <p className={follow === "watching" ? styles.hint : styles.warnLine} role="status">
      {follow === "watching" ? word("followWatching") : follow === "failed" ? word("followFailed") : follow === "notLanded" ? word("followNotLanded") : word("followTimeout")}
    </p>
  );
}

/** A failure in one line: the wallet's refusal, a broken rule, or what the network said. */
export function FailureLine({ action, locale }: { action: AllowanceAction; locale: WorkspaceLocale }) {
  const word = allowanceWords(locale);
  const failure = action.failure;
  if (!failure) return null;
  const known = FAILURE_WORDS[failure.code]?.[locale];
  const text = failure.code === "WALLET_REFUSED" ? word("refused") : word("failed", { reason: known ?? (failure.message || failure.code) });
  return (
    <div className={styles.failure} role="alert">
      <p>{text}</p>
      {failure.issues?.length ? (
        <ul className={styles.issues}>
          {failure.issues.slice(0, 6).map((issue, index) => (
            <li key={`${issue.code}:${index}`}>{issueWord(locale, issue.code)}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
