"use client";

import { Block, Button, EmptyState, Review } from "@ryntra/core/ui";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";

import { useWalletReach } from "@/app/app/invest/use-wallet-reach";
import type { WorkspaceLocale } from "@/app/shell/locale";
import { useSolanaConnection } from "@/app/solana/workspace/connection";
import { formatAmount, formatUsdMoney } from "@/app/solana/workspace/spot/spot-format";
import { useHoldingOf, useSpotHoldings } from "@/app/solana/workspace/spot/use-spot-data";
import type { LiquidityPoolKind } from "@/lib/liquidity/catalog/model";
import type { AddLiquidityPreview, LiquidityVenueId } from "@/lib/liquidity/studio/contract";
import { WRAPPED_SOL_MINT } from "@/lib/solana/send-kinds";
import { mayOpenWallet } from "@/lib/solana/blockhash-life";

import { forgetPositions, usePositions } from "./my-positions";
import { recordAdd, usePositionEntries } from "./position-entries";
import { chainCosts, failureText, noticeTexts, RelayReceipt, short, solTotal } from "./action-shared";
import { reviewAction, signableMsOf, signAndRelay, useActionStates, type LiquidityRelay, type LiquidityReview } from "./liquidity-api";
import {
  DEFAULT_SLIPPAGE_BPS,
  dlmmBins,
  fromBaseUnits,
  HALF_WIDTH,
  priceAtOffset,
  SOL_RESERVE_LAMPORTS,
  RANGE_PLACES,
  RANGE_WIDTHS,
  sidesOf,
  SLIPPAGES_BPS,
  toBaseUnits,
  typedFromUnits,
  typedOf,
  type RangePlace,
  type RangeWidth,
} from "./liquidity-form";
import { formatPoolPrice } from "./pool-format";
import { poolsWords, type PoolsWord } from "./pools-words";
import styles from "./pools.module.css";

export type AddToken = Readonly<{ mint: string; decimals: number; symbol: string; priceUsd: number | null }>;

export type AddLiquidityProps = Readonly<{
  locale: WorkspaceLocale;
  kind: LiquidityPoolKind;
  venue: LiquidityVenueId;
  venueLabel: string;
  pool: string;
  x: AddToken;
  y: AddToken;
  /** Y per one X now, from the chain. */
  price: number;
  /** DLMM only. */
  activeBin: number | null;
  binStepBps: number | null;
  /** DAMM v2: the pool's own range, as the page reads it; null bounds — the whole curve. */
  range: Readonly<{ min: number | null; max: number | null }> | null;
  enabled: boolean;
  /** DLMM: the width to start from — a rebalance opens the width the person's old position had (SOL-2b). */
  startWidth?: RangeWidth;
  /** Set when the page was opened as a rebalance: the form says so. */
  rebalance?: boolean;
}>;

type Phase =
  | Readonly<{ kind: "edit" }>
  | Readonly<{ kind: "reviewing" }>
  | Readonly<{ kind: "review"; review: LiquidityReview; at: number }>
  | Readonly<{ kind: "signing"; review: LiquidityReview; at: number }>
  | Readonly<{ kind: "done"; review: LiquidityReview; relay: LiquidityRelay; at: number }>;

const SHAPES = ["spot", "curve", "bid_ask"] as const;
const SHAPE_WORD: Readonly<Record<(typeof SHAPES)[number], PoolsWord>> = { spot: "shapeSpot", curve: "shapeCurve", bid_ask: "shapeBidAsk" };
const PLACE_WORD: Readonly<Record<RangePlace, PoolsWord>> = { around: "placeAround", above: "placeAbove", below: "placeBelow" };
const PLACE_NOTE: Readonly<Record<RangePlace, PoolsWord>> = { around: "placeAroundNote", above: "placeAboveNote", below: "placeBelowNote" };
const WIDTH_WORD: Readonly<Record<RangeWidth, PoolsWord>> = { narrow: "widthNarrow", medium: "widthMedium", wide: "widthWide" };

/**
 * «Додати ліквідність»: two amounts, and on DLMM where and how wide; then one
 * Review with every cost on its own line, one signature in the wallet, and a
 * receipt. Nothing is offered while the gate keeps actions closed.
 */
export function AddLiquidity(props: AddLiquidityProps) {
  const { locale, kind, venue, venueLabel, pool, x, y, price, activeBin, binStepBps, range, enabled, startWidth, rebalance } = props;
  const word = poolsWords(locale);
  const lang = locale === "uk" ? "uk" : "en";
  const numberLocale = locale === "uk" ? "uk-UA" : "en-US";
  const router = useRouter();
  /* Fixed ids: a generated one drifts between the server and the browser under the page frame. */
  const id = "pools-add";
  const { connection } = useSolanaConnection();
  const owner = connection?.address ?? null;
  const { openInWallet, reach } = useWalletReach();
  const states = useActionStates(owner);
  const holdings = useSpotHoldings(owner, 0);
  const xHolding = useHoldingOf(holdings, x.mint, WRAPPED_SOL_MINT);
  const yHolding = useHoldingOf(holdings, y.mint, WRAPPED_SOL_MINT);

  const [typedX, setTypedX] = useState("");
  const [typedY, setTypedY] = useState("");
  const [place, setPlace] = useState<RangePlace>("around");
  const [width, setWidth] = useState<RangeWidth>(startWidth ?? "medium");
  const [shape, setShape] = useState<(typeof SHAPES)[number]>("spot");
  const [slippage, setSlippage] = useState<number>(DEFAULT_SLIPPAGE_BPS);
  const [phase, setPhase] = useState<Phase>({ kind: "edit" });
  /* Once a deposit landed, the receipt reads the new position: its own amounts settle the entry the Review only capped (SOL-2b). */
  const landed = usePositions(phase.kind === "done" && phase.relay.settled ? owner : null);
  usePositionEntries(owner, landed.status === "ready" && landed.owner === owner ? landed.answer.positions : null);
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

  const dlmm = kind === "dlmm" && activeBin !== null && binStepBps !== null;
  const sides = dlmm ? sidesOf(place) : { x: true, y: true };
  const bins = dlmm ? dlmmBins(activeBin, width, place) : null;
  const unitsX = sides.x ? toBaseUnits(typedX || "0", x.decimals) : "0";
  const unitsY = sides.y ? toBaseUnits(typedY || "0", y.decimals) : "0";
  /* The wallet's balance, base units: what it holds is what the field is measured against. */
  const balanceOf = (holding: typeof xHolding): bigint | null => (holding ? BigInt(holding.spendableRaw) : holdings.status === "ready" ? 0n : null);
  /*
   * «Max» leaves SOL for a new position's rent and the network; a smaller amount typed by hand is the person's call, and
   * whether the rent still fits is the Review's simulation to say — the field does not refuse it.
   */
  const maxOf = (balance: bigint | null, token: AddToken): bigint | null => {
    if (balance === null || token.mint !== WRAPPED_SOL_MINT) return balance;
    return balance > SOL_RESERVE_LAMPORTS ? balance - SOL_RESERVE_LAMPORTS : 0n;
  };
  const xBalance = balanceOf(xHolding);
  const yBalance = balanceOf(yHolding);
  const over = (units: string | null, balance: bigint | null) => units !== null && balance !== null && BigInt(units) > balance;
  const overX = over(unitsX, xBalance);
  const overY = over(unitsY, yBalance);
  const invalid = unitsX === null || unitsY === null || (unitsX === "0" && unitsY === "0");
  const action = states.add;

  const rangeText = useMemo(() => {
    if (dlmm && bins) {
      const low = priceAtOffset(price, binStepBps, bins.lower - activeBin);
      const high = priceAtOffset(price, binStepBps, bins.upper - activeBin);
      return `${formatPoolPrice(low, numberLocale)} – ${formatPoolPrice(high, numberLocale)} ${y.symbol} · ${bins.upper - bins.lower + 1} ${word("bins")}`;
    }
    if (range && (range.min !== null || range.max !== null)) return `${formatPoolPrice(range.min, numberLocale)} – ${range.max === null ? "∞" : formatPoolPrice(range.max, numberLocale)} ${y.symbol}`;
    return word("poolWholeRange");
  }, [dlmm, bins, price, binStepBps, activeBin, range, numberLocale, y.symbol, word]);

  const valueUsd = useMemo(() => {
    const vx = unitsX && unitsX !== "0" ? (x.priceUsd === null ? null : fromBaseUnits(unitsX, x.decimals) * x.priceUsd) : 0;
    const vy = unitsY && unitsY !== "0" ? (y.priceUsd === null ? null : fromBaseUnits(unitsY, y.decimals) * y.priceUsd) : 0;
    return vx === null || vy === null ? null : vx + vy;
  }, [unitsX, unitsY, x, y]);

  async function review(refreshed = false) {
    if (!owner || invalid || unitsX === null || unitsY === null) return;
    setFailure(null);
    setPhase({ kind: "reviewing" });
    const mine = ++attempt.current;
    const answer = await reviewAction({
      action: "add",
      venue,
      request: { pool, owner, amountX: unitsX, amountY: unitsY, slippageBps: slippage, ...(dlmm ? { shape } : {}) },
      ...(dlmm ? { range: { place, half: HALF_WIDTH[width] } } : {}),
    });
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
    if (!connection) return;
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
    /* What went in, for the position's divergence loss and net result (SOL-2b) — only once every transaction landed. */
    if (relayed.value.settled) {
      const added = (reviewed.preview as AddLiquidityPreview).deposit;
      recordAdd(
        connection.address,
        reviewed.position,
        { x: fromBaseUnits(added.x.units, added.x.decimals), y: fromBaseUnits(added.y.units, added.y.decimals), xPriceUsd: x.priceUsd, yPriceUsd: y.priceUsd, at: Date.now() },
        (reviewed.preview as AddLiquidityPreview).opensPosition,
      );
    }
    setPhase({ kind: "done", review: reviewed, relay: relayed.value, at: Date.now() });
  }

  const human = (units: string, token: AddToken) => `${formatAmount(fromBaseUnits(units, token.decimals), numberLocale, token.decimals)} ${token.symbol}`;
  const both = (deposit: AddLiquidityPreview["deposit"]) =>
    [deposit.x.units !== "0" ? human(deposit.x.units, x) : null, deposit.y.units !== "0" ? human(deposit.y.units, y) : null].filter(Boolean).join(" + ");

  if (phase.kind === "done") {
    const preview = phase.review.preview as AddLiquidityPreview;
    return (
      <div className={styles.actionStack}>
        <RelayReceipt relay={phase.relay} at={phase.at} title={`${word("receiptAdded")} · ${venueLabel}`} amount={`+${word("upTo")} ${both(preview.deposit)} ${word("inPool")}`} word={word} lang={lang} numberLocale={numberLocale} />
        <Button variant="secondary" lang={lang} onClick={() => router.push(`/app/markets/pools/${pool}`)}>
          {word("newAdd")}
        </Button>
      </div>
    );
  }

  if (phase.kind === "review" || phase.kind === "signing") {
    const reviewed = phase.review;
    const preview = reviewed.preview as AddLiquidityPreview;
    const lower = preview.range.kind === "bins" ? Number(preview.range.lowerPrice) : preview.range.minPrice === null ? null : Number(preview.range.minPrice);
    const upper = preview.range.kind === "bins" ? Number(preview.range.upperPrice) : preview.range.maxPrice === null ? null : Number(preview.range.maxPrice);
    const notices = noticeTexts(preview.notices, word);
    return (
      <div className={styles.actionStack}>
        {notices.map((text) => (
          <p key={text} className={styles.positionWarn} role="status">
            {text}
          </p>
        ))}
        <Review
          lang={lang}
          titleAs="h2"
          title={`${word("addTo")} ${x.symbol}/${y.symbol} ${word("on")} ${venueLabel}`}
          pay={`${both(preview.deposit)} · ${word("youPut")}`}
          get={preview.opensPosition ? word("newPosition") : word("intoPosition")}
          costs={[{ label: "Ryntra", value: word("ryntraNone") }, { label: "Meteora", value: word("meteoraNone") }, ...chainCosts(reviewed, word, numberLocale)]}
          costsTotal={`${word("costsNone")} · ${solTotal(reviewed, word, numberLocale)}`}
          rows={[
            { label: word("rangeOf"), value: preview.range.kind === "bins" || lower !== null || upper !== null ? `${formatPoolPrice(lower, numberLocale)} – ${upper === null ? "∞" : formatPoolPrice(upper, numberLocale)} ${y.symbol}` : word("poolWholeRange") },
            { label: word("priceNow"), value: `${formatPoolPrice(Number(preview.price), numberLocale)} ${y.symbol}` },
          ]}
          whatItIs={word("whatAdd")}
          signer={owner ? short(owner) : undefined}
          details={
            <dl className={styles.detailsList}>
              <div><dt>{word("poolAddress")}</dt><dd translate="no">{pool}</dd></div>
              <div><dt>{word("positionAccount")}</dt><dd translate="no">{reviewed.position}</dd></div>
              <div><dt>{word("slippage")}</dt><dd>{(preview.request.slippageBps / 100).toLocaleString(numberLocale)} %</dd></div>
              <div><dt>{word("transactions")}</dt><dd>{reviewed.transactions.length}</dd></div>
              {reviewed.depositUsd !== null ? <div><dt>{word("canaryCap")}</dt><dd>{formatUsdMoney(reviewed.depositUsd, numberLocale)} / {formatUsdMoney(states.maxDepositUsd, numberLocale)}</dd></div> : null}
            </dl>
          }
          signing={phase.kind === "signing"}
          risk={`${word("riskAdd")} ${word("validFor")}`}
          {...(phase.kind === "signing" ? {} : { onCancel: () => setPhase({ kind: "edit" }) })}
          onConfirm={() => void sign(reviewed, phase.at)}
        />
        {failure ? <p className={styles.note} role="alert">{failure}</p> : null}
      </div>
    );
  }

  if (!owner) {
    return (
      <Block title={word("addTitle")} titleAs="h2" icon="wallet" lang={lang}>
        <EmptyState
          icon="wallet"
          text={word("connectToAct")}
          action={
            <Button variant="secondary" onClick={reach} lang={lang}>
              {openInWallet ? word("openInPhantom") : word("connectWallet")}
            </Button>
          }
        />
      </Block>
    );
  }

  const busy = phase.kind === "reviewing";
  const closed = action.status !== "on";
  const field = (token: AddToken, typed: string, set: (value: string) => void, balance: bigint | null, overMax: boolean, side: "x" | "y") => {
    const max = maxOf(balance, token);
    return (
    <div className={styles.simField}>
      <label htmlFor={`${id}-${side}`}>
        {token.symbol}
        <span className={styles.fieldAside}>
          {word("balance")}: {balance === null ? "—" : formatAmount(fromBaseUnits(balance.toString(), token.decimals), numberLocale, token.decimals)}
          {max !== null && max > 0n ? (
            <button type="button" className={styles.inlineAction} onClick={() => set(typedFromUnits(max, token.decimals))} disabled={busy}>
              {word("max")}
            </button>
          ) : null}
        </span>
      </label>
      <input id={`${id}-${side}`} inputMode="decimal" autoComplete="off" value={typed} placeholder="0" disabled={busy} aria-invalid={overMax || undefined} onChange={(event) => set(event.target.value.replace(/[^\d.,]/g, "").slice(0, 24))} />
      {overMax ? <span className={styles.fieldWarn}>{word("overBalance")}</span> : null}
    </div>
    );
  };

  return (
    <div className={styles.actionStack}>
      {!enabled ? <p className={styles.note} role="status">{word("disabled")}</p> : null}
      {rebalance ? <p className={styles.note} data-pools="rebalance-add">{word("rebalanceAddNote")}</p> : null}
      {dlmm ? (
        <>
          <div className={styles.simField}>
            <span id={`${id}-place`}>{word("rangePlace")}</span>
            <div className={styles.simMoves} role="group" aria-labelledby={`${id}-place`}>
              {RANGE_PLACES.map((entry) => (
                <button key={entry} type="button" className={styles.order} aria-pressed={place === entry} disabled={busy} onClick={() => setPlace(entry)}>
                  {word(PLACE_WORD[entry])}
                </button>
              ))}
            </div>
            <span className={styles.factNote}>{word(PLACE_NOTE[place])}</span>
          </div>
          <div className={styles.simField}>
            <span id={`${id}-width`}>{word("rangeWidth")}</span>
            <div className={styles.simMoves} role="group" aria-labelledby={`${id}-width`}>
              {RANGE_WIDTHS.map((entry) => (
                <button key={entry} type="button" className={styles.order} aria-pressed={width === entry} disabled={busy} onClick={() => setWidth(entry)}>
                  {word(WIDTH_WORD[entry])} · {HALF_WIDTH[entry] * 2 + 1}
                </button>
              ))}
            </div>
          </div>
        </>
      ) : null}
      <p className={styles.rangeLine} data-pools="range">
        {word("rangeOf")}: <strong>{rangeText}</strong>
      </p>
      {sides.x ? field(x, typedX, setTypedX, xBalance, overX, "x") : null}
      {sides.y ? field(y, typedY, setTypedY, yBalance, overY, "y") : null}
      {sides.x && sides.y ? (
        <button
          type="button"
          className={styles.inlineAction}
          disabled={busy || !typedX}
          onClick={() => {
            const units = toBaseUnits(typedX, x.decimals);
            if (units) setTypedY(typedOf(fromBaseUnits(units, x.decimals) * price, y.decimals));
          }}
        >
          {word("balanced")}
        </button>
      ) : null}
      {valueUsd !== null && valueUsd > 0 ? <p className={styles.sourcesLine}>≈ {formatUsdMoney(valueUsd, numberLocale)} · {word("priceSource")}</p> : null}

      <details className={styles.details}>
        <summary>{word("details")}</summary>
        <div className={styles.actionStack}>
          {dlmm ? (
            <div className={styles.simField}>
              <span id={`${id}-shape`}>{word("shape")}</span>
              <div className={styles.simMoves} role="group" aria-labelledby={`${id}-shape`}>
                {SHAPES.map((entry) => (
                  <button key={entry} type="button" className={styles.order} aria-pressed={shape === entry} disabled={busy} onClick={() => setShape(entry)}>
                    {word(SHAPE_WORD[entry])}
                  </button>
                ))}
              </div>
              <span className={styles.factNote}>{word("shapeNote")}</span>
            </div>
          ) : null}
          <div className={styles.simField}>
            <span id={`${id}-slip`}>{word("slippage")}</span>
            <div className={styles.simMoves} role="group" aria-labelledby={`${id}-slip`}>
              {SLIPPAGES_BPS.map((entry) => (
                <button key={entry} type="button" className={styles.order} aria-pressed={slippage === entry} disabled={busy} onClick={() => setSlippage(entry)}>
                  {(entry / 100).toLocaleString(numberLocale)} %
                </button>
              ))}
            </div>
          </div>
          <p className={styles.sourcesLine}>
            {word("poolAddress")} · <span translate="no">{pool}</span>
          </p>
        </div>
      </details>

      {failure ? <p className={styles.note} role="alert">{failure}</p> : null}
      <div className={styles.formAction}>
        <Button variant="primary" block lang={lang} loading={busy} disabled={closed || !enabled || invalid || overX || overY} onClick={() => void review()}>
          {busy ? word("preparing") : word("review")}
        </Button>
      </div>
      {closed ? <p className={styles.sourcesLine}>{word("failClosed")}</p> : states.maxDepositUsd !== null ? <p className={styles.sourcesLine}>{word("canaryCap")} {formatUsdMoney(states.maxDepositUsd, numberLocale)}</p> : null}
    </div>
  );
}
