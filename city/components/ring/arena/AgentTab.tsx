'use client';

import { FORMATS, type AgentView } from '@/lib/ring/contract';
import { num, useWords } from '@/city/lib/i18n/dict';
import { arenaStore, entryWord, fighterOf, useArena } from '@/city/lib/ring/arena';
import { RING_DUELS_OPEN, useDuels } from '@/city/lib/ring/duels';
import { FORMAT_NAMES, WEIGHT_NAMES, agentLabel, brainLabel, perMatch } from '@/city/lib/ring/format';
import { ringStore, useRing } from '@/city/lib/ring/store';
import { useCityAccount } from '@/city/lib/quarter/account-live';
import { useWallet } from '@/city/lib/trade/wallet';
import { AgentBody } from '../AgentBody';
import { RingEditor } from '../RingEditor';
import { DUEL_UI, ENTRY_WORDS } from '../duel/words';
import { RING_UI } from '../words';
import s from '../duel/duel.module.css';
import a from './arena.module.css';

/**
 * The Arena's «Agent» tab (CITY-217): your agent — body, brain, class and price, a rating per format — with one way to
 * the fight; or, with none yet, one button that makes it right here, in your garage in the Arena (body → brain →
 * script, the screen of CITY-50 laid in the tab). Signed out: one button — «Connect wallet», or «Sign in» for a wallet
 * that is already connected (CITY-239).
 */
export function AgentTab() {
  const w = useWords(DUEL_UI);
  const mine = useArena((st) => st.mine);
  const signing = useArena((st) => st.signing);
  const connected = useWallet((st) => Boolean(st.connection));
  // The sign-in also runs from the wallet's own list and panel: the button follows it there too.
  const entering = useCityAccount((st) => st.step === 'connecting' || st.step === 'signing' || st.step === 'opening');
  const editor = useRing((st) => st.editor);
  const agent = fighterOf(mine);
  // The making screen of this window: for the Arena's garage, or for one of your agents.
  const editing = !!editor && (editor.quarterId === mine.bay?.quarter || mine.agents.some((x) => x.id === editor.agent?.id));

  if (editing) {
    return (
      <div className={a.pane}>
        <RingEditor inline />
      </div>
    );
  }
  if (mine.status === 'idle' || (mine.status === 'reading' && !agent)) return <div className={a.pane} aria-busy="true" />;
  if (mine.status === 'failed') {
    return (
      <div className={a.hero}>
        <AgentBody archetype="scout" dim size={150} />
        <p className={a.heroLine}>{w.readFailed}</p>
        <button type="button" className={s.quiet} onClick={() => void arenaStore.getState().readMine()}>
          {w.tryAgain}
        </button>
      </div>
    );
  }
  if (!agent) {
    return (
      <div className={a.hero}>
        <div className={a.heroGlow} aria-hidden />
        <AgentBody archetype="fighter" dim size={176} />
        <h3 className={a.heroTitle}>{w.yourAgent}</h3>
        <button type="button" className={`${s.primary} ${a.heroAction}`} disabled={signing || (entering && !mine.signedIn)} aria-busy={signing} onClick={() => void arenaStore.getState().makeAgent()} data-arena-make="">
          {mine.signedIn ? w.makeYours : w[ENTRY_WORDS[entryWord(connected, signing || entering)]]}
        </button>
      </div>
    );
  }
  return <Card agent={agent} />;
}

function Card({ agent }: { agent: AgentView }) {
  const w = useWords(DUEL_UI);
  const r = useWords(RING_UI);
  const confirm = useRing((st) => st.confirmOff === agent.id);
  const offing = useRing((st) => st.offing);
  const offError = useRing((st) => st.offError);
  const ratings = new Map(agent.ratings.map((rating) => [rating.format, rating]));
  const formats = useDuels((st) => st.formats);
  const playable = FORMATS.filter((f): f is (typeof formats)[number] => (formats as readonly string[]).includes(f));

  return (
    <div className={a.pane}>
      <div className={a.card}>
        <div className={a.cardBody}>
          <div className={s.halo} aria-hidden />
          <AgentBody archetype={agent.archetype} size={150} />
        </div>
        <div className={a.cardWords}>
          <h3 className={a.cardName}>{agentLabel(agent.archetype)}</h3>
          <div className={a.cardBrain}>{brainLabel(agent.brain.name)}</div>
          <div className={a.chips}>
            <span className={a.chip}>{WEIGHT_NAMES[agent.brain.weight]}</span>
            <span className={a.chipQuiet}>{perMatch(agent.brain.matchMicroUsd)}</span>
          </div>
        </div>
      </div>

      <dl className={a.ratings}>
        {playable.map((format) => {
          const rating = ratings.get(format);
          return (
            <div key={format} className={[a.ratingCell, !rating && a.ratingOff].filter(Boolean).join(' ')}>
              <dt>{FORMAT_NAMES[format]}</dt>
              <dd className={a.ratingNumber}>{rating ? num(rating.rating) : '—'}</dd>
              <dd className={a.ratingGames}>{rating ? (rating.games ? w.record(rating.wins, rating.draws, rating.losses) : w.newcomer) : r.cantPlay}</dd>
            </div>
          );
        })}
      </dl>

      {offError ? (
        <p className={s.error} role="alert">
          {offError}
        </p>
      ) : null}
      <div className={a.cardActions}>
        {confirm ? (
          <>
            <button type="button" className={s.quiet} onClick={() => ringStore.getState().askOff(null)}>
              {r.keepIt}
            </button>
            <button type="button" className={`${s.quiet} ${a.danger}`} disabled={offing} aria-busy={offing} onClick={() => void ringStore.getState().switchOff(agent)}>
              {offing ? r.switchingOff : r.switchOff}
            </button>
          </>
        ) : (
          <>
            <button type="button" className={s.quiet} onClick={() => ringStore.getState().openEditor(agent.quarterId, agent.slot, agent)} data-arena-change="">
              {r.change}
            </button>
            {RING_DUELS_OPEN ? (
              <button
                type="button"
                className={s.primary}
                onClick={() => {
                  if (!agent.formats.includes(useDuels.getState().format)) useDuels.getState().setFormat(agent.formats.includes('duo-crack') ? 'duo-crack' : 'market-replay');
                  arenaStore.getState().setTab('fight');
                }}
                data-arena-to-fight=""
              >
                {w.toFight}
              </button>
            ) : null}
          </>
        )}
      </div>
      {!confirm ? (
        <button type="button" className={a.off} onClick={() => ringStore.getState().askOff(agent.id)}>
          {r.switchOff}
        </button>
      ) : null}
    </div>
  );
}
