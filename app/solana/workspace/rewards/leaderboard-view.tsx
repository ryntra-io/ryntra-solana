"use client";

import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from "react";

import type { LeaderboardsResponse, LeagueRow } from "@/lib/growth/league-view";
import { useSolanaI18n } from "../i18n/provider.tsx";
import { WalletChoices } from "../wallet-gate.tsx";
import { FaceAvatar, RankAvatar, SeasonBadge, TrackBadge } from "./badge.tsx";
import { leagueCopy, type BoardWordId } from "./league-copy.ts";
import { partnerCopy } from "./partner-copy.ts";
import { rankCopy } from "./rank-copy.ts";
import { SignInGate } from "./sign-in-gate.tsx";
import { useRewardsWallet } from "./use-rewards-wallet.tsx";
import { PaidAsChip } from "./programme-card.tsx";
import styles from "./leagues.module.css";

/**
 * The week's three boards — traders, friends, creators.
 *
 * Readable by anyone: the names are masked addresses and every figure is
 * one a board ranks — a result in percent, a count of friends, a count of
 * launches. A connected, proven wallet also sees where it stands on each,
 * how far a trader is from the minimum, and the one switch it owns: shown on
 * the boards or not. On a desk the three boards stand side by side; on a
 * phone one at a time. Nothing here pays, and the page says so in its rules.
 */

const BOARDS: readonly BoardWordId[] = ["TRADERS", "FRIENDS", "CREATORS"];

type Kind = "current" | "previous";

export function LeaderboardView() {
  const { locale } = useSolanaI18n();
  const words = leagueCopy(locale);
  const ranks = rankCopy(locale).rank;
  /* The wallet the sign-in proved (Ріст 18): the boards are public, «You» opens without a second step. */
  const wallet = useRewardsWallet();
  const { refused, served } = wallet;
  const address = wallet.address;
  const proven = wallet.open;
  const intl = locale === "uk" ? "uk-UA" : "en-US";

  const [kind, setKind] = useState<Kind>("current");
  const [board, setBoard] = useState<BoardWordId>("TRADERS");
  const key = `${kind}:${proven ? address : ""}`;
  const currentKey = useRef(key);
  currentKey.current = key;
  const [snapshot, setSnapshot] = useState<{ key: string; data: LeaderboardsResponse } | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(false);
  const tabs = useRef<Record<string, HTMLButtonElement | null>>({});
  const data = snapshot?.key === key ? snapshot.data : null;

  const load = useCallback(async () => {
    const asked = key;
    const read = async () => {
      const query = `week=${kind}${proven && address ? `&address=${encodeURIComponent(address)}` : ""}`;
      const response = await fetch(`/api/growth/leaderboards?${query}`);
      if (!response.ok) throw new Error("unavailable");
      return (await response.json()) as LeaderboardsResponse;
    };
    try {
      let body = await read();
      if (currentKey.current !== asked) return;
      /* A proven read answered without «You» is the server not seeing the sign-in: asked again, read once more if it
         still stands; otherwise the boards stay (they are public) and «You» follows the sign-in. Never stored as this
         wallet's answer, so a later sign-in reads afresh. */
      if (proven && address && body.you === null) {
        let verdict = await refused(address);
        if (currentKey.current !== asked) return;
        if (verdict === "retry") {
          body = await read();
          if (currentKey.current !== asked) return;
          if (body.you === null) verdict = await refused(address);
          if (currentKey.current !== asked) return;
        }
        /* Gone or refused: «You» follows the sign-in. Otherwise the boards stand and «You» says it did not read. */
        if (body.you === null && (verdict === "gone" || verdict === "refused")) return;
      }
      if (proven && address && body.you !== null) served(address);
      setSnapshot({ key: asked, data: body });
      setFailed(null);
    } catch {
      if (currentKey.current === asked) setFailed(asked);
    }
  }, [key, kind, proven, address, refused, served]);

  useEffect(() => {
    void load();
    if (kind !== "current") return;
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void load();
    }, 60_000);
    return () => window.clearInterval(timer);
  }, [load, kind]);

  const toggleShown = useCallback(async () => {
    if (!address || !proven || !data?.you || saving) return;
    setSaving(true);
    setSaveError(false);
    try {
      const response = await fetch("/api/growth/leaderboards/visibility", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ address, hidden: !data.you.hidden }),
      });
      /* A sign-in that ended: the page offers the sign-in again. */
      if (response.status === 401) void refused(address);
      if (!response.ok) throw new Error("not saved");
      await load();
    } catch {
      setSaveError(true);
    } finally {
      setSaving(false);
    }
  }, [address, proven, data, saving, load, refused]);

  const day = (iso: string) => new Intl.DateTimeFormat(intl, { day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(iso));
  const lastDay = (iso: string) => day(new Date(Date.parse(iso) - 86_400_000).toISOString());
  /* UTC, like the week itself, so the time and the week's dates never disagree near midnight. */
  const time = (iso: string) => new Intl.DateTimeFormat(intl, { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: "UTC" }).format(new Date(iso));

  const weekSwitch = (
    <div className={styles.segments} role="group" aria-label={words.boardsLabel}>
      {(["current", "previous"] as const).map((option) => (
        <button key={option} type="button" className={styles.segment} aria-pressed={kind === option} onClick={() => setKind(option)}>
          {option === "current" ? words.thisWeek : words.lastWeek}
        </button>
      ))}
    </div>
  );

  if (!data) {
    return (
      <div className={styles.page}>
        <div className={styles.controls}>{weekSwitch}</div>
        <section className={styles.panel} aria-live="polite">
          <div className={styles.state}>
            <p className={styles.lead}>{failed === key ? words.unavailable : words.loading}</p>
            {failed === key ? (
              <button type="button" className={styles.quietButton} onClick={() => void load()}>
                {words.retry}
              </button>
            ) : null}
          </div>
        </section>
      </div>
    );
  }

  const season = data.season;
  const you = data.you;
  const ended = Date.now() >= Date.parse(data.week.end);
  /* The creators' board only once any launch has reached a DEX. */
  const boards = data.rules.creators ? BOARDS : BOARDS.filter((id) => id !== "CREATORS");

  return (
    <div className={styles.page}>
      {season ? (
        <section className={`${styles.panel} ${styles.strip}`} aria-label={words.seasonTitle(season.number)}>
          <SeasonBadge badge="SEASON" earned size={36} className={styles.badgeGlow} />
          <span className={styles.stripText}>
            <span className={styles.stripName}>
              {words.seasonTitle(season.number)} · {words.theme[season.theme]}
            </span>
            <span className={styles.stripMeta}>
              {season.week ? `${words.weekOf(season.week, season.weeks)} · ` : ""}
              {words.ends(lastDay(season.end))}
            </span>
          </span>
          <PaidAsChip paidAs="STATUS" />
        </section>
      ) : null}

      <div className={styles.controls}>
        {weekSwitch}
        <span className={styles.weekMeta}>
          <span translate="no">{words.weekRange(day(data.week.start), lastDay(data.week.end))}</span>
          <span className={styles.chip} data-tone={data.week.final || ended ? undefined : "live"}>
            {data.week.final ? words.final : ended ? words.settling : words.live(time(data.week.updatedAt))}
          </span>
        </span>
      </div>

      <YouPanel
        wallet={wallet}
        onRetry={() => void load()}
        you={you}
        boards={boards}
        min={data.rules.tradersMinUsd}
        saving={saving}
        saveError={saveError}
        onToggle={() => void toggleShown()}
      />

      <div className={`${styles.segments} ${styles.boardTabs}`} role="tablist" aria-label={words.boardsLabel} onKeyDown={(event: KeyboardEvent) => {
        /* Arrows move between the boards, as a tab list does. */
        if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;
        const index = boards.indexOf(board);
        const next = boards[(index + (event.key === "ArrowRight" ? 1 : boards.length - 1)) % boards.length];
        setBoard(next);
        tabs.current[next]?.focus();
        event.preventDefault();
      }}>
        {boards.map((id) => (
          <button key={id} ref={(element) => { tabs.current[id] = element; }} type="button" role="tab" id={`board-tab-${id}`} aria-controls={`board-${id}`} aria-selected={board === id} tabIndex={board === id ? 0 : -1} className={styles.segment} onClick={() => setBoard(id)}>
            {words.board[id]}
          </button>
        ))}
      </div>

      <div className={styles.boards} data-count={boards.length}>
        {boards.map((id) => {
          const { rows, total } = data.boards[id];
          return (
            <section key={id} id={`board-${id}`} role="tabpanel" className={`${styles.panel} ${styles.board}`} data-shown={board === id ? "true" : "false"} aria-labelledby={`board-title-${id}`}>
              <div className={styles.boardHead}>
                <h2 className={styles.title} id={`board-title-${id}`}>{words.board[id]}</h2>
                <p className={styles.lead}>{words.boardLead[id]}</p>
              </div>
              {rows.length === 0 ? (
                <p className={styles.empty}>{words.empty(id, ended)}</p>
              ) : (
                <ol className={styles.rows}>
                  {rows.map((row) => (
                    <BoardRowView key={`${row.place}:${row.name}`} row={row} board={id} podium={row.place <= data.rules.podium} rankName={row.rank ? ranks[row.rank] : null} />
                  ))}
                </ol>
              )}
              {total > rows.length ? <p className={styles.boardFoot}>{words.more(rows.length, total)}</p> : null}
            </section>
          );
        })}
      </div>

      <details className={`${styles.panel} ${styles.rules}`}>
        <summary>{words.rulesTitle}</summary>
        <ul className={styles.rulesBody}>
          {words.rules(data.rules.tradersMinUsd, data.rules.creators).map((rule) => <li key={rule}>{rule}</li>)}
        </ul>
      </details>
    </div>
  );

}

function BoardRowView({ row, board: id, podium, rankName }: { row: LeagueRow; board: BoardWordId; podium: boolean; rankName: string | null }) {
  const { locale } = useSolanaI18n();
  const words = leagueCopy(locale);
  const figure = words.value(id, row.value);
  /* Shown only where the wallet turned it on: its highest liquidity badge. */
  const partner = partnerCopy(locale);
  const liquidityName = row.liquidity ? partner.badge[row.liquidity] : null;
  const sign = id === "TRADERS" ? (row.value > 0 ? "pos" : row.value < 0 ? "neg" : undefined) : undefined;
  return (
    <li className={styles.row} data-podium={podium ? "true" : "false"} data-you={row.you ? "true" : "false"}>
      <span className={styles.place} translate="no">
        <span className={styles.srOnly}>{words.placeAloud}</span>
        {row.place}
      </span>
      <FaceAvatar face={row.face} rank={row.rank} size={32} />
      <span className={styles.who}>
        <span className={styles.name} translate="no">{row.you ? `${words.you} · ${row.name}` : row.name}</span>
        {rankName || liquidityName ? (
          <span className={styles.rankName}>
            {rankName}
            {rankName && liquidityName ? " · " : null}
            {row.liquidity && liquidityName ? (
              <span className={styles.liquidityTag} title={`${partner.liquidityTagAloud} ${liquidityName}`}>
                <TrackBadge badge={row.liquidity} earned size={14} />
                <span className={styles.srOnly}>{partner.liquidityTagAloud} </span>
                {liquidityName}
              </span>
            ) : null}
          </span>
        ) : null}
      </span>
      <span className={styles.value} data-sign={sign} translate="no">{figure}</span>
    </li>
  );
}

function YouPanel({
  wallet,
  onRetry,
  you,
  boards,
  min,
  saving,
  saveError,
  onToggle,
}: {
  wallet: ReturnType<typeof useRewardsWallet>;
  onRetry: () => void;
  you: LeaderboardsResponse["you"];
  boards: readonly BoardWordId[];
  min: number;
  saving: boolean;
  saveError: boolean;
  onToggle: () => void;
}) {
  const { locale } = useSolanaI18n();
  const words = leagueCopy(locale);

  const address = wallet.address;
  if (wallet.gate === "connect") {
    return (
      <section className={`${styles.panel} ${styles.pad}`} aria-label={words.you} data-you-state="none">
        <p className={styles.lead}>{words.connect}</p>
        <WalletChoices single="button" errorClassName={styles.error} />
      </section>
    );
  }
  if (wallet.open && !you) {
    /* Signed in, and «You» did not read: say so, nothing to sign. */
    return (
      <section className={styles.panel} aria-label={words.you} data-you-state="unavailable">
        <div className={styles.state}>
          <p className={styles.lead}>{words.unavailable}</p>
          <button type="button" className={styles.quietButton} onClick={onRetry}>
            {words.retry}
          </button>
        </div>
      </section>
    );
  }
  if (!wallet.open || !you || !address) {
    return (
      <section className={styles.panel} aria-label={words.you} data-you-state="unproven">
        <SignInGate wallet={wallet} lead="boards" inside />
      </section>
    );
  }

  const shown = !you.hidden;
  const hiddenPlace = you.hidden ? Math.min(...boards.map((id) => you.boards[id].place ?? Infinity)) : Infinity;
  return (
    <section className={`${styles.panel} ${styles.you}`} aria-label={words.you} data-you-state="proven">
      <RankAvatar wallet={address} rank={you.hidden ? null : you.rank} size={44} />
      <span className={styles.youWho}>
        <span className={styles.eyebrow}>{words.you}</span>
        <span className={styles.youName} translate="no">{you.name}</span>
      </span>
      {you.excluded ? null : (
        <label className={`${styles.switchRow} ${styles.youAction}`}>
          <button type="button" role="switch" className={styles.switch} aria-checked={shown} onClick={onToggle} disabled={saving} aria-describedby="league-show-hint" />
          {words.showMe}
        </label>
      )}
      <dl className={styles.youStats} data-count={boards.length}>
        {boards.map((id) => {
          const mine = you.boards[id];
          const on = mine.place !== null && !you.hidden;
          /* Under the traders' minimum, how far there is to go; hidden, the
             figure alone — the note below says where it would stand. */
          const short = id === "TRADERS" && mine.closedUsd !== null && Number(mine.closedUsd) > 0 && Number(mine.closedUsd) < min;
          const line = on
            ? `${words.place(mine.place!)} · ${words.value(id, mine.value ?? 0)}`
            : short
              ? `${mine.value !== null ? `${words.value(id, mine.value)} · ` : ""}${words.youOff.TRADERS(words.usd(mine.closedUsd!).slice(1), min)}`
              : mine.value !== null
                ? words.value(id, mine.value)
                : id === "TRADERS" && Number(mine.closedUsd ?? "0") === 0
                  ? words.noneClosed
                  : words.youOff[id](mine.closedUsd ?? "0.00", min);
          return (
            <div key={id} className={styles.youStat}>
              <dt>{words.board[id]}</dt>
              <dd data-off={on ? "false" : "true"} translate="no">{line}</dd>
            </div>
          );
        })}
      </dl>
      <p className={styles.youNote} id="league-show-hint">
        {you.excluded ? words.internalNote : you.hidden ? words.hiddenNote(Number.isFinite(hiddenPlace) ? hiddenPlace : null) : words.showMeHint}
      </p>
      {saveError ? <p className={styles.error}>{words.saveFailed}</p> : null}
    </section>
  );
}
