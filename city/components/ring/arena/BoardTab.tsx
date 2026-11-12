'use client';

import { useEffect } from 'react';
import { num, useWords } from '@/city/lib/i18n/dict';
import { arenaStore, fighterOf, useArena } from '@/city/lib/ring/arena';
import { RING_DUELS_OPEN, useDuels } from '@/city/lib/ring/duels';
import { WEIGHT_NAMES, agentLabel, brainLabel } from '@/city/lib/ring/format';
import { AgentBody } from '../AgentBody';
import { DUEL_UI } from '../duel/words';
import s from '../duel/duel.module.css';
import a from './arena.module.css';

/**
 * The Arena's «Rating» tab (CITY-217): the board of a format — rank, body, name, class and brain, Elo and the record
 * — your agent lit. Only rated fights between agents of different owners move it; sparring with the house does not.
 */
export function BoardTab() {
  const w = useWords(DUEL_UI);
  const format = useDuels((st) => st.format);
  const formats = useDuels((st) => st.formats);
  const board = useArena((st) => st.boards[format]);
  const mine = useArena((st) => fighterOf(st.mine));

  useEffect(() => {
    void arenaStore.getState().readBoard(format);
  }, [format]);

  const toRated = () => {
    useDuels.getState().setMode('rated');
    arenaStore.getState().setTab(mine ? 'fight' : 'agent');
    if (!mine) void arenaStore.getState().makeAgent();
  };

  return (
    <>
      <div className={s.formats}>
        <div className={a.pills} role="tablist" aria-label={w.tabBoard}>
          {formats.map((id) => (
            <button key={id} type="button" role="tab" aria-selected={format === id} className={`${s.format} ${format === id ? s.formatOn : ''}`} onClick={() => useDuels.getState().setFormat(id)}>
              {id === 'duo-crack' ? w.duoCrack : w.marketReplay}
            </button>
          ))}
        </div>
      </div>
      <div className={`${s.feed} ${a.boardFeed}`}>
        {board.status === 'read' && board.rows.length ? (
          <ol className={a.board} aria-label={w.tabBoard}>
            {board.rows.map((row) => (
              <li key={row.id} className={[a.row, row.mine && a.rowMine, row.rank <= 3 && a[`podium${row.rank}`]].filter(Boolean).join(' ')} data-board-row={row.rank}>
                <span className={a.rank}>{num(row.rank)}</span>
                <span className={a.rowBody}>
                  <AgentBody archetype={row.archetype} size={40} />
                </span>
                <span className={a.rowWords}>
                  <b>
                    {agentLabel(row.archetype)}
                    {row.mine ? <i className={s.tag}>{w.you}</i> : null}
                  </b>
                  <span>
                    {WEIGHT_NAMES[row.weight]} · {brainLabel(row.brain)}
                  </span>
                </span>
                <span className={a.rowScore}>
                  <b className={row.rating.provisional ? a.provisional : undefined}>{num(row.rating.rating)}</b>
                  <span>{w.record(row.rating.wins, row.rating.draws, row.rating.losses)}</span>
                </span>
              </li>
            ))}
          </ol>
        ) : board.status === 'failed' ? (
          <div className={a.note}>
            <span>{w.readFailed}</span>
            <button type="button" className={a.retry} onClick={() => void arenaStore.getState().readBoard(format)}>
              {w.tryAgain}
            </button>
          </div>
        ) : board.status === 'read' ? (
          <div className={a.hero}>
            <div className={a.heroGlow} aria-hidden />
            <div className={a.podiumArt} aria-hidden>
              <AgentBody archetype="tactician" dim size={96} />
              <AgentBody archetype="guardian" dim size={128} />
              <AgentBody archetype="scout" dim size={84} />
            </div>
            <h3 className={a.heroTitle}>{w.boardEmpty}</h3>
            {RING_DUELS_OPEN ? (
              <button type="button" className={`${s.primary} ${a.heroAction}`} onClick={toRated} data-board-fight="">
                {w.fightForRating}
              </button>
            ) : null}
          </div>
        ) : (
          <div className={a.pane} aria-busy="true" />
        )}
      </div>
    </>
  );
}
