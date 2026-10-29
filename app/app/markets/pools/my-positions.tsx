"use client";

import { Block, Button, EmptyState, Skeleton } from "@ryntra/core/ui";
import Link from "next/link";
import { useEffect, useState } from "react";

/** The largest positions first; the rest one tap away. */
const FIRST = 4;

import { useWalletReach } from "@/app/app/invest/use-wallet-reach";
import type { WorkspaceLocale } from "@/app/shell/locale";
import { useSolanaConnection } from "@/app/solana/workspace/connection";
import { formatAmount, formatUsdMoney } from "@/app/solana/workspace/spot/spot-format";
import type { PositionsAnswer, PositionView } from "@/lib/liquidity/catalog/positions";
import type { PositionEntry } from "@/lib/liquidity/catalog/track";

import { useActionStates } from "./liquidity-api";
import { formatPoolPrice } from "./pool-format";
import { usePositionEntries } from "./position-entries";
import { WatchLines } from "./position-watch";
import { ReadTime } from "./read-time";
import { POOL_KEY, poolsWords } from "./pools-words";
import styles from "./pools.module.css";

export type PositionsState = State;

type State =
  | Readonly<{ status: "idle" }>
  | Readonly<{ status: "loading"; owner: string }>
  | Readonly<{ status: "ready"; owner: string; answer: PositionsAnswer }>
  | Readonly<{ status: "failed"; owner: string; busy: boolean }>;

/* Kept across pages for a short while, so going from pool to pool shows the answer at once and asks the chain once. */
const KEPT_MS = 25_000;
const kept = new Map<string, Readonly<{ at: number; answer: PositionsAnswer }>>();

/** After the wallet acted on a pool: the kept answer no longer holds. */
export function forgetPositions(owner: string): void {
  kept.delete(owner);
  generations.set(owner, (generations.get(owner) ?? 0) + 1);
  markActed(owner);
}

/**
 * For this long after the wallet acted, a read asks past the server's kept answer too (`fresh=1`): the server keeps a
 * wallet's answer 25 s, and the instance that answers may not be the one that relayed the action. Kept in the tab's
 * session, so a reload right after an action still reads fresh.
 */
const ACTED_FRESH_MS = 30_000;
const ACTED_KEY = "ryntra.pools.acted.v1:";

function markActed(owner: string): void {
  try {
    window.sessionStorage.setItem(ACTED_KEY + owner, String(Date.now()));
  } catch {
    /* No session storage: the read after the action is the server's to answer as it can. */
  }
}

function actedLately(owner: string): boolean {
  try {
    const at = Number(window.sessionStorage.getItem(ACTED_KEY + owner));
    return Number.isFinite(at) && at > 0 && Date.now() - at < ACTED_FRESH_MS;
  } catch {
    return false;
  }
}

/** A fetch that began before the wallet's last action does not refill the kept answer. */
const generations = new Map<string, number>();

/**
 * The connected wallet's positions, read from the chain through the server — past its kept answer (`fresh=1`) for a
 * while after the wallet acted. `reread` — a screen that acted in place (B10's grids) bumps it after `forgetPositions`
 * to read again rather than keep drawing the answer from before the action.
 */
export function usePositions(owner: string | null, reread = 0): State {
  const [state, setState] = useState<State>({ status: "idle" });
  useEffect(() => {
    if (!owner) {
      setState({ status: "idle" });
      return;
    }
    const hit = kept.get(owner);
    if (hit && Date.now() - hit.at < KEPT_MS) {
      setState({ status: "ready", owner, answer: hit.answer });
      return;
    }
    const controller = new AbortController();
    const generation = generations.get(owner) ?? 0;
    setState({ status: "loading", owner });
    fetch(`/api/liquidity/positions?owner=${encodeURIComponent(owner)}${actedLately(owner) ? "&fresh=1" : ""}`, { signal: controller.signal, cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) {
          setState({ status: "failed", owner, busy: response.status === 429 });
          return;
        }
        const answer = (await response.json()) as PositionsAnswer;
        if ((generations.get(owner) ?? 0) === generation) kept.set(owner, { at: Date.now(), answer });
        setState({ status: "ready", owner, answer });
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        void error;
        setState({ status: "failed", owner, busy: false });
      });
    return () => controller.abort();
  }, [owner, reread]);
  return state;
}

/**
 * «Мої позиції»: what the wallet holds in Meteora pools — value, unclaimed
 * fees, in range or not — each linking to its pool. Without a wallet, one
 * sentence and the way to connect one. Each position opens its own page to
 * claim or withdraw once the wallet may act. Under each (SOL-2b): its
 * divergence loss and net result against the entry, and near an edge or out of
 * range, what that asks of the person.
 */
export function MyPositions({ locale, pool, read, title: named }: { locale: WorkspaceLocale; pool?: string; read?: State; title?: string }) {
  const word = poolsWords(locale);
  const lang = locale === "uk" ? "uk" : "en";
  const numberLocale = locale === "uk" ? "uk-UA" : "en-US";
  const { connection } = useSolanaConnection();
  const owner = connection?.address ?? null;
  /* A page that already reads the positions (Portfolio, for its value) hands its read in, and the chain is asked once. */
  const own = usePositions(read ? null : owner);
  const state = read ?? own;
  const actions = useActionStates(owner);
  /* What went into each position, for its divergence loss and net result (SOL-2b). */
  const entries = usePositionEntries(owner, state.status === "ready" && state.owner === owner ? state.answer.positions : null);
  const acting = actions.remove.status === "on" || actions.claim.status === "on";
  const { openInWallet, reach } = useWalletReach();
  const [all, setAll] = useState(false);
  const title = named ?? (pool ? word("myPositionsHere") : word("myPositions"));

  if (!owner) {
    /* A guest's side column stands empty whichever page it is on, so it gives its width to the content and the way in is the
       page's own one button (B17; audit «Реєстр зайвого» M9-money, SOL-C17). The catalogue did this already and a pool's own
       page kept the card «as the place its positions will stand» — a place for nothing, beside a column of real figures, and
       a second «Підключити гаманець» under the page's first one. One rule now, on both pages. */
    return (
      <Block title={title} titleAs="h2" icon="wallet" lang={lang} data-pools="positions" data-pools-guest="">
        <EmptyState
          icon="wallet"
          text={word("connectText")}
          action={
            <Button variant="secondary" onClick={reach} lang={lang}>
              {openInWallet ? word("openInPhantom") : word("connectWallet")}
            </Button>
          }
        />
      </Block>
    );
  }
  /* A wallet just switched: the last wallet's answer is never shown under the new one. */
  if ((state.status !== "ready" && state.status !== "failed") || state.owner !== owner) {
    return (
      <Block title={title} titleAs="h2" icon="wallet" lang={lang} data-pools="positions">
        <Skeleton lines={3} label={word("loadingPositions")} />
      </Block>
    );
  }
  if (state.status === "failed") {
    return (
      <Block title={title} titleAs="h2" icon="wallet" lang={lang} data-pools="positions">
        <EmptyState icon="circle-x" role="status" text={state.busy ? word("positionsBusy") : word("positionsDown")} />
      </Block>
    );
  }
  const positions = pool ? state.answer.positions.filter((position) => position.pool === pool) : state.answer.positions;
  const partly = !state.answer.venues.dlmm.ok || !state.answer.venues["damm-v2"].ok;
  const pricesAt = positions.map((position) => position.pricesAt).filter((at): at is string => at !== null).sort()[0] ?? null;
  const out = positions.filter((position) => position.rangeState !== "in_range").length;
  return (
    <Block title={title} titleAs="h2" icon="wallet" lang={lang} data-pools="positions">
      {positions.length === 0 ? (
        <EmptyState icon={partly ? "circle-x" : "target"} role="status" text={partly ? word("noPositionsPartly") : pool ? word("noPositionsHere") : word("noPositions")} />
      ) : (
        <>
          {out > 0 ? (
            <p className={styles.positionWarn} data-pools="out-of-range">
              {out} {word("of")} {positions.length} {word("outCount")}
            </p>
          ) : null}
          <ul className={styles.positions}>
            {(all ? positions : positions.slice(0, FIRST)).map((position) => (
              <PositionRow key={position.address} position={position} entry={entries[position.address] ?? null} locale={locale} numberLocale={numberLocale} linked={!pool} manage={acting} />
            ))}
          </ul>
          {positions.length > FIRST && !all ? (
            <Button variant="secondary" lang={lang} onClick={() => setAll(true)}>
              {word("showAll")} ({positions.length})
            </Button>
          ) : null}
        </>
      )}
      {partly && positions.length > 0 ? <p className={styles.note}>{word("positionsPartly")}</p> : null}
      <p className={styles.positionsFoot}>
        {word("sourceChain")} · <ReadTime at={state.answer.at} locale={numberLocale} />
        {pricesAt ? (
          <>
            {" · "}
            {word("pricesFrom")} · <ReadTime at={pricesAt} locale={numberLocale} />
          </>
        ) : null}
        {acting ? null : (
          <>
            {" · "}
            {word("actionsLater")}
          </>
        )}
      </p>
    </Block>
  );
}

function PositionRow({ position, entry, locale, numberLocale, linked, manage }: { position: PositionView; entry: PositionEntry | null; locale: WorkspaceLocale; numberLocale: string; linked: boolean; manage: boolean }) {
  const word = poolsWords(locale);
  const out = position.rangeState !== "in_range";
  const rangeWord = position.rangeState === "in_range" ? word("inRange") : position.rangeState === "above" ? word("outAbove") : word("outBelow");
  const head = (
    <>
      <span className={styles.pairName}>
        {position.x.symbol}
        <span className={styles.pairSep}>/</span>
        {position.y.symbol}
      </span>
      <span className={styles.pairVenue}>{word(POOL_KEY[position.kind])}</span>
    </>
  );
  return (
    <li className={styles.position} data-range={position.rangeState}>
      <div className={styles.positionHead}>
        {linked ? (
          <Link href={`/app/markets/pools/${position.pool}`} className={styles.pair} prefetch={false}>
            {head}
          </Link>
        ) : (
          <span className={styles.pair}>{head}</span>
        )}
        <span className={styles.range} data-range={position.rangeState} title={out ? word("outNote") : undefined}>
          {rangeWord}
          {out ? <span className={styles.srOnly}>. {word("outNote")}</span> : null}
        </span>
      </div>
      <dl className={styles.positionFacts}>
        <div>
          <dt>{word("value")}</dt>
          <dd>{position.valueUsd === null ? `${formatAmount(position.x.amount, numberLocale)} ${position.x.symbol} + ${formatAmount(position.y.amount, numberLocale)} ${position.y.symbol}` : formatUsdMoney(position.valueUsd, numberLocale)}</dd>
        </div>
        <div>
          <dt>{word("unclaimed")}</dt>
          <dd>{position.unclaimedUsd === null ? `${formatAmount(position.x.unclaimed, numberLocale)} ${position.x.symbol} + ${formatAmount(position.y.unclaimed, numberLocale)} ${position.y.symbol}` : formatUsdMoney(position.unclaimedUsd, numberLocale)}</dd>
        </div>
      </dl>
      <p className={styles.positionLine}>
        {formatAmount(position.x.amount, numberLocale)} {position.x.symbol} · {formatAmount(position.y.amount, numberLocale)} {position.y.symbol}
        {position.lower !== null || position.upper !== null ? ` · ${formatPoolPrice(position.lower, numberLocale)} – ${formatPoolPrice(position.upper, numberLocale)}` : ""}
        {position.lockedBps > 0 ? ` · ${Math.round(position.lockedBps / 100)}% ${word("locked")}` : ""}
      </p>
      {position.feesElsewhere ? <p className={styles.positionLine}>{word("feesElsewhere")}</p> : null}
      {position.hasRewards ? <p className={styles.positionLine}>{word("rewards")}</p> : null}
      <WatchLines position={position} entry={entry} locale={locale} numberLocale={numberLocale} />
      {manage ? (
        <Link href={`/app/markets/pools/${position.pool}/position/${position.address}`} className={styles.manageLink} prefetch={false} data-pools="manage">
          {word("manage")} →
        </Link>
      ) : null}
    </li>
  );
}
