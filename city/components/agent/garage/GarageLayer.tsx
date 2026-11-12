'use client';

import { useEffect, useMemo } from 'react';
import { GARAGE_OPEN } from '@/city/lib/agent/garage/flag';
import { reminders as remindersOf } from '@/city/lib/agent/garage/reminders';
import { closeGarage, darkTowers, GARAGE_WINDOW } from '@/city/lib/agent/garage/show';
import { useGarage } from '@/city/lib/agent/garage/store';
import { useAgent } from '@/city/lib/agent/store';
import { useAssistant } from '@/city/lib/assistant/store';
import { useBeacons } from '@/city/lib/beacon/store';
import { useCity } from '@/city/lib/city/store';
import { useWords } from '@/city/lib/i18n/dict';
import { useFilming } from '@/city/lib/moments/MomentsLayer';
import { useRun } from '@/city/lib/run/store';
import { AgentGlyph, CloseGlyph } from '../../hud/glyphs';
import { useCityWindow } from '../../window/useCityWindow';
import { GarageWindow } from './GarageWindow';
import { useMyTowers } from './useMyTowers';
import { GARAGE } from './words';
import s from './garage.module.css';

/**
 * The agent in the garage of your quarter (CITY-29), mounted with the city's other layers: its window in the city's one
 * frame (CITY-65) — in a bay beside the city on a computer (CITY-84), the bottom sheet on a phone — and, while it shows
 * towers with the window stepped aside, a small chip back to it. The Deck's «Agents» tray opens it with its «Garage»
 * door, and so does a tap on the garage of your quarter (`GarageOpener`, in place of the garage's sheet). It only reads:
 * your towers, the beacons, the scout — and asks Ryntra for advice within its day's budget.
 */
export function GarageLayer() {
  if (!GARAGE_OPEN) return null;
  return <Layer />;
}

function Layer() {
  const open = useGarage((st) => st.open);
  const name = useGarage((st) => st.settings.name);
  const on = useGarage((st) => st.settings.on);
  const report = useGarage((st) => st.report);
  const topics = useGarage((st) => st.settings.topics);
  const running = useRun((st) => st.phase !== 'off');
  const filming = useFilming();
  const { mine, live } = useMyTowers();
  const rules = useBeacons((st) => st.rules);
  const states = useBeacons((st) => st.states);
  const scoutOn = useAgent((st) => st.on);
  const scoutPhase = useAgent((st) => st.phase);
  const scoutUntil = useAgent((st) => st.until);
  const scoutFind = useAgent((st) => st.find);
  const towers = useCity((st) => st.snapshot.towers);

  useEffect(() => useGarage.getState().hydrate(), []);
  // The beacons are read from the device at once, wherever the window opens.
  useEffect(() => useBeacons.getState().load(), []);

  const shown = open && !running && !filming;

  // The report of this opening: made once the city's read is live, then it stays as it was for the opening.
  useEffect(() => {
    if (!shown || !on) return;
    if (!report || report.status === 'waiting') useGarage.getState().look(mine, live);
  }, [shown, on, report, mine, live]);

  // A tower card picked, the logo's way home or Ryntra's own panel: the agent's towers go dark and the chip goes.
  useEffect(
    () =>
      useCity.subscribe((city, before) => {
        if (!useGarage.getState().showing) return;
        if (city.homeAt !== before.homeAt || (city.selectedId && city.selectedId !== before.selectedId)) darkTowers();
      }),
    [],
  );
  useEffect(
    () =>
      useAssistant.subscribe((a, before) => {
        if (a.open && !before.open && useGarage.getState().showing) useGarage.getState().setShowing(null);
      }),
    [],
  );

  // Escape closes the window from its first frame; one press does one thing.
  useEffect(() => {
    if (!shown) return;
    const key = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      closeGarage();
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [shown]);

  const list = useMemo(
    () => remindersOf({ rules, states, scout: { on: scoutOn, phase: scoutPhase, until: scoutUntil, find: scoutFind }, towers, now: Date.now(), beacons: topics.beacons, scoutOn: topics.scout }),
    [rules, states, scoutOn, scoutPhase, scoutUntil, scoutFind, towers, topics.beacons, topics.scout],
  );

  const spec = useMemo(
    () => ({
      id: GARAGE_WINDOW,
      title: name,
      icon: <AgentGlyph />,
      render: () => <GarageWindow mine={mine} live={live} reminders={list} />,
      // No towers yet: as tall as its contents (CITY-221); with towers, the report and heads-ups fill the pane.
      fit: mine.length === 0,
      size: { width: 420, height: 640 },
      min: { width: 340, height: 420 },
      onClose: closeGarage,
    }),
    [name, mine, live, list],
  );
  useCityWindow(shown, spec);
  return <BackChip />;
}

/** While the agent shows towers with its window aside (a phone, the whole screen): one tap back to it, or done. */
function BackChip() {
  const w = useWords(GARAGE);
  const away = useGarage((st) => st.away);
  const showing = useGarage((st) => st.showing);
  const name = useGarage((st) => st.settings.name);
  const running = useRun((st) => st.phase !== 'off');
  if (!away || !showing || running) return null;
  return (
    <div className={s.chipBar} data-garage-chip="">
      <button type="button" className={s.back} onClick={() => useGarage.getState().show()}>
        <span className={s.backGlyph} aria-hidden="true">
          <AgentGlyph />
        </span>
        {name}
      </button>
      <button type="button" className={s.backClose} aria-label={w.done} onClick={closeGarage}>
        <CloseGlyph />
      </button>
    </div>
  );
}
