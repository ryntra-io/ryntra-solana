'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useTrade } from '@/city/lib/trade/store';
import type { PortfolioPnl } from '@/lib/portfolio/pnl';
import { readAnswer } from './pnl-view';

/** The result as the block holds it: for one wallet, read or not. */
export type PnlRead =
  | Readonly<{ status: 'reading' }>
  | Readonly<{ status: 'failed' }>
  | Readonly<{ status: 'ready'; pnl: PortfolioPnl }>;

/** After a trade of this screen lands, the result is read again — once the chain has it. */
const AFTER_TRADE_MS = 8_000;

async function getPnl(owner: string): Promise<PortfolioPnl | null> {
  try {
    const answer = await fetch(`/api/portfolio/pnl?${new URLSearchParams({ owner })}`, { cache: 'no-store', headers: { accept: 'application/json' } });
    if (!answer.ok) return null;
    return readAnswer(await answer.json());
  } catch {
    return null;
  }
}

/**
 * The result of the wallet on screen (`GET /api/portfolio/pnl?owner=`, public data of a public address): read when the
 * wallet changes, again on «Try again», and — on the person's own wallet — after a trade on this screen lands.
 */
export function usePnl(owner: string | null, own: boolean): Readonly<{ read: PnlRead | null; rereading: boolean; reread: () => void }> {
  const [kept, setKept] = useState<Readonly<{ owner: string; read: PnlRead }> | null>(null);
  const [rereading, setRereading] = useState(false);
  const latest = useRef(0);

  const load = useCallback(async (wallet: string, again: boolean) => {
    const mine = ++latest.current;
    if (again) setRereading(true);
    else setKept({ owner: wallet, read: { status: 'reading' } });
    const pnl = await getPnl(wallet);
    if (mine !== latest.current) return;
    setRereading(false);
    setKept((was) => {
      /* A read again that failed keeps the result already on screen. */
      if (!pnl && again && was?.owner === wallet && was.read.status === 'ready') return was;
      return { owner: wallet, read: pnl ? { status: 'ready', pnl } : { status: 'failed' } };
    });
  }, []);

  useEffect(() => {
    if (owner) void load(owner, false);
    else latest.current += 1;
  }, [owner, load]);

  useEffect(() => {
    if (!owner || !own) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const off = useTrade.subscribe((card, before) => {
      if (card.phase === before.phase || card.phase !== 'done') return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => void load(owner, true), AFTER_TRADE_MS);
    });
    return () => {
      off();
      if (timer) clearTimeout(timer);
    };
  }, [owner, own, load]);

  const reread = useCallback(() => {
    if (owner) void load(owner, kept?.owner === owner && kept.read.status === 'ready');
  }, [owner, kept, load]);

  return { read: owner && kept?.owner === owner ? kept.read : null, rereading, reread };
}
