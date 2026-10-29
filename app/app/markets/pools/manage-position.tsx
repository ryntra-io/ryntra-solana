"use client";

import { Block, Button, EmptyState, Review, Skeleton } from "@ryntra/core/ui";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { useWalletReach } from "@/app/app/invest/use-wallet-reach";
import type { WorkspaceLocale } from "@/app/shell/locale";
import { useSolanaConnection } from "@/app/solana/workspace/connection";
import { formatAmount, formatUsdMoney } from "@/app/solana/workspace/spot/spot-format";
import type { PositionView } from "@/lib/liquidity/catalog/positions";
import type { Amount } from "@ryntra/core/adapters";
import type { ClaimFeesPreview, RemoveLiquidityPreview } from "@/lib/liquidity/studio/contract";
import { mayOpenWallet } from "@/lib/solana/blockhash-life";

import { chainCosts, failureText, noticeTexts, RelayReceipt, short, solTotal } from "./action-shared";
import { reviewAction, signableMsOf, signAndRelay, useActionStates, type LiquidityRelay, type LiquidityReview } from "./liquidity-api";
import { DEFAULT_SLIPPAGE_BPS, fromBaseUnits, WITHDRAW_SHARES } from "./liquidity-form";
import { forgetPositions, usePositions } from "./my-positions";
import { recordClaim, recordRemove, usePositionEntries } from "./position-entries";
import { adviceOf, PositionWatch } from "./position-watch";
import { formatPoolPrice } from "./pool-format";
import { ReadTime } from "./read-time";
import { POOL_KEY, poolsWords } from "./pools-words";
import styles from "./pools.module.css";

type Mode = "claim" | "remove";

type Phase =
  | Readonly<{ kind: "edit" }>
  | Readonly<{ kind: "reviewing" }>
  | Readonly<{ kind: "review"; review: LiquidityReview; at: number }>
  | Readonly<{ kind: "signing"; review: LiquidityReview; at: number }>
  | Readonly<{ kind: "done"; review: LiquidityReview; relay: LiquidityRelay; view: PositionView; at: number }>;


const VENUE_OF_KIND = { dlmm: "meteora-dlmm", "damm-v2": "meteora-damm2" } as const;

/** Claimed amounts in USD at the position's token prices; null when either is unpriced. */
function usdOf(amounts: Readonly<{ x: Amount; y: Amount }>, view: PositionView): number | null {
  if (view.x.priceUsd === null || view.y.priceUsd === null) return null;
  return fromBaseUnits(amounts.x.units, amounts.x.decimals) * view.x.priceUsd + fromBaseUnits(amounts.y.units, amounts.y.decimals) * view.y.priceUsd;
}

/**
 * One position of the connected wallet, read from the chain: what it holds,
 * what it earned, whether the price is inside it — and the two things to do
 * with it, claim the fees or withdraw a share, each through one Review and one
 * signature. Above them (SOL-2b): the divergence loss and net result against
 * the entry, and out of range the rebalance — withdraw here, then open a new
 * range — each step signed by the person; `rebalance` opens on «withdraw all».
 */
export function ManagePosition({ locale, pool, position, rebalance = false }: { locale: WorkspaceLocale; pool: string; position: string; rebalance?: boolean }) {
  const word = poolsWords(locale);
  const lang: "en" | "uk" = locale === "uk" ? "uk" : "en";
  const numberLocale = locale === "uk" ? "uk-UA" : "en-US";
  const router = useRouter();
  const { connection } = useSolanaConnection();
  const owner = connection?.address ?? null;
  const { openInWallet, reach } = useWalletReach();
  const states = useActionStates(owner);
  const read = usePositions(owner);
  const [mode, setMode] = useState<Mode | null>(rebalance ? "remove" : null);
  const [share, setShare] = useState<number>(10_000);
  const entries = usePositionEntries(owner, read.status === "ready" && read.owner === owner ? read.answer.positions : null);
  const [phase, setPhase] = useState<Phase>({ kind: "edit" });
  const [failure, setFailure] = useState<string | null>(null);
  /* Each Review and each signature is one attempt: an answer for an older one — another wallet, a Review asked again —
     is dropped, and nothing replaces a receipt but the person's own step back. */
  const attempt = useRef(0);
  /* Another wallet: a Review built for the last one is not this one's. */
  useEffect(() => {
    attempt.current += 1;
    setPhase((current) => (current.kind === "done" ? current : { kind: "edit" }));
    setFailure(null);
  }, [owner]);

  if (!owner) {
    return (
      <Block title={word("manageTitle")} titleAs="h2" icon="wallet" lang={lang}>
        <EmptyState icon="wallet" text={word("connectToAct")} action={<Button variant="secondary" onClick={reach} lang={lang}>{openInWallet ? word("openInPhantom") : word("connectWallet")}</Button>} />
      </Block>
    );
  }
  if ((read.status !== "ready" && read.status !== "failed") || read.owner !== owner) {
    return (
      <Block title={word("manageTitle")} titleAs="h2" icon="wallet" lang={lang}>
        <Skeleton lines={3} label={word("loadingPositions")} />
      </Block>
    );
  }
  if (read.status === "failed") {
    return (
      <Block title={word("manageTitle")} titleAs="h2" icon="wallet" lang={lang}>
        <EmptyState icon="circle-x" role="status" text={read.busy ? word("positionsBusy") : word("positionsDown")} />
      </Block>
    );
  }
  const held = read.answer.positions.find((entry) => entry.address === position && entry.pool === pool) ?? null;

  const human = (amount: Amount, symbol: string) => `${formatAmount(fromBaseUnits(amount.units, amount.decimals), numberLocale, amount.decimals)} ${symbol}`;
  const pair = (amounts: Readonly<{ x: Amount; y: Amount }>, view: PositionView) =>
    [amounts.x.units !== "0" ? human(amounts.x, view.x.symbol) : null, amounts.y.units !== "0" ? human(amounts.y, view.y.symbol) : null].filter(Boolean).join(" + ") || "0";

  /* The receipt keeps the position as it was reviewed: a closed one is gone from the chain's answer. */
  if (phase.kind === "done") {
    const preview = phase.review.preview;
    const view = phase.view;
    /* Claimed fees are counted to the unit; a withdrawal comes back at the price it met, so it is «about». */
    /* A rebalance's withdrawal that landed: its second step, a new range of the same width around the price. */
    const after = adviceOf(view);
    const next = preview.action === "remove" && phase.relay.settled && view.kind === "dlmm" && after.kind === "out" && after.reopen ? `/app/markets/pools/${pool}/add?rebalance=${after.reopen.span.toFixed(6)}` : null;
    const amount = preview.action === "claim" ? `+${pair((preview as ClaimFeesPreview).claimed, view)}` : `≈ +${pair((preview as RemoveLiquidityPreview).expected, view)}`;
    return (
      <div className={styles.actionStack}>
        <RelayReceipt relay={phase.relay} at={phase.at} title={`${preview.action === "claim" ? word("receiptClaimed") : word("receiptRemoved")} · ${word(POOL_KEY[view.kind])}`} amount={amount} word={word} lang={lang} numberLocale={numberLocale} />
        {next ? (
          <Link href={next} className={styles.step} prefetch={false} data-pools="rebalance-next">
            {word("rebalanceStep2")}
          </Link>
        ) : null}
        <Button variant="secondary" lang={lang} onClick={() => router.push(`/app/markets/pools/${pool}`)}>
          {word("newAdd")}
        </Button>
      </div>
    );
  }
  if (!held) {
    return (
      <Block title={word("manageTitle")} titleAs="h2" icon="wallet" lang={lang}>
        <EmptyState icon="target" role="status" text={word("positionGone")} />
      </Block>
    );
  }

  const venue = VENUE_OF_KIND[held.kind];
  const canClaim = !held.feesElsewhere && (held.x.unclaimed > 0 || held.y.unclaimed > 0);
  const canRemove = held.lockedBps < 10_000 && (held.x.amount > 0 || held.y.amount > 0 || held.x.unclaimed > 0 || held.y.unclaimed > 0);
  const active: Mode = mode ?? (canClaim ? "claim" : "remove");
  const closesAll = share === 10_000 && held.lockedBps === 0 && !held.feesElsewhere;

  async function review(refreshed = false) {
    if (!owner || !held) return;
    setFailure(null);
    setPhase({ kind: "reviewing" });
    const mine = ++attempt.current;
    const answer = await reviewAction(
      active === "claim"
        ? { action: "claim", venue, request: { position: held.address, owner } }
        : { action: "remove", venue, request: { position: held.address, owner, shareBps: share, close: closesAll, slippageBps: DEFAULT_SLIPPAGE_BPS } },
    );
    if (mine !== attempt.current) return;
    if (!answer.ok) {
      setFailure(failureText(answer.code, word));
      setPhase({ kind: "edit" });
      return;
    }
    setPhase({ kind: "review", review: answer.value, at: Date.now() });
    if (refreshed) setFailure(word("reviewRefreshed"));
  }

  async function sign(reviewed: LiquidityReview, at: number) {
    if (!connection || !held) return;
    /*
     * The bytes live ~30 s (`lib/solana/blockhash-life.ts`). A Review signed later than its window is built again here
     * and the person reads the new one — the network is never handed bytes it would refuse.
     */
    if (!mayOpenWallet({ receivedAtMs: at, signableMs: signableMsOf(reviewed) })) {
      await review(true);
      return;
    }
    setFailure(null);
    setPhase({ kind: "signing", review: reviewed, at });
    const mine = ++attempt.current;
    const relayed = await signAndRelay({ wallet: connection.wallet, address: connection.address }, reviewed, at).catch(() => ({ ok: false as const, code: "WALLET_REFUSED" }));
    if (mine !== attempt.current) return;
    /* The bytes aged out while the wallet was open, or the network found their blockhash gone: nothing moved. */
    if (!relayed.ok && (relayed.code === "REVIEW_AGED" || relayed.code === "TICKET_EXPIRED")) {
      await review(true);
      return;
    }
    if (!relayed.ok) {
      setFailure(failureText(relayed.code, word));
      setPhase(relayed.code === "WALLET_REFUSED" ? { kind: "review", review: reviewed, at } : { kind: "edit" });
      return;
    }
    forgetPositions(connection.address);
    /* The entry follows what landed (SOL-2b): a withdrawal keeps the part still in; a claim counts with what was earned. */
    if (relayed.value.settled) {
      const done = reviewed.preview;
      if (done.action === "remove") recordRemove(connection.address, held.address, (done as RemoveLiquidityPreview).request.shareBps, (done as RemoveLiquidityPreview).closesPosition, held.lockedBps);
      if (done.action === "claim") recordClaim(connection.address, held.address, usdOf((done as ClaimFeesPreview).claimed, held));
    }
    setPhase({ kind: "done", review: reviewed, relay: relayed.value, view: held, at: Date.now() });
  }

  if (phase.kind === "review" || phase.kind === "signing") {
    const reviewed = phase.review;
    const preview = reviewed.preview;
    const notices = noticeTexts(preview.notices, word);
    const costs = [{ label: "Ryntra", value: word("ryntraNone") }, { label: "Meteora", value: word("meteoraNoneAction") }, ...chainCosts(reviewed, word, numberLocale)];
    const common = {
      lang,
      titleAs: "h2" as const,
      costs,
      costsTotal: `${word("costsNone")} · ${solTotal(reviewed, word, numberLocale)}`,
      signer: short(owner),
      signing: phase.kind === "signing",
      ...(phase.kind === "signing" ? {} : { onCancel: () => setPhase({ kind: "edit" }) }),
      onConfirm: () => void sign(reviewed, phase.at),
      details: (
        <dl className={styles.detailsList}>
          <div><dt>{word("poolAddress")}</dt><dd translate="no">{pool}</dd></div>
          <div><dt>{word("positionAccount")}</dt><dd translate="no">{held.address}</dd></div>
          <div><dt>{word("transactions")}</dt><dd>{reviewed.transactions.length}</dd></div>
        </dl>
      ),
    };
    return (
      <div className={styles.actionStack}>
        {notices.map((text) => (
          <p key={text} className={styles.positionWarn} role="status">
            {text}
          </p>
        ))}
        {preview.action === "claim" ? (
          <Review
            {...common}
            title={`${word("claimFees")} · ${held.x.symbol}/${held.y.symbol} · ${word(POOL_KEY[held.kind])}`}
            pay={word("networkOnly")}
            get={pair((preview as ClaimFeesPreview).claimed, held)}
            whatItIs={word("whatClaim")}
            risk={word("validFor")}
          />
        ) : (
          <Review
            {...common}
            title={`${word("withdraw")} ${((preview as RemoveLiquidityPreview).request.shareBps / 100).toLocaleString(numberLocale)} % · ${held.x.symbol}/${held.y.symbol} · ${word(POOL_KEY[held.kind])}`}
            pay={`${((preview as RemoveLiquidityPreview).request.shareBps / 100).toLocaleString(numberLocale)} % ${word("sharePosition")}`}
            get={pair((preview as RemoveLiquidityPreview).expected, held)}
            {...((preview as RemoveLiquidityPreview).minimum ? { atLeast: `${word("atLeastWord")} ${pair((preview as RemoveLiquidityPreview).minimum!, held)}` } : {})}
            rows={(preview as RemoveLiquidityPreview).closesPosition ? [{ label: word("feesWith"), value: pair((preview as RemoveLiquidityPreview).feesClaimed, held) }] : []}
            whatItIs={word("whatRemove")}
            risk={`${word("riskRemove")} ${word("validFor")}`}
          />
        )}
        {failure ? <p className={styles.note} role="alert">{failure}</p> : null}
      </div>
    );
  }

  const busy = phase.kind === "reviewing";
  const state = active === "claim" ? states.claim : states.remove;
  const closed = state.status !== "on";
  const rangeWord = held.rangeState === "in_range" ? word("inRange") : held.rangeState === "above" ? word("outAbove") : word("outBelow");
  return (
    <div className={styles.actionStack}>
      <dl className={styles.facts}>
        <div className={styles.fact}>
          <dt>{word("value")}</dt>
          <dd>{held.valueUsd === null ? "—" : formatUsdMoney(held.valueUsd, numberLocale)}</dd>
          <span className={styles.factNote}>{formatAmount(held.x.amount, numberLocale)} {held.x.symbol} · {formatAmount(held.y.amount, numberLocale)} {held.y.symbol}</span>
        </div>
        <div className={styles.fact}>
          <dt>{word("unclaimed")}</dt>
          <dd>{held.unclaimedUsd === null ? "—" : formatUsdMoney(held.unclaimedUsd, numberLocale)}</dd>
          <span className={styles.factNote}>{formatAmount(held.x.unclaimed, numberLocale)} {held.x.symbol} · {formatAmount(held.y.unclaimed, numberLocale)} {held.y.symbol}</span>
        </div>
        <div className={styles.fact} data-tone={held.rangeState === "in_range" ? "up" : "down"}>
          <dt>{word("rangeOf")}</dt>
          <dd>{rangeWord}</dd>
          <span className={styles.factNote}>{formatPoolPrice(held.lower, numberLocale)} – {held.upper === null ? "∞" : formatPoolPrice(held.upper, numberLocale)} {held.y.symbol}</span>
        </div>
      </dl>
      {held.feesElsewhere ? <p className={styles.positionLine}>{word("feesElsewhere")}</p> : null}
      {held.lockedBps > 0 ? <p className={styles.positionLine}>{Math.round(held.lockedBps / 100)}% {word("locked")}</p> : null}
      <PositionWatch
        position={held}
        entry={entries[held.address] ?? null}
        owner={owner}
        locale={locale}
        withdrawOpen={canRemove && states.remove.status === "on" && !busy}
        onWithdrawAll={() => {
          setMode("remove");
          setShare(10_000);
          /* The withdraw form may only now appear: scroll to it once it is drawn. */
          requestAnimationFrame(() => requestAnimationFrame(() => document.getElementById("pools-share")?.scrollIntoView({ block: "center" })));
        }}
      />

      <div className={styles.simMoves} role="group" aria-label={word("manageTitle")}>
        <button type="button" className={styles.order} aria-pressed={active === "claim"} disabled={busy || !canClaim} onClick={() => setMode("claim")}>
          {word("claimFees")}
        </button>
        <button type="button" className={styles.order} aria-pressed={active === "remove"} disabled={busy || !canRemove} onClick={() => setMode("remove")}>
          {word("withdraw")}
        </button>
      </div>
      {active === "remove" ? (
        <div className={styles.simField}>
          <span id="pools-share">{word("withdrawShare")}</span>
          <div className={styles.simMoves} role="group" aria-labelledby="pools-share">
            {WITHDRAW_SHARES.map((entry) => (
              <button key={entry} type="button" className={styles.order} aria-pressed={share === entry} disabled={busy} onClick={() => setShare(entry)}>
                {entry === 10_000 && held.lockedBps === 0 && !held.feesElsewhere ? word("withdrawAll") : `${entry / 100} %`}
              </button>
            ))}
          </div>
        </div>
      ) : null}
      {failure ? <p className={styles.note} role="alert">{failure}</p> : null}
      <div className={styles.formAction}>
        <Button variant="primary" block lang={lang} loading={busy} disabled={closed || (active === "claim" ? !canClaim : !canRemove)} onClick={() => void review()}>
          {busy ? word("preparing") : word("review")}
        </Button>
      </div>
      <p className={styles.sourcesLine}>
        {closed ? `${word("failClosed")} · ` : null}
        {word("sourceChain")} · <ReadTime at={read.answer.at} locale={numberLocale} />
      </p>
    </div>
  );
}
