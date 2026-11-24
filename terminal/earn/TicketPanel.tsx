'use client';

import { useEffect, useRef, type ReactNode } from 'react';
import { useDollar } from '@/city/lib/earn/dollar-store';
import { entriesOf } from '@/city/lib/earn/device';
import { lstOf } from '@/city/lib/earn/lst';
import { pierOf } from '@/city/lib/earn/pier';
import { usePier } from '@/city/lib/earn/pier-store';
import { useProPier } from '@/city/lib/earn/pro-store';
import { useSaver } from '@/city/lib/earn/saver-store';
import { useEarnData } from '@/city/lib/earn/store';
import { useWords } from '@/city/lib/i18n/dict';
import { Icon } from '@/terminal/ui';
import { LendTicket } from './LendTicket';
import { PoolTicket } from './PoolTicket';
import { ledgersOf } from './ledger';
import { PositionTicket, ProPositionTicket } from './PositionTicket';
import { ProTicket } from './ProTicket';
import { KeeperMount } from './keeper/KeeperMount';
import { poolPositionRow, poolRows, proPoolRows, proPositionRow } from './rows';
import { StakeTicket } from './StakeTicket';
import { closeSheet, place, ticketKey, useTicket, useTicketHeld, type Ticket } from './ticket';
import type { EarnFigures } from './useReads';
import { EARN } from './words';
import e from './earn.module.css';

/**
 * Keeps the city's stores on the ticket in front: after an action ends the stores go back to their lists, and the next
 * look at the ticket opens the thing again. Never while a signature is out.
 */
export function useTicketPlaced(front: Ticket | null): void {
  const held = useTicketHeld();
  const pool = usePier((st) => st.pool?.address ?? null);
  const boat = usePier((st) => st.boat?.address ?? null);
  const proPool = useProPier((st) => st.pier?.address ?? null);
  const proBoat = useProPier((st) => st.boat?.nftMint ?? null);
  const lst = useSaver((st) => st.lst);
  const asset = useDollar((st) => st.asset);
  const key = ticketKey(front);
  const latest = useRef(front);
  latest.current = front;
  useEffect(() => {
    const ticket = latest.current;
    if (!ticket || held) return;
    const there =
      ticket.kind === 'view'
        ? true
        : ticket.kind === 'pool'
        ? pool === ticket.address
        : ticket.kind === 'pro'
          ? proPool === ticket.address
          : ticket.kind === 'position'
            ? boat === ticket.address
            : ticket.kind === 'proPosition'
              ? proBoat === ticket.nftMint
              : ticket.kind === 'stake'
                ? lst === ticket.lst
                : asset === ticket.asset;
    if (there) return;
    // What cannot be opened any more — a position that is gone — leaves the screen's first offer in front.
    if (!place(ticket) && useTicket.getState().picked) useTicket.setState({ picked: null, sheet: false });
  }, [key, held, pool, boat, proPool, proBoat, lst, asset]);
}

/** The ticket's contents for whatever is in front, each on its own store of the city's. */
export function TicketBody({ ticket, figures, owner, onConnect }: { ticket: Ticket; figures: EarnFigures; owner: string | null; onConnect: () => void }) {
  const list = useEarnData((st) => st.piers);
  const keptBoat = usePier((st) => st.boat);
  const keptPro = useProPier((st) => st.boat);
  const pierPool = usePier((st) => st.pool?.address ?? null);
  const proPool = useProPier((st) => st.pier?.address ?? null);
  // What the stores hold themselves: a pool a refresh dropped from the list while its action was under way still has its card.
  const storePool = usePier((st) => st.pool);
  const storePro = useProPier((st) => st.pier);

  switch (ticket.kind) {
    case 'view':
      // The chooser's own card (`ViewTicket`): the screen draws it from its rows.
      return null;
    case 'pool': {
      const pool = (list.status === 'ready' ? list.value.pools.find((entry) => entry.address === ticket.address) : undefined) ?? (storePool?.address === ticket.address ? storePool : undefined);
      const row = figures.pools.find((entry) => entry.kind === 'pool' && entry.address === ticket.address) ?? (pool ? poolRows([pool])[0] : undefined);
      const pier = pool ? pierOf(pool) : null;
      return row && pier && pierPool === ticket.address ? <PoolTicket key={row.key} pier={pier} row={row} addOpen={figures.addOpen} onConnect={onConnect} /> : null;
    }
    case 'pro': {
      const pier = figures.proPiers.find((entry) => entry.address === ticket.address) ?? (storePro?.address === ticket.address ? storePro : undefined);
      const row = figures.pools.find((entry) => entry.kind === 'pro' && entry.address === ticket.address) ?? (pier ? proPoolRows([pier], figures.solPriceUsd)[0] : undefined);
      return row && pier && proPool === ticket.address ? <ProTicket key={row.key} pier={pier} row={row} onConnect={onConnect} /> : null;
    }
    case 'stake':
      return <StakeTicket onConnect={onConnect} />;
    case 'lend':
      return <LendTicket onConnect={onConnect} />;
    case 'position': {
      const view = figures.views.find((entry) => entry.address === ticket.address) ?? (keptBoat?.address === ticket.address ? keptBoat : null);
      if (!view || keptBoat?.address !== ticket.address) return null;
      const row = figures.positions.find((entry) => entry.kind === 'pool' && entry.ref === ticket.address) ?? poolPositionRow(view, owner && typeof window !== 'undefined' ? (entriesOf(owner).get(view.address) ?? null) : null);
      return <PositionTicket key={`${view.address}:${ticket.act}`} view={view} row={row} act={ticket.act} exitOpen={figures.exitOpen} solPriceUsd={figures.solPriceUsd} onConnect={onConnect} />;
    }
    case 'proPosition': {
      const boat = figures.proBoats.find((entry) => entry.nftMint === ticket.nftMint) ?? (keptPro?.nftMint === ticket.nftMint ? keptPro : null);
      const pier = boat ? figures.proAll.find((entry) => entry.address === boat.pool) : undefined;
      if (!boat || !pier || keptPro?.nftMint !== ticket.nftMint) return null;
      const row = figures.positions.find((entry) => entry.kind === 'pro' && entry.ref === ticket.nftMint) ?? proPositionRow(boat, pier, figures.solPriceUsd, ledgersOf(owner).get(boat.nftMint) ?? null);
      // In a stock pool the agent keeps, its line under the ticket, and its bounds in the ticket's place.
      return (
        <KeeperMount boat={boat} pier={pier} coins={row.coins} name={row.name} onConnect={onConnect}>
          <ProPositionTicket key={`${boat.nftMint}:${ticket.act}`} boat={boat} pier={pier} row={row} act={ticket.act} solPriceUsd={figures.solPriceUsd} onConnect={onConnect} />
        </KeeperMount>
      );
    }
  }
}

/** The ticket's name for a screen reader: what it is about. */
export function ticketName(ticket: Ticket, figures: EarnFigures): string {
  if (ticket.kind === 'stake') return lstOf(ticket.lst)?.symbol ?? '';
  if (ticket.kind === 'lend') return ticket.asset;
  if (ticket.kind === 'view') return '';
  if (ticket.kind === 'pool' || ticket.kind === 'pro') return figures.pools.find((row) => row.kind === ticket.kind && row.address === ticket.address)?.name ?? '';
  const ref = ticket.kind === 'position' ? ticket.address : ticket.nftMint;
  return figures.positions.find((row) => row.ref === ref)?.name ?? '';
}

/**
 * The phone's ticket: a sheet from the bottom over the list, as the frame's own sheet stands. A tap on the shade, the
 * close control or Escape puts it away — never while a signature is out; Tab walks its own controls.
 */
export function TicketSheet({ label, children }: { label: string; children: ReactNode }) {
  const w = useWords(EARN);
  const held = useTicketHeld();
  const sheet = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const stops = () => Array.from(sheet.current?.querySelectorAll<HTMLElement>('button:not([disabled]):not([tabindex="-1"]), a[href], input, [tabindex="0"]') ?? []);
    const before = document.activeElement as HTMLElement | null;
    sheet.current?.querySelector<HTMLElement>('[data-earn="close"]')?.focus({ preventScroll: true });
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !event.defaultPrevented) {
        event.preventDefault();
        closeSheet();
        return;
      }
      if (event.key !== 'Tab') return;
      const all = stops();
      if (!all.length) return;
      const at = all.indexOf(document.activeElement as HTMLElement);
      const next = event.shiftKey ? (at <= 0 ? all.length - 1 : at - 1) : at === all.length - 1 ? 0 : at + 1;
      event.preventDefault();
      all[next]?.focus();
    };
    window.addEventListener('keydown', key);
    return () => {
      window.removeEventListener('keydown', key);
      if (before?.isConnected) before.focus({ preventScroll: true });
    };
  }, []);
  return (
    <>
      <div className={e.scrim} aria-hidden="true" onClick={() => closeSheet()} />
      <div ref={sheet} className={e.sheet} role="dialog" aria-modal="true" aria-label={label || w.title} data-earn="sheet">
        <div className={e.sheetBar}>
          <button type="button" className={e.closeBtn} data-earn="close" aria-label={w.closeTicket} disabled={held} onClick={() => closeSheet()}>
            <Icon name="close" />
          </button>
        </div>
        {children}
      </div>
    </>
  );
}
