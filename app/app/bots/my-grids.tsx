"use client";

import { Button, Review, Skeleton } from "@ryntra/core/ui";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import { chainCosts, failureText, noticeTexts, RelayReceipt, short, solTotal } from "@/app/app/markets/pools/action-shared";
import { reviewAction, signableMsOf, signAndRelay, useActionStates, useFollowedRelay, type ActionStates, type LiquidityRelay, type LiquidityReview } from "@/app/app/markets/pools/liquidity-api";
import { DEFAULT_SLIPPAGE_BPS, fromBaseUnits } from "@/app/app/markets/pools/liquidity-form";
import { forgetPositions, usePositions } from "@/app/app/markets/pools/my-positions";
import { formatPoolPrice } from "@/app/app/markets/pools/pool-format";
import { recordClaim, recordRemove, usePositionEntries } from "@/app/app/markets/pools/position-entries";
import { poolsWords } from "@/app/app/markets/pools/pools-words";
import pools from "@/app/app/markets/pools/pools.module.css";
import type { WorkspaceLocale } from "@/app/shell/locale";
import { useSolanaConnection } from "@/app/solana/workspace/connection";
import { formatAmount, formatPercent, formatUsdMoney, toneOf } from "@/app/solana/workspace/spot/spot-format";
import { gridResult, gridState, type GridBot, type GridState } from "@/lib/bots/grid";
import type { PositionView } from "@/lib/liquidity/catalog/positions";
import type { PositionEntry } from "@/lib/liquidity/catalog/track";
import type { ClaimFeesPreview, RemoveLiquidityPreview } from "@/lib/liquidity/studio/contract";
import { mayOpenWallet } from "@/lib/solana/blockhash-life";
import type { Amount } from "@ryntra/core/adapters";

import { botsWords, type BOTS_WORDS } from "./bots-words";
import styles from "./bots.module.css";
import { forgetGrid, noteGridRead, useGridBots } from "./grid-records";

type BotsWord = keyof typeof BOTS_WORDS;

const STATE_WORD: Readonly<Record<GridState, BotsWord>> = {
  working: "stateWorking",
  waiting: "stateWaiting",
  all_bought: "stateAllBought",
  all_sold: "stateAllSold",
  closed: "stateClosed",
};

/**
 * «Мої боти → Гріди» (B10): each grid the wallet placed here, read from the chain — one number, its result since it was
 * placed, and one action, «Зупинити»: every level and its fees out and the position closed, through the pools' Review,
 * one signature and a receipt. Fees can be collected on their own while the levels keep working. A grid stopped
 * elsewhere leaves the list once the chain no longer holds it.
 */
export function MyGrids({ locale }: { locale: WorkspaceLocale }) {
  const word = botsWords(locale);
  const { connection } = useSolanaConnection();
  const owner = connection?.address ?? null;
  const bots = useGridBots(owner);
  /* After an action lands the chain is read again: the block is drawn only from a read taken after it. */
  const [reread, setReread] = useState(0);
  const read = usePositions(owner && bots && bots.length > 0 ? owner : null, reread);
  const states = useActionStates(owner);
  const ready = read.status === "ready" && read.owner === owner ? read.answer : null;
  const entries = usePositionEntries(owner, ready?.positions ?? null);
  /* The one bot whose action is open: its Review and receipt replace its block until the person steps back. */
  const [acting, setActing] = useState<Readonly<{ position: string; mode: "stop" | "collect"; view: PositionView }> | null>(null);
  const againTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /* Another wallet: an action opened for the last one is not this one's. */
  useEffect(() => setActing(null), [owner]);

  /*
   * A grid the chain no longer holds — stopped here or elsewhere — leaves the list after two different reads without it,
   * unless its receipt is open; the second read is asked for half a minute after the first, past the server's kept answer.
   */
  useEffect(() => {
    if (!owner || !bots || !ready || !ready.venues.dlmm.ok) return;
    let again = false;
    for (const bot of bots) {
      if (acting?.position === bot.position) continue;
      const view = ready.positions.find((position) => position.address === bot.position) ?? null;
      if (view) noteGridRead(owner, bot.position, true, ready.at);
      else if (gridState(bot, view, readTime(ready)) === "closed") {
        if (bot.missedAt === undefined) again = true;
        noteGridRead(owner, bot.position, false, ready.at);
      }
    }
    /* One second read at a time: a re-render that writes the miss does not move or cancel it. */
    if (!again || againTimer.current) return;
    againTimer.current = setTimeout(() => {
      againTimer.current = null;
      forgetPositions(owner);
      setReread((n) => n + 1);
    }, 30_000);
  }, [owner, bots, ready, acting]);
  useEffect(
    () => () => {
      if (againTimer.current) clearTimeout(againTimer.current);
      againTimer.current = null;
    },
    [owner],
  );

  if (!owner || bots === null) return null;

  const head = (
    <div className={styles.blockHead}>
      <h2 id="bots-grids" className={styles.blockTitle}>{word("myGrids")}</h2>
      {bots.length > 0 ? (
        <Link className={styles.blockLink} href="/app/bots/grid" prefetch={false}>
          {word("gridTitle")}
        </Link>
      ) : null}
    </div>
  );

  if (bots.length === 0) {
    return (
      <section className={styles.block} aria-labelledby="bots-grids">
        {head}
        <div className={styles.guest} data-grids-empty>
          <p className={styles.guestLine}>{word("gridsEmpty")}</p>
          <Link className="rw-btn" href="/app/bots/grid" prefetch={false}>
            {word("gridTitle")}
          </Link>
        </div>
      </section>
    );
  }

  return (
    <section className={styles.block} aria-labelledby="bots-grids">
      {head}
      {read.status === "failed" || (ready && !ready.venues.dlmm.ok) ? (
        <p className={styles.gridNote} role="status">
          {word("gridsDown")}
        </p>
      ) : null}
      <ul className={styles.grids}>
        {bots.map((bot) => {
          const view = ready?.positions.find((position) => position.address === bot.position) ?? null;
          const state = ready && ready.venues.dlmm.ok ? gridState(bot, view, readTime(ready)) : null;
          const unread = read.status === "failed" || (ready !== null && !ready.venues.dlmm.ok);
          return (
            <li key={bot.position} className={styles.gridBot} data-grid-bot={bot.position}>
              {acting?.position === bot.position ? (
                /* The action keeps the position as it was when opened: a closed one is gone from the chain's next read. */
                <GridAct
                  locale={locale}
                  owner={owner}
                  bot={bot}
                  view={acting.view}
                  mode={acting.mode}
                  onBack={(acted, closed) => {
                    setActing(null);
                    if (closed) forgetGrid(owner, bot.position);
                    if (acted) setReread((n) => n + 1);
                  }}
                />
              ) : (
                <GridBlock
                  locale={locale}
                  bot={bot}
                  view={view}
                  state={state}
                  unread={unread}
                  states={states}
                  entry={entries[bot.position] ?? null}
                  loading={!ready && read.status !== "failed"}
                  onStop={() => view && setActing({ position: bot.position, mode: "stop", view })}
                  onCollect={() => view && setActing({ position: bot.position, mode: "collect", view })}
                />
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/**
 * The read's time for the «closed» test, never later than this browser's clock: a grid placed by this browser's clock
 * is not counted gone because the server's clock runs ahead of it.
 */
function readTime(ready: Readonly<{ at: number }>): Readonly<{ at: number }> {
  return { at: Math.min(ready.at, Date.now()) };
}

function GridBlock({
  locale,
  bot,
  view,
  state,
  unread,
  states,
  entry,
  loading,
  onStop,
  onCollect,
}: {
  locale: WorkspaceLocale;
  bot: GridBot;
  view: PositionView | null;
  state: GridState | null;
  /** The chain did not answer for the wallet's pools: the state is not known, not «reading». */
  unread: boolean;
  states: ActionStates;
  entry: PositionEntry | null;
  loading: boolean;
  onStop: () => void;
  onCollect: () => void;
}) {
  const word = botsWords(locale);
  const lang: "en" | "uk" = locale === "uk" ? "uk" : "en";
  const numberLocale = locale === "uk" ? "uk-UA" : "en-US";
  const result = view ? gridResult(view, entry) : null;
  const tone = toneOf(result?.usd ?? null);
  const side = bot.side === "buy" ? word("sideBuy") : bot.side === "sell" ? word("sideSell") : word("sideBoth");
  const canCollect = view !== null && !view.feesElsewhere && (view.x.unclaimed > 0 || view.y.unclaimed > 0);
  /* «Зупинити» closes the position: one whose fees go elsewhere or with a locked part cannot be closed (the pools say so). */
  const canStop = view !== null && !view.feesElsewhere && view.lockedBps === 0;
  const quote = bot.pair.split("/")[1] ?? "";
  return (
    <article className={styles.gridCard} aria-label={`${word("grid")} ${bot.pair}`}>
      <header className={styles.gridCardHead}>
        <span className={styles.gridPair} translate="no">{bot.pair}</span>
        {unread ? null : (
          <span className={styles.gridState} data-state={state ?? "reading"}>
            {word(!view && bot.missedAt !== undefined ? "stateMissing" : state ? STATE_WORD[state] : "stateReading")}
          </span>
        )}
      </header>
      {loading ? (
        <Skeleton lines={2} label={word("stateReading")} />
      ) : (
        <div className={styles.gridResult} data-tone={tone}>
          <span className={styles.gridResultLabel}>{word("result")}</span>
          <strong>{result ? `${result.usd >= 0 ? "+" : "−"}${formatUsdMoney(Math.abs(result.usd), numberLocale)}` : "—"}</strong>
          <span className={styles.gridFactNote}>{result ? `${formatPercent(result.pct, numberLocale)} · ${formatUsdMoney(result.feesUsd, numberLocale)} ${word("feesEarned")}` : view ? word("resultNone") : null}</span>
        </div>
      )}
      <p className={styles.gridLine}>
        {side} · {word("levels")}: {bot.levels} · {formatPoolPrice(bot.lowerPrice, numberLocale)} – {formatPoolPrice(bot.upperPrice, numberLocale)} {quote}
      </p>
      {view ? (
        <div className={styles.gridActions}>
          {canCollect ? (
            <Button variant="secondary" lang={lang} disabled={states.claim.status !== "on"} onClick={onCollect}>
              {word("collect")}
            </Button>
          ) : null}
          {canStop ? (
            <Button variant="primary" lang={lang} disabled={states.remove.status !== "on"} onClick={onStop}>
              {word("stop")}
            </Button>
          ) : null}
          {states.remove.status !== "on" ? (
            <p className={styles.gridNote} role="status">
              {word("stopPaused")}{" "}
              <a href={`https://app.meteora.ag/dlmm/${bot.pool}`} target="_blank" rel="noopener noreferrer">
                {word("meteoraPage")}
              </a>
            </p>
          ) : null}
        </div>
      ) : null}
    </article>
  );
}

type Phase =
  | Readonly<{ kind: "reviewing" }>
  | Readonly<{ kind: "review"; review: LiquidityReview; at: number }>
  | Readonly<{ kind: "signing"; review: LiquidityReview; at: number }>
  | Readonly<{ kind: "done"; review: LiquidityReview; relay: LiquidityRelay; at: number }>
  | Readonly<{ kind: "failed"; reason: string }>;

/** No relay yet: what the follower is given before an action is sent. */
const NO_RELAY: LiquidityRelay = { results: [], settled: false };

/** Claimed amounts in USD at the position's token prices; null when either is unpriced. */
function usdOf(amounts: Readonly<{ x: Amount; y: Amount }>, view: PositionView): number | null {
  if (view.x.priceUsd === null || view.y.priceUsd === null) return null;
  return fromBaseUnits(amounts.x.units, amounts.x.decimals) * view.x.priceUsd + fromBaseUnits(amounts.y.units, amounts.y.decimals) * view.y.priceUsd;
}

/**
 * «Зупинити» or «Забрати комісії» for one grid: the pools' Review is asked at once — stop is every level out with its
 * fees and the position closed; collect is the fees alone — then one signature and the receipt.
 */
function GridAct({ locale, owner, bot, view, mode, onBack }: { locale: WorkspaceLocale; owner: string; bot: GridBot; view: PositionView; mode: "stop" | "collect"; onBack: (acted: boolean, closed: boolean) => void }) {
  const word = botsWords(locale);
  const poolWord = poolsWords(locale);
  const lang: "en" | "uk" = locale === "uk" ? "uk" : "en";
  const numberLocale = locale === "uk" ? "uk-UA" : "en-US";
  const { connection } = useSolanaConnection();
  const [phase, setPhase] = useState<Phase>({ kind: "reviewing" });
  const attempt = useRef(0);
  /*
   * The relay as the chain sees it: an answer still unread when the relay returned may land later. What landed is
   * recorded once, when it has — the withdrawal's entry, the claim's fees — never before.
   */
  const followed = useFollowedRelay(phase.kind === "done" ? phase.relay : NO_RELAY);
  const recorded = useRef(false);
  useEffect(() => {
    if (phase.kind !== "done" || !followed.settled || recorded.current) return;
    recorded.current = true;
    const done = phase.review.preview;
    if (done.action === "remove") recordRemove(owner, bot.position, 10_000, (done as RemoveLiquidityPreview).closesPosition, view.lockedBps);
    if (done.action === "claim") recordClaim(owner, bot.position, usdOf((done as ClaimFeesPreview).claimed, view));
  }, [phase, followed.settled, owner, bot.position, view]);

  async function review() {
    setPhase({ kind: "reviewing" });
    const mine = ++attempt.current;
    const answer = await reviewAction(
      mode === "collect"
        ? { action: "claim", venue: "meteora-dlmm", request: { position: bot.position, owner } }
        : { action: "remove", venue: "meteora-dlmm", request: { position: bot.position, owner, shareBps: 10_000, close: true, slippageBps: DEFAULT_SLIPPAGE_BPS } },
    );
    if (mine !== attempt.current) return;
    if (!answer.ok) {
      setPhase({ kind: "failed", reason: failureText(answer.code, poolWord) });
      return;
    }
    setPhase({ kind: "review", review: answer.value, at: Date.now() });
  }

  /* The Review is asked once, when the action opens; a new attempt replaces an older answer. */
  useEffect(() => {
    void review();
    return () => {
      attempt.current += 1;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per opened action
  }, [bot.position, mode, owner]);

  async function sign(reviewed: LiquidityReview, at: number) {
    /* Another wallet now: the Review was built for this one's position and is not its to sign. */
    if (!connection || connection.address !== owner) {
      setPhase({ kind: "failed", reason: poolWord("failNotOwner") });
      return;
    }
    if (!mayOpenWallet({ receivedAtMs: at, signableMs: signableMsOf(reviewed) })) {
      await review();
      return;
    }
    setPhase({ kind: "signing", review: reviewed, at });
    const mine = ++attempt.current;
    const relayed = await signAndRelay({ wallet: connection.wallet, address: connection.address }, reviewed, at).catch(() => ({ ok: false as const, code: "WALLET_REFUSED" }));
    if (mine !== attempt.current) return;
    if (!relayed.ok && (relayed.code === "REVIEW_AGED" || relayed.code === "TICKET_EXPIRED")) {
      await review();
      return;
    }
    if (!relayed.ok) {
      if (relayed.code === "WALLET_REFUSED") setPhase({ kind: "review", review: reviewed, at });
      else setPhase({ kind: "failed", reason: failureText(relayed.code, poolWord) });
      return;
    }
    forgetPositions(owner);
    setPhase({ kind: "done", review: reviewed, relay: relayed.value, at: Date.now() });
  }

  const human = (amount: Amount, symbol: string) => `${formatAmount(fromBaseUnits(amount.units, amount.decimals), numberLocale, amount.decimals)} ${symbol}`;
  const pair = (amounts: Readonly<{ x: Amount; y: Amount }>) =>
    [amounts.x.units !== "0" ? human(amounts.x, view.x.symbol) : null, amounts.y.units !== "0" ? human(amounts.y, view.y.symbol) : null].filter(Boolean).join(" + ") || "0";

  if (phase.kind === "reviewing") return <Skeleton lines={3} label={poolWord("preparing")} />;
  if (phase.kind === "failed") {
    return (
      <div className={pools.actionStack}>
        <p className={pools.note} role="alert">{phase.reason}</p>
        <Button variant="secondary" lang={lang} onClick={() => onBack(false, false)}>{word("back")}</Button>
      </div>
    );
  }
  if (phase.kind === "done") {
    const preview = phase.review.preview;
    const amount = preview.action === "claim" ? `+${pair((preview as ClaimFeesPreview).claimed)}` : `≈ +${pair((preview as RemoveLiquidityPreview).expected)}`;
    return (
      <div className={pools.actionStack}>
        <RelayReceipt relay={phase.relay} at={phase.at} title={`${mode === "collect" ? word("collected") : word("stopped")} · ${bot.pair}`} amount={amount} word={poolWord} lang={lang} numberLocale={numberLocale} />
        <Button variant="secondary" lang={lang} onClick={() => onBack(true, followed.settled && preview.action === "remove" && (preview as RemoveLiquidityPreview).closesPosition)}>{word("back")}</Button>
      </div>
    );
  }
  const reviewed = phase.review;
  const preview = reviewed.preview;
  const common = {
    lang,
    titleAs: "h3" as const,
    costs: [{ label: "Ryntra", value: poolWord("ryntraNone") }, { label: "Meteora", value: poolWord("meteoraNoneAction") }, ...chainCosts(reviewed, poolWord, numberLocale)],
    costsTotal: `${poolWord("costsNone")} · ${solTotal(reviewed, poolWord, numberLocale)}`,
    signer: short(owner),
    signing: phase.kind === "signing",
    ...(phase.kind === "signing" ? {} : { onCancel: () => onBack(false, false) }),
    onConfirm: () => void sign(reviewed, phase.at),
    details: (
      <dl className={pools.detailsList}>
        <div><dt>{poolWord("poolAddress")}</dt><dd translate="no">{bot.pool}</dd></div>
        <div><dt>{poolWord("positionAccount")}</dt><dd translate="no">{bot.position}</dd></div>
        <div><dt>{poolWord("transactions")}</dt><dd>{reviewed.transactions.length}</dd></div>
      </dl>
    ),
  };
  /* The pools' own warnings — a token's transfer fee, farm rewards left — stand above the Review, as in «Пули». */
  const notices = noticeTexts(preview.notices, poolWord).map((text) => (
    <p key={text} className={pools.positionWarn} role="status">
      {text}
    </p>
  ));
  return preview.action === "claim" ? (
    <div className={pools.actionStack}>
      {notices}
      <Review {...common} title={`${word("collect")} · ${bot.pair}`} pay={poolWord("networkOnly")} get={pair((preview as ClaimFeesPreview).claimed)} whatItIs={word("collectWhat")} risk={poolWord("validFor")} />
    </div>
  ) : (
    <div className={pools.actionStack}>
      {notices}
      <Review
      {...common}
      title={`${word("stop")} · ${word("grid")} ${bot.pair}`}
      pay={`100 % ${poolWord("sharePosition")} · ${word("levels")}: ${bot.levels}`}
      get={pair((preview as RemoveLiquidityPreview).expected)}
      {...((preview as RemoveLiquidityPreview).minimum ? { atLeast: `${poolWord("atLeastWord")} ${pair((preview as RemoveLiquidityPreview).minimum!)}` } : {})}
      rows={(preview as RemoveLiquidityPreview).closesPosition ? [{ label: poolWord("feesWith"), value: pair((preview as RemoveLiquidityPreview).feesClaimed) }] : []}
      whatItIs={word("stopWhat")}
      risk={`${poolWord("riskRemove")} ${poolWord("validFor")}`}
      />
    </div>
  );
}
