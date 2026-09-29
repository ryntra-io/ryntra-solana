"use client";

import { useEffect, useState } from "react";

/**
 * A time on the reader's own clock — «17:05» — drawn once the page has
 * arrived: the server does not know the reader's time zone, and a clock in
 * UTC is not a beginner's word (canon v5.0 §2). Until then, and without a
 * time, nothing is drawn rather than a guess.
 */
export function LocalClock({ iso, locale, prefix = "" }: { iso: string | null | undefined; locale: string; /** Words drawn before the time, and only with it — a separator never stands alone. */ prefix?: string }) {
  const [text, setText] = useState<string | null>(null);
  useEffect(() => {
    const at = iso ? Date.parse(iso) : Number.NaN;
    setText(Number.isFinite(at) ? new Date(at).toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit", hour12: false }) : null);
  }, [iso, locale]);
  return text && iso ? (
    <>
      {prefix}
      <time dateTime={iso}>{text}</time>
    </>
  ) : null;
}
