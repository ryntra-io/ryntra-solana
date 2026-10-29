'use client';

import { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { FORMATS, type AgentView } from '@/lib/ring/contract';
import type { Building } from '@/city/lib/quarter/types';
import { BODIES } from '@/city/lib/ring/body';
import { RING_OPEN } from '@/city/lib/ring/flag';
import { FORMAT_NAMES, WEIGHT_NAMES, gamesLine, perMatch, ratingLine, usd } from '@/city/lib/ring/format';
import { garageKey, ringStore, useRing } from '@/city/lib/ring/store';
import s from '../hud/hud.module.css';
import q from '../quarter/quarter.module.css';
import { AgentBody } from './AgentBody';
import { RingEditor } from './RingEditor';
import r from './ring.module.css';

export { RING_OPEN };

/**
 * A garage's sheet in my quarter, once the Ring is open (CITY-50): the agent that lives here — its body, brain, class,
 * price and ratings — with the one way to change it; or, empty, the one way to make one. The screen that makes or
 * changes an agent opens over the city from here.
 */
export function RingGarage({ building }: { building: Building }) {
  const key = garageKey(building.quarterId, building.slot);
  const read = useRing((st) => st.garages[key]);
  const editing = useRing((st) => st.editor?.quarterId === building.quarterId && st.editor.slot === building.slot);
  const [root, setRoot] = useState<HTMLElement | null>(null);

  useEffect(() => {
    void ringStore.getState().readGarage(building.quarterId, building.slot);
    // The screen belongs to its garage: another plot, or closing the sheet, closes it.
    return () => {
      const st = ringStore.getState();
      if (st.editor?.quarterId === building.quarterId && st.editor.slot === building.slot) st.closeEditor();
      st.askOff(null);
    };
  }, [building.quarterId, building.slot]);

  const editor = editing && root ? createPortal(<RingEditor />, root) : null;
  // The screen opens over the whole city: into the city's own root, where its tokens are, not inside this sheet.
  const anchor = useCallback((node: HTMLElement | null) => {
    if (node) setRoot(node.closest('main'));
  }, []);

  if (!read || read.status === 'reading') {
    return (
      <div ref={anchor}>
        <div className={q.title}>Garage</div>
      </div>
    );
  }
  if (read.status === 'failed') {
    return (
      <div ref={anchor}>
        <div className={q.title}>The garage could not be read</div>
        <div className={`${q.about} ${q.error}`}>{read.line}</div>
        <button className={`${s.display} ${s.action}`} onClick={() => void ringStore.getState().readGarage(building.quarterId, building.slot)}>
          Try again
        </button>
      </div>
    );
  }
  if (!read.agent) {
    return (
      <div ref={anchor}>
        <div className={r.empty}>
          <AgentBody archetype="scout" dim size={96} />
          <div className={q.words}>
            <div className={q.title}>Your agent lives here</div>
          </div>
        </div>
        <button className={`${s.display} ${s.action}`} onClick={() => ringStore.getState().openEditor(building.quarterId, building.slot)}>
          Make an agent
        </button>
        {editor}
      </div>
    );
  }
  return (
    <div ref={anchor}>
      <AgentCard agent={read.agent} mine={read.mine} />
      {editor}
    </div>
  );
}

/** The agent as its garage shows it: body, brain, class and price, the ratings, the one action. */
function AgentCard({ agent, mine }: { agent: AgentView; mine: boolean }) {
  const confirm = useRing((st) => st.confirmOff === agent.id);
  const offing = useRing((st) => st.offing);
  const offError = useRing((st) => st.offError);
  const ratings = new Map(agent.ratings.map((rating) => [rating.format, rating]));
  return (
    <>
      <div className={r.card}>
        <AgentBody archetype={agent.archetype} size={112} />
        <div className={r.cardWords}>
          <div className={q.title}>{agent.name}</div>
          <div className={r.brain}>
            {agent.brain.name}
            {agent.brain.providerName && <span> · {agent.brain.providerName}</span>}
          </div>
          <div className={r.chips}>
            <span className={r.chip}>{WEIGHT_NAMES[agent.brain.weight]}</span>
            <span className={r.price}>{perMatch(agent.brain.matchMicroUsd)}</span>
          </div>
          <div className={r.line}>{BODIES[agent.archetype].line}</div>
        </div>
      </div>
      <dl className={r.ratings} aria-label="Ratings">
        {FORMATS.map((format) => {
          const rating = ratings.get(format);
          return (
            <div key={format} className={[r.rating, !rating && r.ratingOff].filter(Boolean).join(' ')}>
              <dt>{FORMAT_NAMES[format]}</dt>
              <dd>{rating ? ratingLine(rating) : '—'}</dd>
              <dd className={r.games}>{rating ? gamesLine(rating) : 'This brain can’t play it'}</dd>
            </div>
          );
        })}
      </dl>
      {mine && agent.key && (
        <div className={r.keyLine}>
          {agent.key.state === 'live' && agent.key.limitUsd !== null ? `Up to ${usd(agent.key.limitUsd * 1_000_000)} a month` : agent.key.state === 'quiet' ? 'Nothing spent yet' : 'Paused'}
        </div>
      )}
      {offError && <div className={`${q.about} ${q.error}`}>{offError}</div>}
      {mine &&
        (confirm ? (
          <div className={q.pair}>
            <button className={`${s.display} ${s.action}`} onClick={() => ringStore.getState().askOff(null)}>
              Keep it
            </button>
            <button className={q.quiet} disabled={offing} aria-busy={offing} onClick={() => void ringStore.getState().switchOff(agent)}>
              {offing ? 'Switching off…' : 'Switch off'}
            </button>
          </div>
        ) : (
          <div className={q.pair}>
            <button className={`${s.display} ${s.action}`} onClick={() => ringStore.getState().openEditor(agent.quarterId, agent.slot, agent)}>
              Change
            </button>
            <button className={q.quiet} onClick={() => ringStore.getState().askOff(agent.id)}>
              Switch off
            </button>
          </div>
        ))}
    </>
  );
}
