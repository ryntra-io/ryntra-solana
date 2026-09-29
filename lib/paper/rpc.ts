// Server-only RPC client for paper trading (same security model as lib/beta/rpc.ts).

import { rpcResult } from "../supabase-rpc";
import { subjectArgs, type AccountSubject } from "../account/subject";

export type PaperTrade = {
  id: string;
  market: string;
  side: "long" | "short";
  entry_price: number;
  size: number;
  sl: number | null;
  tp: number | null;
  status: "open" | "closed";
  exit_price: number | null;
  exit_reason: "manual" | "sl" | "tp" | null;
  fees: number;
  pnl: number | null;
  checklist: { item: string; checked: boolean }[] | null;
  reason: string | null;
  followed_plan: boolean | null;
  mistake_tag: string | null;
  lesson: string | null;
  opened_at: string;
  closed_at: string | null;
};

export type PaperStats = {
  balance: number;
  trades: number;
  wins: number;
  win_rate: number | null;
  avg_r: number | null;
  journaled: number;
  adherence_pct: number | null;
};

export type PaperList = { open: PaperTrade[]; closed: PaperTrade[]; stats: PaperStats };

// Transport lives in lib/supabase-rpc.ts (shared with beta/live; infra failures hit reportError).
const rpc = <T,>(fn: string, args: Record<string, unknown>) => rpcResult<T>("paper", fn, args);

export function paperOpen(p: {
  subject: AccountSubject; market: string; side: string; entry: number; size: number;
  sl: number; tp: number | null; entryFee: number;
  checklist: { item: string; checked: boolean }[]; reason: string;
}) {
  return rpc<PaperTrade>("paper_open", {
    ...subjectArgs(p.subject), p_market: p.market, p_side: p.side,
    p_entry: p.entry, p_size: p.size, p_sl: p.sl, p_tp: p.tp,
    p_entry_fee: p.entryFee, p_checklist: p.checklist, p_reason: p.reason,
  });
}

export function paperClose(p: { subject: AccountSubject; tradeId: string; exit: number; exitFee: number; reason: string }) {
  return rpc<PaperTrade>("paper_close", {
    ...subjectArgs(p.subject), p_trade_id: p.tradeId, p_exit: p.exit, p_exit_fee: p.exitFee, p_reason: p.reason,
  });
}

export function paperJournal(p: { subject: AccountSubject; tradeId: string; followed: boolean | null; mistake: string | null; lesson: string | null }) {
  return rpc<PaperTrade>("paper_journal", {
    ...subjectArgs(p.subject), p_trade_id: p.tradeId, p_followed: p.followed, p_mistake: p.mistake, p_lesson: p.lesson,
  });
}

export function paperList(subject: AccountSubject) {
  return rpc<PaperList>("paper_list", subjectArgs(subject));
}
