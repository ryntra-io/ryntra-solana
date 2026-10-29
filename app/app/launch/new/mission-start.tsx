"use client";

import { Clock, Users } from "@phosphor-icons/react";
import { Block, Button } from "@ryntra/core/ui";
import { useEffect, useId, useMemo, useState } from "react";

import type { WorkspaceLocale } from "@/app/shell/locale";
import type { LaunchCrewResponse } from "@/lib/api/v1/contract";
import { CREW_MAX_MEMBERS, crewInviteWords, crewProblems, handleOf, isCrewPreset, partWords, type CrewInvite } from "@/lib/core/launch/crew";
import { FEE_SHARE_TOTAL_BPS } from "@/lib/core/launch/fee-shares";
import { EVENING_WINDOW_MINUTES, HOURLY_WINDOW_MINUTES, nextWindow, tMinus, windowById, windowClock, windowOpenAt, type LaunchWindow } from "@/lib/core/launch/windows";
import { postIntentUrl } from "@/lib/mission-control/scene";

import { coreLang } from "../launch-blocks";
import { shortAddress } from "../launch-format";
import { launchWords } from "../launch-words";
import crewStyles from "../crew.module.css";
import styles from "../launch.module.css";

export type CrewView = LaunchCrewResponse["crew"];

/** A part typed in per cent, as whole basis points; null when it is not one. */
function pctToBps(text: string): number | null {
  const clean = text.trim().replace(",", ".");
  if (!/^\d{1,2}(\.\d{1,2})?$/.test(clean)) return null;
  return Math.round(Number(clean) * 100);
}

/** The clock a form reads: a second's beat, after mount only — the server's clock is not the person's. */
export function useSecond(on: boolean): number | null {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    if (!on) return;
    setNow(Date.now());
    const tick = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(tick);
  }, [on]);
  return on ? now : null;
}

export function windowWords(window: Pick<LaunchWindow, "kind" | "opensAt">, locale: WorkspaceLocale): string {
  const word = launchWords(locale);
  return `${word(window.kind === "evening" ? "windowEvening" : "windowHourly")} · ${windowClock(window)}`;
}

/**
 * Where a chosen window stands for the review: «wait» until it opens, «open» while it is, «closed» after it. Null —
 * «now», nothing to wait for.
 */
export function startState(windowId: string | null, now: number | null): Readonly<{ state: "wait" | "open" | "closed"; window: LaunchWindow; ms: number }> | null {
  const window = windowId ? windowById(windowId) : null;
  if (!window || now === null) return null;
  if (now < window.opensAt) return { state: "wait", window, ms: window.opensAt - now };
  if (now < window.closesAt) return { state: "open", window, ms: window.closesAt - now };
  return { state: "closed", window, ms: 0 };
}

type CrewRow = Readonly<{ key: number; handle: string; pct: string }>;

/**
 * MC-2 on «Запустити токен»: when the mission starts — now, the next hourly window or the evening one — and its crew,
 * invited by X handle with each member's own yes (`lib/core/launch/crew.ts`). The window is a time only: the creator
 * signs once it opens, and the review waits for it. The crew is made here, fixed once made; the launch takes its rows
 * from the crew's record.
 */
export function MissionStart({
  locale,
  presetId,
  symbol,
  name,
  creator,
  disabled,
  windowId,
  onWindow,
  crewOn,
  onCrewOn,
  crew,
  onCrew,
  proveWallet,
}: {
  locale: WorkspaceLocale;
  presetId: string;
  symbol: string;
  name: string;
  creator: string | null;
  disabled: boolean;
  windowId: string | null;
  onWindow: (id: string | null) => void;
  /** Crews may be made here — the devnet stand; mainnet. */
  crewOn: boolean | null;
  onCrewOn: (on: boolean) => void;
  crew: CrewView | null;
  onCrew: (crew: CrewView | null) => void;
  /** The wallet's own signature behind the creator's proof — a crew is a write. */
  proveWallet: () => Promise<boolean>;
}) {
  const word = launchWords(locale);
  const lang = coreLang(locale);
  const id = useId();
  const now = useSecond(true);
  const next = now === null ? null : nextWindow(now);
  const evening = now === null ? null : nextWindow(now, "evening");
  const open = now === null ? null : windowOpenAt(now);
  /* The windows offered: the one open now (sign within it), the next hourly one and the next evening's — once each. */
  const offered = [open, next, evening].filter((entry, index, all): entry is LaunchWindow => entry !== null && all.findIndex((other) => other?.id === entry.id) === index);
  const chosen = startState(windowId, now);

  return (
    <Block title={word("startTitle")} titleAs="h2" lang={lang}>
      <fieldset className={styles.section} disabled={disabled}>
        <legend className={styles.visuallyHidden}>{word("startTitle")}</legend>
        <div className={styles.segments} role="radiogroup" aria-label={word("startTitle")}>
          <button type="button" role="radio" aria-checked={windowId === null} className={styles.segment} onClick={() => onWindow(null)}>
            {word("startNow")}
          </button>
          {offered.map((window) => (
            <button key={window.id} type="button" role="radio" aria-checked={windowId === window.id} className={styles.segment} onClick={() => onWindow(window.id)}>
              {windowWords(window, locale)}
            </button>
          ))}
          {/* A window picked earlier that is no longer offered stays visible, so the choice never changes unseen. */}
          {chosen && !offered.some((window) => window.id === chosen.window.id) ? (
            <button type="button" role="radio" aria-checked className={styles.segment}>
              {windowWords(chosen.window, locale)}
            </button>
          ) : null}
        </div>
        <p className={styles.hint}>
          <Clock size={14} aria-hidden />{" "}
          {windowId === null
            ? word("startNowHint")
            : chosen?.state === "closed"
              ? word("startClosedReason", { clock: windowClock(chosen.window) })
              : chosen?.state === "open"
                ? word("startOpenNow", { t: tMinus(chosen.ms).replace("T-", "") })
                : chosen
                  ? word("startOpensIn", { t: tMinus(chosen.ms).replace("T-", "") })
                  : null}
        </p>
        {windowId !== null ? <p className={styles.hint}>{word("startWindowHint", { minutes: chosen?.window.kind === "evening" ? EVENING_WINDOW_MINUTES : HOURLY_WINDOW_MINUTES })}</p> : null}
      </fieldset>
      {crewOn !== null ? (
        <CrewBox
          locale={locale}
          presetId={presetId}
          symbol={symbol}
          name={name}
          creator={creator}
          disabled={disabled}
          windowId={windowId}
          on={crewOn}
          onOn={onCrewOn}
          crew={crew}
          onCrew={onCrew}
          proveWallet={proveWallet}
          id={id}
        />
      ) : null}
    </Block>
  );
}

function CrewBox({
  locale,
  presetId,
  symbol,
  name,
  creator,
  disabled,
  windowId,
  on,
  onOn,
  crew,
  onCrew,
  proveWallet,
  id,
}: {
  locale: WorkspaceLocale;
  presetId: string;
  symbol: string;
  name: string;
  creator: string | null;
  disabled: boolean;
  windowId: string | null;
  on: boolean;
  onOn: (on: boolean) => void;
  crew: CrewView | null;
  onCrew: (crew: CrewView | null) => void;
  proveWallet: () => Promise<boolean>;
  id: string;
}) {
  const word = launchWords(locale);
  const lang = coreLang(locale);
  const [mine, setMine] = useState("");
  const [rows, setRows] = useState<readonly CrewRow[]>([{ key: 0, handle: "", pct: "" }]);
  const [nextKey, setNextKey] = useState(1);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const fits = isCrewPreset(presetId);

  const invites: CrewInvite[] = useMemo(() => rows.map((row) => ({ handle: handleOf(row.handle) ?? row.handle.trim(), bps: pctToBps(row.pct) ?? Number.NaN })), [rows]);
  const myHandle = mine.trim() ? handleOf(mine) : null;
  const problems = crewProblems(invites, myHandle);
  const given = invites.reduce((total, invite) => total + (Number.isFinite(invite.bps) ? invite.bps : 0), 0);
  const typed = rows.some((row) => row.handle || row.pct);
  const valid = problems.length === 0 && (mine.trim() === "" || myHandle !== null);

  /* The crew's answers as they come: read again every ten seconds while the form is open and the crew waits. */
  useEffect(() => {
    if (!crew || crew.token) return;
    let stopped = false;
    const read = async () => {
      try {
        const response = await fetch(`/api/v1/launch/crews/${crew.id}`, { headers: { "X-Ryntra-API": "1" }, cache: "no-store" });
        if (!response.ok || stopped) return;
        const body = (await response.json()) as LaunchCrewResponse;
        if (!stopped && body.crew?.id === crew.id) onCrew(body.crew);
      } catch {
        /* the next beat reads again */
      }
    };
    const timer = window.setInterval(() => void read(), 10_000);
    return () => {
      stopped = true;
      window.clearInterval(timer);
    };
  }, [crew, onCrew]);

  const make = async () => {
    if (!creator || !valid || !symbol || !name) return;
    setBusy(true);
    setFailure(null);
    const proven = await proveWallet().catch(() => false);
    if (!proven) {
      setBusy(false);
      setFailure(word("crewProveFirst"));
      return;
    }
    try {
      const response = await fetch("/api/v1/launch/crews", {
        method: "POST",
        headers: { "content-type": "application/json", "X-Ryntra-API": "1" },
        body: JSON.stringify({ creator, creatorHandle: myHandle, symbol, name, preset: presetId, window: windowId, invites }),
      });
      const body = (await response.json().catch(() => null)) as (LaunchCrewResponse & { error?: { message: string } }) | null;
      if (!response.ok || !body?.crew) setFailure(word("crewFailed", { why: body?.error?.message ?? String(response.status) }));
      else onCrew(body.crew);
    } catch {
      setFailure(word("crewFailed", { why: "network" }));
    }
    setBusy(false);
  };

  const link = crew && typeof window !== "undefined" ? `${window.location.origin}/app/launch/crew/${crew.id}` : null;
  const mismatch = crew && (crew.symbol !== symbol || crew.preset !== presetId);
  const aboard = crew ? crew.members.filter((member) => member.state === "ACCEPTED") : [];

  return (
    <div className={styles.lockBox} data-on={on ? "" : undefined}>
      <label className={styles.lockToggle}>
        <input type="checkbox" checked={on} disabled={disabled || !fits} onChange={(event) => onOn(event.target.checked)} />
        <span className={styles.lockIcon} aria-hidden>
          <Users size={18} weight={on ? "fill" : "regular"} />
        </span>
        <span className={styles.lockText}>
          <span className={styles.lockTitle}>{word("crewToggle")}</span>
          <span className={styles.hint}>{fits ? word("crewHint") : word("crewOnlyPresets")}</span>
        </span>
      </label>
      {on && fits && !crew ? (
        <>
          <label className={styles.label} htmlFor={`${id}-mine`}>
            {word("crewYourHandle")}
          </label>
          <input id={`${id}-mine`} className={`${styles.input} ${styles.mono}`} value={mine} placeholder="@" autoComplete="off" spellCheck={false} onChange={(event) => setMine(event.target.value)} />
          <ul className={styles.feeShareRows}>
            <li className={styles.feeShareRow} data-you="">
              <span className={styles.feeShareYou}>{word("crewYouKeep", { pct: partWords(Math.max(0, FEE_SHARE_TOTAL_BPS - given)) })}</span>
            </li>
            {rows.map((row, index) => (
              <li key={row.key} className={styles.feeShareRow}>
                <label className={styles.visuallyHidden} htmlFor={`${id}-${row.key}-h`}>
                  {word("crewHandle")} {index + 1}
                </label>
                <input
                  id={`${id}-${row.key}-h`}
                  className={`${styles.input} ${styles.mono} ${styles.feeShareAddress}`}
                  value={row.handle}
                  placeholder={`@${word("crewHandle")}`}
                  autoComplete="off"
                  spellCheck={false}
                  onChange={(event) => setRows(rows.map((entry) => (entry.key === row.key ? { ...entry, handle: event.target.value } : entry)))}
                />
                <span className={styles.feeShareAffixed}>
                  <label className={styles.visuallyHidden} htmlFor={`${id}-${row.key}-p`}>
                    {word("crewPart")} {index + 1}
                  </label>
                  <input
                    id={`${id}-${row.key}-p`}
                    className={`${styles.input} ${styles.mono}`}
                    value={row.pct}
                    inputMode="decimal"
                    placeholder="20"
                    onChange={(event) => setRows(rows.map((entry) => (entry.key === row.key ? { ...entry, pct: event.target.value } : entry)))}
                  />
                  <span className={styles.feeShareSuffix}>%</span>
                </span>
                {rows.length > 1 ? (
                  <button type="button" className={styles.feeShareRemove} aria-label={`${word("crewRemove")} ${index + 1}`} onClick={() => setRows(rows.filter((entry) => entry.key !== row.key))}>
                    ×
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
          {typed && !valid ? <p className={styles.problem}>{word("crewProblem")}</p> : null}
          {!symbol || !name ? <p className={styles.hint}>{word("crewNeedsTicker")}</p> : !creator ? <p className={styles.hint}>{word("connectFirst")}</p> : null}
          <div className={styles.stepActions}>
            {rows.length < CREW_MAX_MEMBERS ? (
              <Button
                variant="secondary"
                icon="plus"
                onClick={() => {
                  setRows([...rows, { key: nextKey, handle: "", pct: "" }]);
                  setNextKey(nextKey + 1);
                }}
                lang={lang}
              >
                {word("crewAdd")}
              </Button>
            ) : null}
            {/* Secondary: the page's one orange action stays the launch's own. */}
            <Button variant="secondary" onClick={() => void make()} disabled={!valid || !creator || !symbol || !name || busy || disabled} lang={lang}>
              {busy ? word("crewCreating") : word("crewCreate")}
            </Button>
          </div>
          {failure ? (
            <p className={styles.problem} role="alert">
              {failure}
            </p>
          ) : null}
        </>
      ) : null}
      {on && crew ? (
        <>
          <ul className={crewStyles.rows}>
            <li className={crewStyles.row} data-you="">
              <span className={crewStyles.handle}>{word("crewYouKeep", { pct: partWords(crew.creatorBps) })}</span>
            </li>
            {crew.members.map((member) => (
              <li key={member.handle} className={crewStyles.row}>
                <span className={crewStyles.handle}>
                  @{member.handle}
                  {member.wallet ? <span className={crewStyles.wallet}> · {shortAddress(member.wallet)}</span> : null}
                </span>
                <span className={crewStyles.part}>{partWords(member.bps)}</span>
                <span className={crewStyles.state} data-state={member.state}>
                  {word(`crewState_${member.state}`)}
                </span>
              </li>
            ))}
          </ul>
          <p className={styles.hint}>{word("crewWaitingStays")}</p>
          <p className={styles.hint}>{word("crewCheckWallets")}</p>
          {mismatch ? <p className={styles.problem}>{word("crewTickerChanged", { symbol: crew.symbol, preset: crew.preset === "classic" ? "Classic" : "Protected" })}</p> : null}
          {aboard.length === 0 ? <p className={styles.hint}>{word("crewNobody")}</p> : null}
          {link ? (
            <div className={styles.stepActions}>
              <a className={styles.markLink} href={postIntentUrl(crewInviteWords(crew.symbol, crew.members.filter((member) => member.state === "INVITED").map((member) => member.handle)), link)} target="_blank" rel="noopener noreferrer">
                {word("crewPost")}
              </a>
              <button
                type="button"
                className={styles.markLink}
                onClick={() => {
                  void navigator.clipboard?.writeText(link).then(() => setCopied(true));
                }}
              >
                {copied ? word("crewCopied") : word("crewCopy")}
              </button>
              <button type="button" className={styles.markLink} onClick={() => onCrew(null)} disabled={disabled}>
                {word("crewNew")}
              </button>
            </div>
          ) : null}
          <p className={styles.hint}>
            {word("crewLink")}: <span className={styles.mono}>{link}</span>
          </p>
        </>
      ) : null}
    </div>
  );
}
