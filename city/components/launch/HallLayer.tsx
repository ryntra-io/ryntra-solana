'use client';

import { useEffect, useState } from 'react';
import { useCity } from '@/city/lib/city/store';
import { launchOpenHere, useLaunch } from '@/city/lib/launch/district';
import { hallSettled, type HallBoardId, type HallRow, type HallView } from '@/city/lib/launch/hall';
import { hallShown, startHall, useHall } from '@/city/lib/launch/hall-store';
import { actOnBoard } from '@/city/lib/launch/hall-tap';
import { BOARD_TABS, boardKind, emptyShort, emptyText, figureText, launchYours, periodText, readText, shownBoards, spanText, tallyText } from '@/city/lib/launch/hall-words';
import { useWords } from '@/city/lib/i18n/dict';
import { useRun } from '@/city/lib/run/store';
import { CloseGlyph, InfoGlyph } from '../hud/glyphs';
import s from './hall.module.css';
import { LAUNCH } from './words';

/**
 * The Hall of Fame's panel over the city: the boards as one compact table — who, coin, the number and an ↗ to what it
 * rests on — each over its week, or the span a quiet week reached back over, said beside the title. One amber action:
 * fly to the lead coin's tower when it stands in the city, else open what the lead number rests on; on a board nobody
 * is on even over all time, «Launch yours» (CITY-230). What each number is, its period, the span's tally and when the
 * engine read it sit behind one quiet «i». A board without a public source is not shown.
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
  const w = useWords(LAUNCH);
  const boards = shownBoards(view);
  const board = boards.includes(picked) ? picked : (boards[0] ?? 'catch');
  const shown = view.boards[board];
  const lead = shown.rows[0] ?? null;
  return (
    <div className={`${s.panel} ${s.sheet}`} role="dialog" aria-label={w.hallOfFame}>
      <div className={s.head}>
        <div className={s.kicker}>
          <span className={s.display}>{w.hallOfFame}</span>
          {view.network === 'solana:devnet' && <span className={s.tag}>{w.devnet}</span>}
          {stub && <span className={`${s.tag} ${s.tagStub}`}>{w.stub}</span>}
          {lead && <span className={`${s.tag} ${s.tagSpan}`}>{spanText(shown.span)}</span>}
        </div>
        <button className={`${s.info} ${more ? s.infoOn : ''}`} aria-label={w.details} aria-expanded={more} aria-controls="city-hall-more" onClick={() => setMore((v) => !v)}>
          <InfoGlyph />
        </button>
        <button className={s.close} aria-label={w.close} onClick={() => useHall.getState().close()}>
          <CloseGlyph />
        </button>
      </div>

      <div className={s.tabs} role="tablist" aria-label={w.boards}>
        {boards.map((id) => (
          <button key={id} role="tab" aria-selected={id === board} className={`${s.tab} ${id === board ? s.tabOn : ''}`} onClick={() => useHall.getState().pick(id)}>
            {BOARD_TABS[id]}
          </button>
        ))}
      </div>

      {shown.rows.length ? <Table rows={shown.rows} board={board} more={more} /> : <p className={s.empty}>{emptyShort()}</p>}
      {more && (
        <div id="city-hall-more" className={s.more}>
          {!shown.rows.length && <p>{emptyText(view, board)}</p>}
          <p>{boardKind(board, shown.span)}</p>
          <p>
            {periodText(shown.period)} · {tallyText(view.tallies[shown.span], shown.span)}
            {view.markets.read < view.markets.listed && w.launchesRead(view.markets.read, view.markets.listed)} · {readText(view.readAt ?? view.computedAt, Date.now())}
          </p>
        </div>
      )}
      {lead ? <LeadAction row={lead} /> : <LaunchYours board={board} />}
    </div>
  );
}

function Table({ rows, board, more }: { rows: readonly HallRow[]; board: HallBoardId; more: boolean }) {
  const w = useWords(LAUNCH);
  return (
    <table className={s.table}>
      <thead>
        <tr>
          <th scope="col">#</th>
          <th scope="col">{board === 'creators' ? w.creator : w.hunter}</th>
          <th scope="col">{w.coin}</th>
          <th scope="col" className={s.num}>
            {board === 'creators' ? w.fee : '×'}
          </th>
          <th scope="col" className={s.proofHead}>
            <span className={s.hidden}>{w.proof}</span>
          </th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => {
          const figure = figureText(row.figure);
          return (
            <tr key={`${row.place}-${row.proof.id}`}>
              <td className={s.place}>{row.place}</td>
              <td className={s.who}>
                {row.name}
                {row.labels.includes('sniper') && <span className={s.label}>{w.sniper}</span>}
              </td>
              <td className={s.coin}>${row.coin.symbol}</td>
              <td className={s.num}>
                <b>{figure.value}</b>
                {more && <span>{periodText(row.period)}</span>}
              </td>
              <td className={s.proof}>
                <a href={row.proof.url} target="_blank" rel="noopener noreferrer" aria-label={row.proof.kind === 'tx' ? w.txOnSolscan : w.accountOnSolscan}>
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

/** An empty board's one amber action: the launch sheet, where a launch opens here; else nothing more than the line above. */
function LaunchYours({ board }: { board: HallBoardId }) {
  const launchable = useLaunch(launchOpenHere);
  // A board left empty by a read cut short is not «nobody»: no launch offered as if it were.
  const settled = useHall((st) => (st.view ? hallSettled(st.view.boards[board]) : false));
  if (!launchable || !settled) return null;
  return (
    <button className={s.action} onClick={() => actOnBoard(board)}>
      {launchYours()}
    </button>
  );
}

/** The panel's one amber action: the lead coin's tower when the city shows it, else what the lead number rests on. */
function LeadAction({ row }: { row: HallRow }) {
  const tower = useCity((st) => st.layout.towers.some((placed) => placed.tower.id === row.coin.token));
  const w = useWords(LAUNCH);
  if (tower) {
    return (
      <button className={s.action} onClick={() => useCity.getState().select(row.coin.token)}>
        {w.flyTo(row.coin.symbol)}
      </button>
    );
  }
  return (
    <a className={s.action} href={row.proof.url} target="_blank" rel="noopener noreferrer">
      {row.proof.kind === 'tx' ? w.seeTx : w.seeAccount}
    </a>
  );
}
