"use client";

import { useEffect, useState } from "react";

import type { WorkspaceLocale } from "@/app/shell/locale";

import { changeMoment, changePhrase, hoursLine, hoursState, hoursTone, type ChangeMoment, type HoursSession } from "./market-hours-words";

/**
 * The exchange's hours under the company's price (SOL-K1): the state the
 * issuer's calendar states — the regular session, extended or overnight
 * trading, closed — and when it changes, on the reader's own clock, with the
 * day when that is not today («Біржа зачинена · наступна сесія пн о 10:00»). The token
 * trades on Solana around the clock; outside the regular session its price
 * may part from the last close, and the line says so.
 *
 * The time is drawn once the page has arrived — the server does not know the
 * reader's time zone — and never when it has already passed (the issuer's
 * calendar is read every few minutes, a state can be minutes old): then the
 * state alone stands. A session nobody stated says nothing at all.
 */

export function MarketHours({ session, locale, className, dotClassName }: { session: HoursSession; locale: WorkspaceLocale; className?: string; dotClassName?: string }) {
  const [moment, setMoment] = useState<ChangeMoment | null>(null);
  useEffect(() => {
    const read = () => setMoment(changeMoment(session.nextChangeAt, Date.now(), locale));
    read();
    /* The minute the session changes, the time it named has passed: read it again each minute, so a passed time is never shown. */
    const timer = window.setInterval(read, 60_000);
    return () => window.clearInterval(timer);
  }, [session.nextChangeAt, locale]);
  const state = hoursState(session);
  const line = hoursLine(session, locale, moment);
  if (!state || !line) return null;
  return (
    <p className={className} data-state={hoursTone(state)} data-market-hours>
      {dotClassName ? <span className={dotClassName} aria-hidden="true" /> : null}
      {line}
    </p>
  );
}

/** The change alone — «закриється о 22:00» — beside the session's own word where a card already says the state. */
export function HoursChange({ session, locale, prefix = "", className }: { session: HoursSession; locale: WorkspaceLocale; /** Drawn before the change, and only with it. */ prefix?: string; /** Given, the change stands in its own span — drawn only with a time, never an empty line. */ className?: string }) {
  const [moment, setMoment] = useState<ChangeMoment | null>(null);
  useEffect(() => {
    const read = () => setMoment(changeMoment(session.nextChangeAt, Date.now(), locale));
    read();
    const timer = window.setInterval(read, 60_000);
    return () => window.clearInterval(timer);
  }, [session.nextChangeAt, locale]);
  const state = hoursState(session);
  if (!state || !moment) return null;
  const text = `${prefix}${changePhrase(state, moment, locale)}`;
  return className ? <span className={className}>{text}</span> : <>{text}</>;
}
