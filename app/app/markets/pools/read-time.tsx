"use client";

import { useEffect, useState } from "react";

import { formatTime } from "./pool-format";

/**
 * A read's time in the reader's own time zone. The server runs in another zone, so the time is written only once the
 * browser has the page: the server sends the instant (`dateTime`), the browser words it — no hydration mismatch, no
 * server clock shown as the person's.
 */
export function ReadTime({ at, locale, date: asDate = false }: { at: string | number; locale: string; date?: boolean }) {
  const date = new Date(at);
  const iso = Number.isNaN(date.getTime()) ? null : date.toISOString();
  const [text, setText] = useState<string | null>(null);
  useEffect(() => setText(iso ? (asDate ? new Intl.DateTimeFormat(locale, { day: "numeric", month: "short", year: "numeric" }).format(new Date(iso)) : formatTime(iso, locale)) : "—"), [iso, locale, asDate]);
  return iso ? <time dateTime={iso}>{text ?? "…"}</time> : <span>—</span>;
}
