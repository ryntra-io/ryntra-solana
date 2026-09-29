/* Local ESTIMATE of the NYSE regular session — Arcus applies its own calendar
   (holidays/half-days), so callers must present this as "est." per DECISIONS. */

/** NYSE regular session 09:30–16:00 ET, Mon–Fri (holiday calendar not applied — approximate on holidays). */
export function usMarketOpen(now: Date): boolean {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York", weekday: "short", hour: "numeric", minute: "numeric", hour12: false,
  }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  const wd = get("weekday");
  if (wd === "Sat" || wd === "Sun") return false;
  const mins = (Number(get("hour")) % 24) * 60 + Number(get("minute"));
  return mins >= 9 * 60 + 30 && mins < 16 * 60;
}
