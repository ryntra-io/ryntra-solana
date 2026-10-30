'use client';

import { playTick } from '@/city/lib/audio/engine';
import { useWords } from '@/city/lib/i18n/dict';
import { DayPanel } from '@/lib/city-economy/DayPanel';
import { useCity } from '@/city/lib/city/store';
import { MODULES, moduleById, moduleForKind, verdict, verdictLine } from '@/city/lib/quarter/modules';
import { onEngine } from '@/city/lib/quarter/objects';
import { lotNumber, openPlots, plotLevel, streetName } from '@/city/lib/quarter/plot';
import { quarterStore, useQuarter } from '@/city/lib/quarter/store';
import { CloseGlyph, LockGlyph, SpeakerOff, SpeakerOn } from '../hud/glyphs';
import s from '../hud/hud.module.css';
import { BuildingSheet } from './BuildingSheet';
import { BackGlyph, MODULE_GLYPH } from './glyphs';
import q from './quarter.module.css';
import { QUARTER } from './words';

const ACCENT = 'var(--amber)';

/**
 * Build mode over my quarter: the way back to the city, where the quarter stands, the sound, and one sheet at the
 * bottom — a call-out while the camera flies in, one hint over the plots, the picker of a plot, the sheet of a
 * building on the engine (`BuildingSheet`), or the building that just landed. One goal on the screen, one amber action.
 */
export function BuildHud({ onSound }: { onSound: (on: boolean) => void }) {
  const mode = useQuarter((st) => st.mode);
  const quarter = useQuarter((st) => st.me?.quarter ?? null);
  const slot = useQuarter((st) => st.slot);
  const sound = useCity((st) => st.sound);
  const w = useWords(QUARTER);
  const leave = () => quarterStore.getState().leave();
  const address = quarter ? w.address(streetName(quarter.street), lotNumber(quarter.cell)) : '';
  return (
    <div className={q.layer}>
      <div className={q.top}>
        <button className={`${s.panel} ${q.back}`} onClick={leave} aria-label={w.backToCity}>
          <BackGlyph />
          {w.city}
        </button>
        <span className={`${s.panel} ${q.address}`}>
          <b>{w.arrivals}</b>
          <span>{address}</span>
        </span>
        <button className={`${s.panel} ${s.iconBtn} ${q.sound}`} aria-label={sound ? w.mute : w.soundOn} onClick={() => onSound(!sound)}>
          {sound ? <SpeakerOn /> : <SpeakerOff />}
        </button>
      </div>
      <DayPanel />
      {mode === 'arrive' ? <Welcome address={address} /> : slot !== null ? <Picker slot={slot} /> : <Hint />}
    </div>
  );
}

/** While the camera flies in: the city's own call-out, in amber. */
function Welcome({ address }: { address: string }) {
  const w = useWords(QUARTER);
  return (
    <div className={`${s.cutin} ${q.passive}`} aria-live="polite">
      <div className={s.cutinSlab} style={{ ['--accent' as string]: ACCENT }}>
        <div className={s.cutinKind}>{w.arrivals}</div>
        <div className={s.cutinMain}>
          <span className={`${s.display} ${s.cutinSymbol}`}>{w.yourSpot}</span>
          <span className={s.cutinValue}>{address}</span>
        </div>
      </div>
    </div>
  );
}

/** Over the plots: what to do on an empty lot, the building that just landed, or what comes next. */
function Hint() {
  const built = useQuarter((st) => st.me?.buildings.length ?? 0);
  const landing = useQuarter((st) => st.landing);
  const landed = useQuarter((st) => st.landed);
  const w = useWords(QUARTER);
  const done = () => quarterStore.getState().leave();
  if (landing) return null;
  if (!built) {
    return (
      <div className={`${s.panel} ${q.sheet}`}>
        <div className={s.kicker}>
          <span className={q.spark} aria-hidden="true" />
          {w.yourQuarter}
        </div>
        <div className={q.hint}>
          {w.tapA} <b>{w.glowingPlot}</b>
          {w.toBuildHome}
        </div>
      </div>
    );
  }
  const name = landed ? (moduleForKind(landed.kind)?.name ?? w.building) : null;
  const line = !landed ? w.idleLine : landed.gained > 0 ? w.gainedLine(landed.gained) : w.savedLine;
  return (
    <div className={`${s.panel} ${q.sheet} ${landed ? q.later : ''}`} key={landed?.at ?? 'idle'}>
      <div className={`${s.kicker} ${landed ? q.mint : ''}`}>
        <span className={q.spark} aria-hidden="true" />
        {name ? w.built(name) : w.yourQuarter}
      </div>
      <div className={q.hint}>{line}</div>
      <button className={`${s.display} ${s.action}`} onClick={done}>
        {w.done}
      </button>
    </div>
  );
}

/** A plot's picker: the buildings the city offers, what is open now in amber, what opens later and why. */
function Picker({ slot }: { slot: number }) {
  const me = useQuarter((st) => st.me);
  const choice = useQuarter((st) => st.choice);
  const error = useQuarter((st) => st.error);
  const busy = useQuarter((st) => st.busy);
  const w = useWords(QUARTER);
  if (!me) return null;
  const close = () => quarterStore.getState().pick(null);
  const head = (kicker: string) => (
    <div className={q.head}>
      <div className={s.kicker}>{kicker}</div>
      <button className={q.close} aria-label={w.close} onClick={close}>
        <CloseGlyph />
      </button>
    </div>
  );

  // A plot a higher level opens: what opens it, and nothing to press.
  if (slot >= openPlots(me.quarter.level)) {
    return (
      <div className={`${s.panel} ${q.sheet}`} role="dialog" aria-label={w.aClosedPlot}>
        {head(w.closedPlot)}
        <div className={q.hint}>
          {w.opensAt} <b>{w.quarterLevel(plotLevel(slot))}</b>
          {w.levelsCome}
        </div>
      </div>
    );
  }

  const here = me.buildings.find((b) => b.slot === slot) ?? null;
  // A building on the engine opens on the object it shows, not on the build tiles.
  if (here && onEngine(here.kind)) return <BuildingSheet key={slot} building={here} />;
  const def = choice ? moduleById(choice) : null;
  const v = def ? verdict(def, me.quarter, me.buildings, slot) : null;
  const ready = !!v?.ok && !busy;
  const label = busy ? w.buildingNow : def && v ? verdictLine(def, v) : w.moreSoon;
  const about = here && def?.kind === here.kind ? w.nameLevel(def.name, here.level) : (def?.line ?? w.nothingNew);
  const pick = (id: string) => {
    if (useCity.getState().sound) playTick();
    quarterStore.getState().choose(id);
  };
  return (
    <div className={`${s.panel} ${q.sheet}`} role="dialog" aria-label={w.buildOnPlot}>
      {head(here ? w.onPlot(moduleForKind(here.kind)?.name ?? w.building) : w.emptyPlot)}
      <div className={q.tiles}>
        {MODULES.map((m) => {
          const Glyph = MODULE_GLYPH[m.id];
          const on = m.id === choice;
          const open = verdict(m, me.quarter, me.buildings, slot);
          const closed = !open.ok && open.why !== 'same' && open.why !== 'taken' && open.why !== 'limit';
          return (
            <button key={m.id} className={`${q.tile} ${on ? q.tileOn : ''} ${closed ? q.tileLocked : ''}`} aria-pressed={on} aria-label={closed ? w.lockedTile(m.name, verdictLine(m, open).toLowerCase()) : m.name} onClick={() => pick(m.id)}>
              <span className={q.tileGlyph}>{Glyph ? <Glyph /> : null}</span>
              <span className={q.tileName}>{m.name}</span>
              {closed && (
                <span className={q.tileLock} aria-hidden="true">
                  <LockGlyph />
                </span>
              )}
            </button>
          );
        })}
      </div>
      <div className={`${q.about} ${error ? q.error : ''}`} role={error ? 'alert' : undefined}>
        {error ?? about}
      </div>
      <button className={`${s.display} ${s.action} ${ready ? '' : q.off}`} disabled={!ready} onClick={() => void quarterStore.getState().place()}>
        {label}
      </button>
    </div>
  );
}
