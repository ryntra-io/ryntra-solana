// The autopay book in memory, with the database's rules (`supabase/migrations/20261121090000_contacts_autopay_v1.sql`,
// proved on PostgreSQL by `scripts/autopay/migration-check.sql`): for the executor's tests and the devnet rehearsal, which
// has no database of its own. Never a store in service.
import { PERIOD_SECONDS } from "../schedule.ts";

/**
 * The book, with the database's rules: the queue by `next_at` and its hold, a claim per window with attempts, a lapsed
 * unsigned claim claimable again, the signature written by the latest attempt only, release by attempt or by signature,
 * paid by signature, missed only for a closed window. Times are the wall clock `clock()`, ms.
 */
export function memoryBook(clock, records) {
  const rows = new Map(records.map((record) => [record.id, { record: { ...record }, payments: new Map(), nextAt: record.startAt * 1000 }]));
  const iso = (ms) => new Date(ms).toISOString();
  const calls = [];
  const period = (r) => Number(PERIOD_SECONDS[r.record.every]) * 1000;
  const refresh = (r) => {
    const now = clock();
    const pending = [...r.payments.values()].filter((p) => p.state === "sending").map((p) => p.checkAtMs);
    let open = null;
    if (r.record.status === "working") {
      const start = r.record.startAt * 1000;
      if (now < start) open = start;
      else {
        const k = Math.floor((now - start) / period(r));
        if (k >= r.record.count) open = r.record.endsAt * 1000;
        else open = r.payments.has(k) ? Math.min(start + (k + 1) * period(r), r.record.endsAt * 1000) : start + k * period(r);
      }
    }
    const all = [...pending, ...(open === null ? [] : [open])];
    r.nextAt = all.length ? Math.min(...all) : null;
  };
  const json = (r) => ({
    ...r.record,
    payments: [...r.payments.values()].sort((a, b) => a.window - b.window).map((p) => ({ window: p.window, state: p.state, signature: p.signature, at: "", attempts: p.attempts, checkAt: p.checkAtMs === null ? null : iso(p.checkAtMs), validHeight: p.validHeight })),
  });
  const event = [];
  const store = {
    calls,
    rows,
    event,
    async due(_network, limit, hold) {
      calls.push(["due", limit, hold]);
      const now = clock();
      const picked = [...rows.values()].filter((r) => r.nextAt !== null && r.nextAt <= now).sort((a, b) => a.nextAt - b.nextAt).slice(0, limit);
      for (const r of picked) r.nextAt = now + hold * 1000;
      return picked.map(json);
    },
    async claim(_network, id, window, hold) {
      calls.push(["claim", window]);
      const r = rows.get(id);
      const now = clock();
      if (!r || r.record.status !== "working" || window >= r.record.count) return null;
      const open = r.record.startAt * 1000 + window * period(r);
      if (open > now + 300_000 || open + period(r) <= now - 300_000) return null;
      const row = r.payments.get(window);
      if (row && !(row.state === "sending" && !row.signature && row.checkAtMs <= now)) return null;
      const attempts = (row?.attempts ?? 0) + 1;
      r.payments.set(window, { window, state: "sending", signature: null, attempts, validHeight: null, checkAtMs: now + hold * 1000 });
      refresh(r);
      return attempts;
    },
    async sign(_network, id, window, attempt, signature, validHeight) {
      calls.push(["sign", window, attempt]);
      const r = rows.get(id);
      const row = r?.payments.get(window);
      if (!r || r.record.status !== "working" || !row || row.state !== "sending" || row.signature || row.attempts !== attempt) return false;
      Object.assign(row, { signature, validHeight, checkAtMs: clock() + 20_000 });
      refresh(r);
      return true;
    },
    async release(_network, id, window, by, retry) {
      calls.push(["release", window, by, retry]);
      const r = rows.get(id);
      const row = r?.payments.get(window);
      if (!row || row.state !== "sending" || ("signature" in by ? row.signature !== by.signature : row.signature || row.attempts !== by.attempt)) return null;
      const closed = r.record.startAt * 1000 + (window + 1) * period(r) <= clock();
      if (closed || r.record.status !== "working") {
        Object.assign(row, { state: "missed", signature: null, validHeight: null, checkAtMs: null });
        event.push(["missed", window]);
        refresh(r);
        return "missed";
      }
      Object.assign(row, { signature: null, validHeight: null, checkAtMs: clock() + retry * 1000 });
      refresh(r);
      return "sending";
    },
    async settle(_network, id, window, state, by) {
      calls.push(["settle", window, state, by]);
      const r = rows.get(id);
      const row = r.payments.get(window);
      let changed = false;
      if (state === "missed") {
        if (r.record.startAt * 1000 + (window + 1) * period(r) > clock() + 300_000) return false;
        if (!row) {
          r.payments.set(window, { window, state: "missed", signature: null, attempts: 0, validHeight: null, checkAtMs: null });
          changed = true;
        } else if (row.state === "sending" && !row.signature && row.checkAtMs <= clock()) {
          Object.assign(row, { state: "missed", checkAtMs: null });
          changed = true;
        }
      } else if (row && row.state === "sending" && (by && "signature" in by ? row.signature === by.signature : !row.signature && row.attempts === by?.attempt)) {
        Object.assign(row, { state, checkAtMs: null, signature: by && "signature" in by ? by.signature : row.signature });
        changed = true;
      }
      if (changed) {
        event.push([state, window]);
        refresh(r);
      }
      return changed;
    },
    async status(_network, id, status) {
      calls.push(["status", status]);
      const r = rows.get(id);
      if (r.record.status !== "working") return false;
      if (status === "ended" && [...r.payments.values()].some((p) => p.state === "sending" && p.signature)) return false;
      r.record = { ...r.record, status };
      refresh(r);
      return true;
    },
  };
  return store;
}
