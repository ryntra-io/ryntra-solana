"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

import {
  ALERT_SPECS,
  MAX_ENTRIES,
  apply,
  arm,
  conditionState,
  describeAlert,
  evaluateAlerts,
  isAddress,
  isInherited,
  lastMeaningfulChange,
  reconcile,
  watch,
  watchKey,
  type AlertEvaluation,
  type Observation,
  type WatchAlert,
  type WatchAlertKind,
  type WatchEntry,
  type WatchEvent,
} from "@/lib/markets/watch";
import { uiMultiplierToNumber } from "@/lib/token/ui-multiplier";
import { readWatchlist, writeWatchlist } from "./store";

/**
 * The watchlist, rendered.
 *
 * Everything structural is in `lib/markets/watch.ts`; this file does three
 * things and refuses a fourth. It reads the stored entries, asks the server
 * what is true of their addresses now, and folds the answer in — appending
 * events, never overwriting the entry. The fourth thing, which it does not do,
 * is decide anything: no verdict, no score, no ranking. An entry shows what
 * happened to it and who said so.
 */

export type UniverseEntry = Readonly<{ symbol: string; name: string; address: string }>;

type Loading = "idle" | "reading" | "ready" | "failed";

const ARMABLE = ALERT_SPECS.filter((spec) => spec.source !== null);
const UNSOURCED = ALERT_SPECS.filter((spec) => spec.source === null);

const day = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/* The venue's constants are not what a person reads. The Asset Passport says
   "Stock token" for the same fact, and a surface beside it saying
   `STOCK_TOKEN` is the enum leaking through the page. */
const CLASS_LABEL: Readonly<Record<string, string>> = {
  STOCK_TOKEN: "Stock token",
  GENERIC_ERC20: "Crypto token",
  COMMUNITY_TOKEN: "Community token",
};

const money = (value: number) =>
  `$${value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 4 })}`;

/* 1e18 fixed point, shown the way the Passport shows it. The raw integer is
   the honest value and an unreadable one; twelve decimals is the same number
   in the form the rest of the product states it in. */
const multiplier = (raw: string) => uiMultiplierToNumber(raw).toFixed(12);

function EventRow({ entry, event }: { entry: WatchEntry; event: WatchEvent }) {
  return (
    <li className="rw-event">
      <span className="rw-when mono">{day(event.at)}</span>
      <span className="rw-what">
        {event.headline}
        {isInherited(entry, event) ? (
          /* Read off the chain rather than witnessed. Saying so is the
             difference between a history and a claim to have been watching. */
          <span className="rw-aside"> · before this entry existed, read from the chain</span>
        ) : null}
      </span>
      <span className="rw-observed mono">{event.observed ?? ""}</span>
      <span className="rs-src mono">
        {event.source.feed} · {event.source.field}
      </span>
    </li>
  );
}

function EntryCard({
  entry,
  evaluation,
  observation,
  onDrop,
}: {
  entry: WatchEntry;
  evaluation: AlertEvaluation | null;
  observation: Observation | null;
  onDrop: (address: string) => void;
}) {
  const change = lastMeaningfulChange(entry);
  const seen = entry.seen;
  const openedAs = entry.history.find((event) => event.kind === "watched");
  const renamed = entry.history.some((event) => event.kind === "symbol-changed");
  const price = observation?.row?.price;

  return (
    <article className="rw-card">
      <header className="rw-head">
        <h3 className="rw-title">
          {seen.listed ? (
            <Link className="rm-link" href={`/robinhood/workspace/${encodeURIComponent(seen.symbol)}`}>
              <span className="rm-symbol">{seen.symbol}</span>
              <span className="rm-name">{seen.name}</span>
            </Link>
          ) : (
            <span className="rm-symbol">{seen.symbol || "Unlisted address"}</span>
          )}
        </h3>
        <button className="rs-drop" type="button" onClick={() => onDrop(entry.address)}>
          Stop watching
        </button>
      </header>

      <p className="rw-address mono">{entry.address}</p>

      <dl className="rw-facts">
        <div>
          <dt>Class</dt>
          <dd>{seen.instrumentClass ? CLASS_LABEL[seen.instrumentClass] ?? seen.instrumentClass : "Unknown"}</dd>
        </div>
        <div>
          <dt>Markets</dt>
          <dd>{seen.marketTypes.length ? seen.marketTypes.join(" · ") : "none"}</dd>
        </div>
        <div>
          <dt>Routes</dt>
          <dd>{seen.routes.length ? seen.routes.join(" · ") : "no executable route"}</dd>
        </div>
        <div>
          <dt>Venue</dt>
          <dd className={seen.venueVerified ? "rm-ok" : "rm-warn"}>{seen.venueVerified ? "verified" : "not verified"}</dd>
        </div>
        <div>
          <dt>Price</dt>
          <dd className={price?.known ? "rm-num" : "rm-unknown"}>
            {price?.known ? money(price.value) : price?.reason ?? "not read"}
          </dd>
        </div>
        <div>
          <dt>Multiplier</dt>
          <dd className={seen.uiMultiplier ? "mono" : undefined}>
            {seen.uiMultiplier ? multiplier(seen.uiMultiplier) : "no on-chain multiplier — only a Stock Token carries one"}
          </dd>
        </div>
        <div>
          <dt>Corporate action</dt>
          <dd>
            {seen.scheduledAction
              ? "a change is scheduled on chain"
              : seen.corporateActionAt
                ? `in force since ${day(seen.corporateActionAt * 1000)}`
                : seen.uiMultiplier
                  ? "none has ever taken effect"
                  : "not readable for this asset"}
          </dd>
        </div>
        <div>
          <dt>Watching since</dt>
          <dd>
            {day(entry.addedAt)}
            {renamed && openedAs ? <span className="rw-aside"> · added under a different symbol</span> : null}
          </dd>
        </div>
      </dl>

      {entry.note ? <p className="rw-note">{entry.note}</p> : null}

      <h4 className="rw-h4">Conditions</h4>
      {entry.alerts.length === 0 ? (
        <p className="rm-note">No condition is armed on this entry, so nothing here can raise anything.</p>
      ) : (
        <ul className="rw-alerts">
          {entry.alerts.map((alert) => {
            /* Four states, decided in `lib/markets/watch.ts`. Written inline
               here it would have collapsed to three — and did: an entry that
               had not been evaluated yet rendered every condition as *not true
               right now*, which is a finding nobody made. */
            const state = conditionState(alert, evaluation);
            return (
              <li key={alert.kind} className={state.state === "fired" ? "rw-alert rw-alert-fired" : "rw-alert"}>
                {/* The condition, and only then the figure. `condition` is
                    computed from the alert by `describeAlert`, so this line
                    cannot become the value that moved. */}
                <span className="rw-condition">
                  {state.state === "fired" ? state.fired.condition : describeAlert(alert)}
                </span>
                {state.state === "fired" ? (
                  <>
                    <span className="rm-warn"> fired</span>
                    <span className="rw-observed mono"> {state.fired.observed}</span>
                    <span className="rs-src mono">
                      {" "}
                      {state.fired.source.feed} · {state.fired.source.field}
                    </span>
                  </>
                ) : state.state === "unjudged" ? (
                  <span className="rw-aside"> · not judged: {state.reason}</span>
                ) : state.state === "unchecked" ? (
                  <span className="rw-aside"> · not checked yet</span>
                ) : (
                  <span className="rw-aside"> · not true right now</span>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <h4 className="rw-h4">
        Last meaningful change
        {entry.dropped > 0 ? (
          <span className="rw-aside">
            {" "}
            · {entry.history.length} kept, {entry.dropped} older dropped by this browser&rsquo;s cap
          </span>
        ) : null}
      </h4>
      <p className="rm-note">
        {change ? (
          <>
            <span className="mono">{day(change.at)}</span> — {change.headline}
          </>
        ) : (
          "Nothing has changed since this entry was made. That is an answer, not an empty box."
        )}
      </p>

      <details className="rw-history">
        <summary>History — {entry.history.length} recorded</summary>
        <ul className="rw-events">
          {entry.history
            .slice()
            .reverse()
            .map((event, index) => (
              <EventRow key={`${event.kind}-${event.at}-${index}`} entry={entry} event={event} />
            ))}
        </ul>
      </details>
    </article>
  );
}

export function Watchlist({ universe }: { universe: readonly UniverseEntry[] }) {
  const [entries, setEntries] = useState<readonly WatchEntry[]>([]);
  const [evaluations, setEvaluations] = useState<Readonly<Record<string, AlertEvaluation>>>({});
  const [observations, setObservations] = useState<Readonly<Record<string, Observation>>>({});
  const [status, setStatus] = useState<Loading>("idle");
  const [outage, setOutage] = useState<string | null>(null);

  const [pick, setPick] = useState("");
  const [note, setNote] = useState("");
  const [armed, setArmed] = useState<readonly WatchAlertKind[]>(["price-moves", "corporate-action"]);
  const [move, setMove] = useState(5);

  const byAddress = useMemo(() => new Map(universe.map((asset) => [watchKey(asset.address), asset])), [universe]);

  /**
   * Ask the server what is true of these addresses, then fold it in.
   *
   * The order matters and is the acceptance: reconcile first — which produces
   * events from the differences — then evaluate the armed conditions, then
   * apply both. Applying an observation before comparing it would leave
   * nothing to compare against, which is precisely how a watchlist loses its
   * history.
   */
  const refresh = useCallback(async (current: readonly WatchEntry[]) => {
    if (current.length === 0) {
      setStatus("ready");
      return;
    }
    setStatus("reading");
    const query = current.map((entry) => `a=${encodeURIComponent(entry.address)}`).join("&");
    try {
      const response = await fetch(`/robinhood/workspace/watchlist/observe?${query}`, { cache: "no-store" });
      const payload = (await response.json()) as { at?: number; error?: string; observations?: Observation[] };
      if (!response.ok || !payload.observations) {
        setOutage(payload.error ?? "The venue could not be read, so nothing below is current.");
        setStatus("failed");
        return;
      }
      const now = payload.at ?? Date.now();
      const seen = new Map(payload.observations.map((observation) => [watchKey(observation.address), observation]));
      const nextEvaluations: Record<string, AlertEvaluation> = {};
      const nextObservations: Record<string, Observation> = {};
      const next = current.map((entry) => {
        const observation = seen.get(entry.address);
        if (!observation) return entry;
        nextObservations[entry.address] = observation;
        const reconciliation = reconcile(entry, observation, now);
        const evaluation = evaluateAlerts(entry, observation, now);
        nextEvaluations[entry.address] = evaluation;
        return apply(entry, reconciliation, evaluation, observation, now);
      });
      setEntries(next);
      setEvaluations(nextEvaluations);
      setObservations(nextObservations);
      setOutage(null);
      setStatus("ready");
      writeWatchlist(next);
    } catch {
      setOutage("The read did not complete, so nothing below is current.");
      setStatus("failed");
    }
  }, []);

  useEffect(() => {
    const stored = readWatchlist();
    setEntries(stored);
    void refresh(stored);
  }, [refresh]);


  const add = useCallback(async (address: string) => {
    const asset = byAddress.get(watchKey(address));
    if (!asset || entries.length >= MAX_ENTRIES) return;
    if (entries.some((entry) => entry.address === watchKey(asset.address))) return;

    const alerts = armed
      .map((kind) => arm(kind, kind === "price-moves" ? move : null))
      .filter((alert): alert is WatchAlert => alert !== null);

    try {
      const response = await fetch(`/robinhood/workspace/watchlist/observe?a=${encodeURIComponent(asset.address)}`, {
        cache: "no-store",
      });
      const payload = (await response.json()) as { at?: number; observations?: Observation[] };
      const observation = payload.observations?.[0];
      if (!observation) {
        setOutage("The venue could not describe that asset, so it was not added — an entry with no first observation has nothing to reconcile against.");
        return;
      }
      const created = watch(observation, note.trim(), alerts);
      const next = [...entries, created];
      setEntries(next);
      setObservations((previous) => ({ ...previous, [watchKey(observation.address)]: observation }));
      /* Evaluate immediately, from the observation the entry was built out of.
         Without this the new card sits in the `unchecked` state until the next
         read, which is honest but needlessly blank when the answer is already
         in hand. */
      setEvaluations((previous) => ({
        ...previous,
        [created.address]: evaluateAlerts(created, observation, observation.at),
      }));
      writeWatchlist(next);
      setPick("");
      setNote("");
      setOutage(null);
    } catch {
      setOutage("The venue could not be reached, so nothing was added.");
    }
  }, [armed, byAddress, entries, move, note]);

  const drop = useCallback(
    (address: string) => {
      const next = entries.filter((entry) => entry.address !== address);
      setEntries(next);
      writeWatchlist(next);
    },
    [entries],
  );

  /**
   * The Asset Passport hands this surface an address rather than an entry.
   *
   * Read from `window.location` rather than through the router's hook, because
   * this is a one-shot instruction consumed on arrival, not a piece of page
   * state — and once consumed the parameter is removed, so a reload does not
   * re-add what the person may have just removed.
   */
  useEffect(() => {
    if (status !== "ready") return;
    const requested = new URLSearchParams(window.location.search).get("add");
    if (!requested || !isAddress(requested)) return;
    window.history.replaceState(null, "", window.location.pathname);
    void add(requested);
  }, [add, status]);

  const toggle = useCallback((kind: WatchAlertKind) => {
    setArmed((previous) => (previous.includes(kind) ? previous.filter((k) => k !== kind) : [...previous, kind]));
  }, []);

  return (
    <>
      {outage ? <p className="rm-outage">{outage}</p> : null}

      <section className="rs-block">
        <h2 className="rs-h2">Watch an asset</h2>
        <div className="rs-form">
          <label className="rs-field rw-asset">
            <span>Asset</span>
            <select value={pick} onChange={(event) => setPick(event.target.value)}>
              <option value="">Choose an instrument</option>
              {universe.map((asset) => (
                <option key={asset.address} value={asset.address}>
                  {asset.symbol} — {asset.name}
                </option>
              ))}
            </select>
          </label>
          <label className="rs-field">
            <span>Note</span>
            <input
              type="text"
              value={note}
              maxLength={280}
              placeholder="why this one"
              onChange={(event) => setNote(event.target.value)}
            />
          </label>
          <button
            className="rs-add"
            type="button"
            onClick={() => void add(pick)}
            disabled={!pick || entries.length >= MAX_ENTRIES}
          >
            Watch
          </button>
        </div>

        <ul className="rw-arm">
          {ARMABLE.map((spec) => (
            <li key={spec.kind}>
              <label>
                <input type="checkbox" checked={armed.includes(spec.kind)} onChange={() => toggle(spec.kind)} />{" "}
                {spec.label}
              </label>
              {spec.threshold ? (
                <label className="rw-threshold">
                  {" "}
                  {spec.threshold.label}
                  <input
                    type="number"
                    value={move}
                    min={spec.threshold.min}
                    max={spec.threshold.max}
                    step="0.1"
                    onChange={(event) => setMove(Number(event.target.value))}
                  />
                  {spec.threshold.unit}
                </label>
              ) : null}
              <span className="rs-src mono">
                {spec.source?.feed} · {spec.source?.field}
              </span>
            </li>
          ))}
        </ul>
        <p className="rm-note">
          {entries.length} of {MAX_ENTRIES} watched. The cap is what makes the on-chain corporate-action read
          affordable — three calls per entry, against 231 instruments the Scanner cannot sweep on every load.
        </p>
      </section>

      {status === "reading" ? <p className="rm-note">Reading the venue and the chain…</p> : null}

      {entries.length === 0 && status !== "reading" ? (
        <p className="rm-note">
          Nothing is watched yet. A watchlist entry is not a star: it is keyed by the token&rsquo;s contract address, so a
          rename, a route appearing or withdrawing, a delisting and a corporate action all land in its history instead of
          breaking it.
        </p>
      ) : (
        <section className="rw-list">
          {entries.map((entry) => (
            <EntryCard
              key={entry.address}
              entry={entry}
              evaluation={evaluations[entry.address] ?? null}
              observation={observations[entry.address] ?? null}
              onDrop={drop}
            />
          ))}
        </section>
      )}

      <section className="rs-block">
        <h2 className="rs-h2">Conditions this surface cannot arm</h2>
        <p className="rm-note">
          These conditions are part of the design, and no endpoint or contract this product reads carries the
          figure. They are registered with the exact thing that would end each, because an alert list missing
          three of its conditions reads as complete.
        </p>
        <dl className="rm-gaps">
          {UNSOURCED.map((spec) => (
            <div key={spec.kind}>
              <dt>{spec.label}</dt>
              <dd>{spec.gate}</dd>
            </div>
          ))}
        </dl>
      </section>

      <p className="rm-note">
        This list lives in this browser and is not synced to an account, because there is no account store in this
        product to sync it to. Clearing site data clears it, and nothing here is sent anywhere on your behalf: there is
        no delivery channel for it yet.
      </p>
    </>
  );
}
