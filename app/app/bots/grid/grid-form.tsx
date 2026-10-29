"use client";

import { Block, Button, EmptyState, Review } from "@ryntra/core/ui";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";

import { useWalletReach } from "@/app/app/invest/use-wallet-reach";
import { chainCosts, failureText, noticeTexts, RelayReceipt, short, solTotal } from "@/app/app/markets/pools/action-shared";
import type { AddToken } from "@/app/app/markets/pools/add-liquidity";
import { reviewAction, signableMsOf, signAndRelay, useActionStates, useFollowedRelay, type LiquidityRelay, type LiquidityReview } from "@/app/app/markets/pools/liquidity-api";
import { DEFAULT_SLIPPAGE_BPS, fromBaseUnits, SOL_RESERVE_LAMPORTS, toBaseUnits, typedFromUnits, typedOf } from "@/app/app/markets/pools/liquidity-form";
import { forgetPositions, usePositions } from "@/app/app/markets/pools/my-positions";
import { formatPoolPrice } from "@/app/app/markets/pools/pool-format";
import { recordAdd, usePositionEntries } from "@/app/app/markets/pools/position-entries";
import { poolsWords } from "@/app/app/markets/pools/pools-words";
import pools from "@/app/app/markets/pools/pools.module.css";
import type { WorkspaceLocale } from "@/app/shell/locale";
import { useSolanaConnection } from "@/app/solana/workspace/connection";
import { formatAmount, formatUsdMoney } from "@/app/solana/workspace/spot/spot-format";
import { useHoldingOf, useSpotHoldings } from "@/app/solana/workspace/spot/use-spot-data";
import { DEFAULT_GRID_LEVELS, GRID_LEVELS, GRID_PLACE, GRID_SIDES, gridHalf, gridSides, planGrid, type GridBot, type GridLevels, type GridSide } from "@/lib/bots/grid";
import type { AddedAmounts } from "@/lib/liquidity/catalog/track";
import type { AddLiquidityPreview } from "@/lib/liquidity/studio/contract";
import { mayOpenWallet } from "@/lib/solana/blockhash-life";
import { WRAPPED_SOL_MINT } from "@/lib/solana/send-kinds";

import pair from "@/app/app/form-pair.module.css";

import { botsWords, type BOTS_WORDS } from "../bots-words";
import styles from "../bots.module.css";
import { recordGrid } from "../grid-records";

type BotsWord = keyof typeof BOTS_WORDS;

export type GridFormProps = Readonly<{
  locale: WorkspaceLocale;
  pool: string;
  x: AddToken;
  y: AddToken;
  /** Y per one X now, from the chain. */
  price: number;
  activeBin: number;
  binStepBps: number;
  enabled: boolean;
}>;

type Phase =
  | Readonly<{ kind: "edit" }>
  | Readonly<{ kind: "reviewing" }>
  | Readonly<{ kind: "review"; review: LiquidityReview; at: number }>
  | Readonly<{ kind: "signing"; review: LiquidityReview; at: number }>
  | Readonly<{ kind: "done"; review: LiquidityReview; relay: LiquidityRelay; at: number; owner: string; record: Readonly<{ bot: GridBot | null; added: AddedAmounts; opens: boolean }> }>;

/** No relay yet: what the follower is given before a grid is sent. */
const NO_RELAY: LiquidityRelay = { results: [], settled: false };

const SIDE_WORD: Readonly<Record<GridSide, BotsWord>> = { buy: "sideBuy", sell: "sideSell", both: "sideBoth" };

/**
 * The grid's form (B10): a side, a number of levels and a budget; the plan it makes at the pool's price — the range,
 * the step between levels, about what each level holds — and the pools' own Review with every cost on its line, one
 * signature and a receipt. The levels are DLMM's bins and the shape is `spot`, so each level holds the same; the
 * server counts the bins from the active bin it reads at the Review, so a price that moved since keeps the grid on the
 * side the person chose. Nothing is offered while the pools' gate keeps actions closed.
 */
export function GridForm({ locale, pool, x, y, price, activeBin, binStepBps, enabled }: GridFormProps) {
  const word = botsWords(locale);
  const poolWord = poolsWords(locale);
  const lang: "en" | "uk" = locale === "uk" ? "uk" : "en";
  const numberLocale = locale === "uk" ? "uk-UA" : "en-US";
  /* Fixed ids: a generated one drifts between the server and the browser under the page frame. */
  const id = "grid-form";
  const { connection } = useSolanaConnection();
  const owner = connection?.address ?? null;
  const { openInWallet, reach } = useWalletReach();
  const states = useActionStates(owner);
  const holdings = useSpotHoldings(owner, 0);
  const xHolding = useHoldingOf(holdings, x.mint, WRAPPED_SOL_MINT);
  const yHolding = useHoldingOf(holdings, y.mint, WRAPPED_SOL_MINT);

  const [side, setSide] = useState<GridSide>("both");
  const [levels, setLevels] = useState<GridLevels>(DEFAULT_GRID_LEVELS);
  const [typedX, setTypedX] = useState("");
  const [typedY, setTypedY] = useState("");
  const [phase, setPhase] = useState<Phase>({ kind: "edit" });
  const [failure, setFailure] = useState<string | null>(null);
  /*
   * The relay as the chain sees it: an answer still unread when the relay returned may land later. The grid and what
   * went in are recorded once, when the placement has landed — never before — and the receipt then reads the new
   * position, whose own amounts settle the entry the Review only capped (SOL-2b).
   */
  const followed = useFollowedRelay(phase.kind === "done" ? phase.relay : NO_RELAY);
  const recorded = useRef(false);
  useEffect(() => {
    if (phase.kind !== "done" || !followed.settled || recorded.current) return;
    recorded.current = true;
    recordAdd(phase.owner, phase.review.position, phase.record.added, phase.record.opens);
    if (phase.record.bot) recordGrid(phase.owner, phase.record.bot);
  }, [phase, followed.settled]);
  const landed = usePositions(phase.kind === "done" && followed.settled ? owner : null);
  usePositionEntries(owner, landed.status === "ready" && landed.owner === owner ? landed.answer.positions : null);
  /* Each Review and each signature is one attempt: an answer for an older one is dropped. */
  const attempt = useRef(0);
  useEffect(() => {
    attempt.current += 1;
    setPhase((current) => (current.kind === "done" ? current : { kind: "edit" }));
    setFailure(null);
  }, [owner]);

  const sides = gridSides(side);
  const unitsX = sides.x ? toBaseUnits(typedX || "0", x.decimals) : "0";
  const unitsY = sides.y ? toBaseUnits(typedY || "0", y.decimals) : "0";
  const balanceOf = (holding: typeof xHolding): bigint | null => (holding ? BigInt(holding.spendableRaw) : holdings.status === "ready" ? 0n : null);
  /* «Max» leaves SOL for the position's rent and the network, as the pools' form does. */
  const maxOf = (balance: bigint | null, token: AddToken): bigint | null => {
    if (balance === null || token.mint !== WRAPPED_SOL_MINT) return balance;
    return balance > SOL_RESERVE_LAMPORTS ? balance - SOL_RESERVE_LAMPORTS : 0n;
  };
  const xBalance = balanceOf(xHolding);
  const yBalance = balanceOf(yHolding);
  const over = (units: string | null, balance: bigint | null) => units !== null && balance !== null && BigInt(units) > balance;
  const overX = over(unitsX, xBalance);
  const overY = over(unitsY, yBalance);
  /* A grid on both sides takes both tokens: with one only, the levels on the other side would hold nothing. */
  const invalid = unitsX === null || unitsY === null || (side === "both" ? unitsX === "0" || unitsY === "0" : unitsX === "0" && unitsY === "0");

  const plan = useMemo(
    () =>
      planGrid({
        activeBin,
        binStepBps,
        price,
        side,
        levels,
        amountX: unitsX ? fromBaseUnits(unitsX, x.decimals) : 0,
        amountY: unitsY ? fromBaseUnits(unitsY, y.decimals) : 0,
      }),
    [activeBin, binStepBps, price, side, levels, unitsX, unitsY, x.decimals, y.decimals],
  );
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
      venue: "meteora-dlmm",
      request: { pool, owner, amountX: unitsX, amountY: unitsY, slippageBps: DEFAULT_SLIPPAGE_BPS, shape: "spot" },
      range: { place: GRID_PLACE[side], half: gridHalf(levels) },
    });
    if (mine !== attempt.current) return;
    if (!answer.ok) {
      setFailure(failureText(answer.code, poolWord));
      setPhase({ kind: "edit" });
      return;
    }
    setPhase({ kind: "review", review: answer.value, at: Date.now() });
    if (refreshed) setFailure(poolWord("reviewRefreshed"));
  }

  async function sign(reviewed: LiquidityReview, at: number) {
    if (!connection) return;
    /* The bytes live ~30 s: a Review signed later than its window is built again and the person reads the new one. */
    if (!mayOpenWallet({ receivedAtMs: at, signableMs: signableMsOf(reviewed) })) {
      await review(true);
      return;
    }
    setFailure(null);
    setPhase({ kind: "signing", review: reviewed, at });
    const mine = ++attempt.current;
    const relayed = await signAndRelay({ wallet: connection.wallet, address: connection.address }, reviewed, at).catch(() => ({ ok: false as const, code: "WALLET_REFUSED" }));
    if (mine !== attempt.current) return;
    if (!relayed.ok && (relayed.code === "REVIEW_AGED" || relayed.code === "TICKET_EXPIRED")) {
      await review(true);
      return;
    }
    if (!relayed.ok) {
      setFailure(failureText(relayed.code, poolWord));
      setPhase(relayed.code === "WALLET_REFUSED" ? { kind: "review", review: reviewed, at } : { kind: "edit" });
      return;
    }
    forgetPositions(connection.address);
    const preview = reviewed.preview as AddLiquidityPreview;
    const now = Date.now();
    const added = preview.deposit;
    const bot: GridBot | null =
      preview.range.kind === "bins"
        ? { position: reviewed.position, pool, pair: `${x.symbol}/${y.symbol}`, side, levels, lowerPrice: Number(preview.range.lowerPrice), upperPrice: Number(preview.range.upperPrice), at: now }
        : null;
    recorded.current = false;
    setPhase({
      kind: "done",
      review: reviewed,
      relay: relayed.value,
      at: now,
      owner: connection.address,
      record: {
        bot,
        added: { x: fromBaseUnits(added.x.units, added.x.decimals), y: fromBaseUnits(added.y.units, added.y.decimals), xPriceUsd: x.priceUsd, yPriceUsd: y.priceUsd, at: now },
        opens: preview.opensPosition,
      },
    });
  }

  const human = (units: string, token: AddToken) => `${formatAmount(fromBaseUnits(units, token.decimals), numberLocale, token.decimals)} ${token.symbol}`;
  const both = (deposit: AddLiquidityPreview["deposit"]) =>
    [deposit.x.units !== "0" ? human(deposit.x.units, x) : null, deposit.y.units !== "0" ? human(deposit.y.units, y) : null].filter(Boolean).join(" + ");
  const rangeText = (lower: number, upper: number) => `${formatPoolPrice(lower, numberLocale)} – ${formatPoolPrice(upper, numberLocale)} ${y.symbol}`;
  const pct = (value: number) => `${value.toLocaleString(numberLocale, { maximumFractionDigits: value < 1 ? 2 : 1 })} %`;

  /* The levels the choice makes: beside the form on a desk, under it on a phone — the centred pair of the action page. */
  const planAside = plan ? (
    <aside className={`${styles.gridPlan} ${pair.review}`} aria-labelledby={`${id}-plan`}>
      <h2 id={`${id}-plan`} className={styles.blockTitle}>
        {word(SIDE_WORD[side])} · {word("levels")}: {levels}
      </h2>
      <GridLadder buy={plan.buyLevels} sell={plan.sellLevels} levels={levels} />
      <dl className={styles.gridFacts}>
        <div>
          <dt>{word("range")}</dt>
          <dd>{rangeText(plan.lowerPrice, plan.upperPrice)}</dd>
          <span className={styles.gridFactNote}>
            {plan.downPct > 0 ? `−${pct(plan.downPct)}` : null}
            {plan.downPct > 0 && plan.upPct > 0 ? " · " : null}
            {plan.upPct > 0 ? `+${pct(plan.upPct)}` : null}
          </span>
        </div>
        <div>
          <dt>{word("levelStep")}</dt>
          <dd>{pct(plan.stepPct)}</dd>
        </div>
        <div>
          <dt>{word("perLevel")}</dt>
          <dd>
            {[plan.perLevel.x > 0 ? `≈ ${formatAmount(plan.perLevel.x, numberLocale)} ${x.symbol}` : null, plan.perLevel.y > 0 ? `≈ ${formatAmount(plan.perLevel.y, numberLocale)} ${y.symbol}` : null].filter(Boolean).join(" · ") || "—"}
          </dd>
        </div>
        <div>
          <dt>{word("priceNow")}</dt>
          <dd>
            {formatPoolPrice(price, numberLocale)} {y.symbol}
          </dd>
        </div>
      </dl>
    </aside>
  ) : (
    /* No plan from these numbers yet: the review's place keeps the pair in the middle, never an empty track. */
    <aside className={`${styles.gridPlan} ${pair.review}`} aria-labelledby={`${id}-plan`}>
      <h2 id={`${id}-plan`} className={styles.blockTitle}>
        {word(SIDE_WORD[side])} · {word("levels")}: {levels}
      </h2>
      <p className={styles.gridNote}>—</p>
    </aside>
  );

  if (phase.kind === "done") {
    const preview = phase.review.preview as AddLiquidityPreview;
    return (
      <div className={pair.pair}>
        <div className={pools.actionStack}>
          <RelayReceipt relay={phase.relay} at={phase.at} title={`${word("placed")} · ${x.symbol}/${y.symbol}`} amount={`+${poolWord("upTo")} ${both(preview.deposit)} · ${word("levels")}: ${levels}`} word={poolWord} lang={lang} numberLocale={numberLocale} />
          <Link className="rw-btn rw-btn--primary" href="/app/bots" prefetch={false}>
            {word("toBots")}
          </Link>
        </div>
        {planAside}
      </div>
    );
  }

  if (phase.kind === "review" || phase.kind === "signing") {
    const reviewed = phase.review;
    const preview = reviewed.preview as AddLiquidityPreview;
    const lower = preview.range.kind === "bins" ? Number(preview.range.lowerPrice) : null;
    const upper = preview.range.kind === "bins" ? Number(preview.range.upperPrice) : null;
    /* A one-sided grid is one-sided on purpose: the pools' notice for it is the grid's own side, said above. */
    const notices = noticeTexts(preview.notices.filter((notice) => !(notice === "one_sided" && side !== "both")), poolWord);
    return (
      <div className={pair.pair}>
        <div className={pools.actionStack}>
          {notices.map((text) => (
            <p key={text} className={pools.positionWarn} role="status">
              {text}
            </p>
          ))}
          <Review
            lang={lang}
            titleAs="h2"
            title={`${word("placeTitle")} · ${x.symbol}/${y.symbol}`}
            pay={`${both(preview.deposit)} · ${poolWord("youPut")}`}
            get={`${word(SIDE_WORD[side])} · ${word("levels")}: ${levels}`}
            costs={[{ label: "Ryntra", value: poolWord("ryntraNone") }, { label: "Meteora", value: poolWord("meteoraNone") }, ...chainCosts(reviewed, poolWord, numberLocale)]}
            costsTotal={`${poolWord("costsNone")} · ${solTotal(reviewed, poolWord, numberLocale)}`}
            rows={[
              { label: word("range"), value: lower !== null && upper !== null ? rangeText(lower, upper) : "—" },
              { label: word("levelStep"), value: pct(binStepBps / 100) },
              { label: word("priceNow"), value: `${formatPoolPrice(Number(preview.price), numberLocale)} ${y.symbol}` },
            ]}
            whatItIs={word("whatGrid")}
            signer={owner ? short(owner) : undefined}
            details={
              <dl className={pools.detailsList}>
                <div><dt>{poolWord("poolAddress")}</dt><dd translate="no">{pool}</dd></div>
                <div><dt>{poolWord("positionAccount")}</dt><dd translate="no">{reviewed.position}</dd></div>
                <div><dt>{poolWord("slippage")}</dt><dd>{(preview.request.slippageBps / 100).toLocaleString(numberLocale)} %</dd></div>
                <div><dt>{poolWord("transactions")}</dt><dd>{reviewed.transactions.length}</dd></div>
                {reviewed.depositUsd !== null ? <div><dt>{poolWord("canaryCap")}</dt><dd>{formatUsdMoney(reviewed.depositUsd, numberLocale)} / {formatUsdMoney(states.maxDepositUsd, numberLocale)}</dd></div> : null}
              </dl>
            }
            signing={phase.kind === "signing"}
            risk={`${word("riskGrid")} ${poolWord("validFor")}`}
            {...(phase.kind === "signing" ? {} : { onCancel: () => setPhase({ kind: "edit" }) })}
            onConfirm={() => void sign(reviewed, phase.at)}
          />
          {failure ? <p className={pools.note} role="alert">{failure}</p> : null}
        </div>
        {planAside}
      </div>
    );
  }

  const busy = phase.kind === "reviewing";
  const closed = states.add.status !== "on";
  const sideNote = side === "buy" ? `${y.symbol} ${word("sideBuyNote")}` : side === "sell" ? `${x.symbol} ${word("sideSellNote")}` : word("sideBothNote");
  const field = (token: AddToken, typed: string, set: (value: string) => void, balance: bigint | null, overMax: boolean, key: "x" | "y") => {
    const max = maxOf(balance, token);
    return (
      <div className={pools.simField}>
        <label htmlFor={`${id}-${key}`}>
          {token.symbol}
          <span className={pools.fieldAside}>
            {poolWord("balance")}: {balance === null ? "—" : formatAmount(fromBaseUnits(balance.toString(), token.decimals), numberLocale, token.decimals)}
            {max !== null && max > 0n ? (
              <button type="button" className={pools.inlineAction} onClick={() => set(typedFromUnits(max, token.decimals))} disabled={busy}>
                {poolWord("max")}
              </button>
            ) : null}
          </span>
        </label>
        <input id={`${id}-${key}`} inputMode="decimal" autoComplete="off" value={typed} placeholder="0" disabled={busy} aria-invalid={overMax || undefined} onChange={(event) => set(event.target.value.replace(/[^\d.,]/g, "").slice(0, 24))} />
        {overMax ? <span className={pools.fieldWarn}>{poolWord("overBalance")}</span> : null}
      </div>
    );
  };


  /* A guest sees the grid the default choice makes and one button: the wallet, as everywhere. */
  if (!owner) {
    return (
      <div className={pair.pair}>
        <Block title={word("gridTitle")} titleAs="h2" icon="wallet" lang={lang}>
          <EmptyState
            icon="wallet"
            text={word("gridConnect")}
            action={
              <Button variant="secondary" onClick={reach} lang={lang}>
                {openInWallet ? poolWord("openInPhantom") : poolWord("connectWallet")}
              </Button>
            }
          />
        </Block>
        {planAside}
      </div>
    );
  }

  return (
    <div className={pair.pair}>
      <div className={pools.actionStack}>
        {!enabled ? <p className={pools.note} role="status">{poolWord("disabled")}</p> : null}
        <div className={pools.simField}>
          <span id={`${id}-side`}>{word("gridSide")}</span>
          <div className={pools.simMoves} role="group" aria-labelledby={`${id}-side`}>
            {GRID_SIDES.map((entry) => (
              <button key={entry} type="button" className={pools.order} aria-pressed={side === entry} disabled={busy} onClick={() => setSide(entry)}>
                {word(SIDE_WORD[entry])}
              </button>
            ))}
          </div>
          <span className={pools.factNote}>{sideNote}</span>
        </div>
        <div className={pools.simField}>
          <span id={`${id}-levels`}>{word("levels")}</span>
          <div className={pools.simMoves} role="group" aria-labelledby={`${id}-levels`}>
            {GRID_LEVELS.map((entry) => (
              <button key={entry} type="button" className={pools.order} aria-pressed={levels === entry} disabled={busy} onClick={() => setLevels(entry)}>
                {entry}
              </button>
            ))}
          </div>
        </div>
        {sides.x ? field(x, typedX, setTypedX, xBalance, overX, "x") : null}
        {sides.y ? field(y, typedY, setTypedY, yBalance, overY, "y") : null}
        {sides.x && sides.y ? (
          <button
            type="button"
            className={pools.inlineAction}
            disabled={busy || !typedX}
            onClick={() => {
              const units = toBaseUnits(typedX, x.decimals);
              if (units) setTypedY(typedOf(fromBaseUnits(units, x.decimals) * price, y.decimals));
            }}
          >
            {poolWord("balanced")}
          </button>
        ) : null}
        {side === "both" && unitsX !== null && unitsY !== null && (unitsX === "0") !== (unitsY === "0") ? <p className={pools.sourcesLine} role="status">{word("bothNeedsBoth")}</p> : null}
        {valueUsd !== null && valueUsd > 0 ? <p className={pools.sourcesLine}>{word("budget")} ≈ {formatUsdMoney(valueUsd, numberLocale)} · {poolWord("priceSource")}</p> : null}
        {failure ? <p className={pools.note} role="alert">{failure}</p> : null}
        <div className={pools.formAction}>
          <Button variant="primary" block lang={lang} loading={busy} disabled={closed || !enabled || invalid || overX || overY} onClick={() => void review()}>
            {busy ? poolWord("preparing") : poolWord("review")}
          </Button>
        </div>
        {closed ? <p className={pools.sourcesLine}>{poolWord("failClosed")}</p> : states.maxDepositUsd !== null ? <p className={pools.sourcesLine}>{poolWord("canaryCap")} {formatUsdMoney(states.maxDepositUsd, numberLocale)}</p> : null}
      </div>

      {planAside}
    </div>
  );
}

/** The levels as marks: buying below the price, selling above it, the price between — a picture, not a chart. */
function GridLadder({ buy, sell, levels }: { buy: number; sell: number; levels: number }) {
  /* With both sides the price's own level holds some of each and is counted on both: it is drawn once, as the price. */
  const shared = buy + sell > levels;
  const below = shared ? buy - 1 : buy;
  const above = shared ? sell - 1 : sell;
  return (
    <div className={styles.ladder} aria-hidden="true">
      {Array.from({ length: below }, (_, index) => (
        <span key={`b${index}`} className={styles.rung} data-side="buy" />
      ))}
      <span className={styles.rung} data-side="price" />
      {Array.from({ length: above }, (_, index) => (
        <span key={`s${index}`} className={styles.rung} data-side="sell" />
      ))}
    </div>
  );
}
