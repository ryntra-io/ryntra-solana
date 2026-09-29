// Server-only RPC client for the live-account layer (journal notes on real fills + alert watermarks).
// Same security model as lib/beta/rpc.ts.
// Transport lives in lib/supabase-rpc.ts (shared with beta/paper; infra failures hit reportError).

import { rpcResult } from "../supabase-rpc";
import { subjectArgs, type AccountSubject } from "../account/subject";

export type LiveNote = { followed_plan: boolean | null; mistake_tag: string | null; lesson: string | null };
export type WatchEntry = { telegram_id: number; language: string; address: string; last_sequence: number; last_recap_trades: number };

const rpc = <T,>(fn: string, args: Record<string, unknown>) => rpcResult<T>("live", fn, args);

export function liveNoteUpsert(p: {
  subject: AccountSubject; tradeId: string; market: string | null; side: string | null; pnl: number | null;
  followed: boolean | null; mistake: string | null; lesson: string | null;
}) {
  return rpc<LiveNote>("live_note_upsert", {
    ...subjectArgs(p.subject), p_trade_id: p.tradeId, p_market: p.market, p_side: p.side, p_pnl: p.pnl,
    p_followed: p.followed, p_mistake: p.mistake, p_lesson: p.lesson,
  });
}

export function liveNotesList(subject: AccountSubject) {
  return rpc<Record<string, LiveNote>>("live_notes_list", subjectArgs(subject));
}

export function watchList() {
  return rpc<WatchEntry[]>("watch_list", {});
}

export function watchUpdate(telegramId: number, lastSequence: number) {
  return rpc<boolean>("watch_update", { p_telegram_id: telegramId, p_last_sequence: lastSequence });
}

/** Advance the daily-recap watermark to the user's current closed-trade count (anti-spam). */
export function watchRecapUpdate(telegramId: number, trades: number) {
  return rpc<boolean>("watch_recap_update", { p_telegram_id: telegramId, p_trades: trades });
}
