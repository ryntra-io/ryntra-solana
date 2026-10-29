'use client';

import { useEffect, useState } from 'react';
import { useCity } from '@/city/lib/city/store';
import type { HallBoardId, HallRow, HallView } from '@/city/lib/launch/hall';
import { hallShown, startHall, useHall } from '@/city/lib/launch/hall-store';
import { BOARD_KINDS, BOARD_TABS, EMPTY_SHORT, emptyText, figureText, periodText, readText, shownBoards, tallyText } from '@/city/lib/launch/hall-words';
import { useRun } from '@/city/lib/run/store';
import { CloseGlyph, InfoGlyph } from '../hud/glyphs';
import s from './hall.module.css';

/**
 * The Hall of Fame's panel over the city: the week's boards as one compact table — who, coin, the number and an ↗ to
 * what it rests on. One amber action: fly to the lead coin's tower when it stands in the city, else open what the lead
 * number rests on. What each number is, its period, the week's tally and when the engine read it sit behind one quiet
 * «i». A board without a public source is not shown.
 */
export function HallLayer() {
  useEffect(() => startHall(), []);
  const panel = useHall((st) => st.panel);
  const view = useHall((st) => (hallShown(st) ? st.view : null));
  const running = useRun((st) => st.phase !== 'off');
  const selectedId = useCity((st) => st.selectedId);

  // A tower picked or the run started: the city has the screen, the panel steps aside.
  useEffect(() => {
    if (selectedId || running) useHall.getState().close();
  }, [selectedId, running]);

  if (!panel || !view || running) return null;
  return (
    <div className={s.layer}>
      <HallPanel view={view} />
    </div>
  );
}

function HallPanel({ view }: { view: HallView }) {
  const picked = useHall((st) => st.board);
  const stub = useHall((st) => st.stub);
  const [more, setMore] = useState(false);
  const boards = shownBoards(view);
  const board = boards.includes(picked) ? picked : (boards[0] ?? 'catch');
  const shown = view.boards[board];
  const lead = shown.rows[0] ?? null;
  return (
    <div className={`${s.panel} ${s.sheet}`} role="dialog" aria-label="Hall of Fame">
      <div className={s.head}>
        <div className={s.kicker}>
          <span className={s.display}>Hall of Fame</span>
          {view.network === 'solana:devnet' && <span className={s.tag}>Devnet</span>}
          {stub && <span className={`${s.tag} ${s.tagStub}`}>Stub data</span>}
        </div>
        <button className={`${s.info} ${more ? s.infoOn : ''}`} aria-label="Details" aria-expanded={more} aria-controls="city-hall-more" onClick={() => setMore((v) => !v)}>
          <InfoGlyph />
        </button>
        <button className={s.close} aria-label="Close" onClick={() => useHall.getState().close()}>
          <CloseGlyph />
        </button>
      </div>

      <div className={s.tabs} role="tablist" aria-label="Boards">
        {boards.map((id) => (
          <button key={id} role="tab" aria-selected={id === board} className={`${s.tab} ${id === board ? s.tabOn : ''}`} onClick={() => useHall.getState().pick(id)}>
            {BOARD_TABS[id]}
          </button>
        ))}
      </div>

      {shown.rows.length ? <Table rows={shown.rows} board={board} more={more} /> : <p className={s.empty}>{EMPTY_SHORT}</p>}
      {more && (
        <div id="city-hall-more" className={s.more}>
          {!shown.rows.length && <p>{emptyText(view, board)}</p>}
          <p>{BOARD_KINDS[board]}</p>
          <p>
            {periodText(view.window)} · {tallyText(view.trades)}
            {view.markets.read < view.markets.listed && ` · ${view.markets.read} of ${view.markets.listed} launches read`} · {readText(view.readAt ?? view.computedAt, Date.now())}
          </p>
        </div>
      )}
      {lead && <LeadAction row={lead} />}
    </div>
  );
}

function Table({ rows, board, more }: { rows: readonly HallRow[]; board: HallBoardId; more: boolean }) {
  return (
    <table className={s.table}>
      <thead>
        <tr>
          <th scope="col">#</th>
          <th scope="col">{board === 'creators' ? 'Creator' : 'Hunter'}</th>
          <th scope="col">Coin</th>
          <th scope="col" className={s.num}>
            {board === 'creators' ? 'Fee' : '×'}
          </th>
          <th scope="col" className={s.proofHead}>
            <span className={s.hidden}>Proof</span>
          </th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => {
          const words = figureText(row.figure);
          return (
            <tr key={`${row.place}-${row.proof.id}`}>
              <td className={s.place}>{row.place}</td>
              <td className={s.who}>
                {row.name}
                {row.labels.includes('sniper') && <span className={s.label}>Sniper</span>}
              </td>
              <td className={s.coin}>${row.coin.symbol}</td>
              <td className={s.num}>
                <b>{words.value}</b>
                {more && <span>{periodText(row.period)}</span>}
              </td>
              <td className={s.proof}>
                <a href={row.proof.url} target="_blank" rel="noopener noreferrer" aria-label={`${row.proof.kind === 'tx' ? 'Transaction' : 'Account'} on Solscan`}>
                  <span aria-hidden="true">↗</span>
                </a>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

/** The panel's one amber action: the lead coin's tower when the city shows it, else what the lead number rests on. */
function LeadAction({ row }: { row: HallRow }) {
  const tower = useCity((st) => st.layout.towers.some((placed) => placed.tower.id === row.coin.token));
  if (tower) {
    return (
      <button className={s.action} onClick={() => useCity.getState().select(row.coin.token)}>
        Fly to ${row.coin.symbol}
      </button>
    );
  }
  return (
    <a className={s.action} href={row.proof.url} target="_blank" rel="noopener noreferrer">
      {row.proof.kind === 'tx' ? 'See the transaction' : 'See the account'}
    </a>
  );
}
