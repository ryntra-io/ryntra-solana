'use client';

import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { CREW_COLOURS } from '@/lib/world/contract';
import { CREW_LIGHT, HQ_LEVELS, NAME_MAX, POINTS_GIFT, shownInvite, suggestedModule } from '@/lib/world/crew';
import { playTick } from '@/city/lib/audio/engine';
import { useCity } from '@/city/lib/city/store';
import { useWords } from '@/city/lib/i18n/dict';
import { cityAccount } from '@/city/lib/quarter/account-live';
import { inviteLink } from '@/city/lib/quarter/crew';
import { crewStore, useCrew } from '@/city/lib/quarter/crew-store';
import { quarterStore, useQuarter } from '@/city/lib/quarter/store';
import type { CrewColour, CrewStreet, MyCrew } from '@/city/lib/quarter/types';
import { CloseGlyph } from '../hud/glyphs';
import s from '../hud/hud.module.css';
import { CrewPeopleGlyph, GiftGlyph, PointsGlyph } from './glyphs';
import c from './crew.module.css';
import q from './quarter.module.css';
import { CREW } from './words';

/** A crew's light as a CSS variable, for the dot, the name and the bars. */
const lit = (colour: CrewColour): CSSProperties => ({ ['--crew' as string]: CREW_LIGHT[colour] });

const tick = () => {
  if (useCity.getState().sound) playTick();
};

/**
 * The crew's one sheet (CITY-20), at the bottom like the quarter's own: start a street with a name and a colour, type a
 * code, join the street behind an invite, or — in a crew — invite, give to the headquarters and leave with one tap.
 * One amber action on each face; the rest stays behind «Details». Over the city (an invite by a link) it stands where
 * the city's one card does, above the menu.
 */
export function CrewSheet({ overCity = false }: { overCity?: boolean }) {
  const view = useCrew((st) => st.view);
  const w = useWords(CREW);
  if (!view) return null;
  return (
    <div className={`${s.panel} ${q.sheet} ${c.sheet} ${overCity ? c.overCity : ''}`} role="dialog" aria-label={w.crew} key={view}>
      {view === 'home' ? <Home /> : view === 'create' ? <Create /> : view === 'code' ? <Code /> : <Invite />}
    </div>
  );
}

/** The way into the crew from the build mode's top bar: the crew's own light once I am in one. */
export function CrewButton() {
  const status = useCrew((st) => st.status);
  const colour = useCrew((st) => st.crew?.colour ?? null);
  const open = useCrew((st) => st.view !== null);
  const w = useWords(CREW);
  if (status === 'off') return null;
  return (
    <button
      className={`${s.panel} ${s.iconBtn} ${c.entry} ${open ? c.entryOn : ''}`}
      style={colour ? lit(colour) : undefined}
      aria-label={w.crew}
      aria-pressed={open}
      data-crew-entry=""
      onClick={() => {
        tick();
        if (open) crewStore.getState().close();
        else crewStore.getState().open();
      }}
    >
      <CrewPeopleGlyph />
      {colour && <span className={c.entryDot} aria-hidden="true" />}
    </button>
  );
}

function Head({ kicker, colour }: { kicker: string; colour?: CrewColour | null }) {
  const w = useWords(CREW);
  return (
    <div className={q.head}>
      <div className={`${s.kicker} ${colour ? c.kickerLit : ''}`} style={colour ? lit(colour) : undefined}>
        <span className={colour ? c.dot : q.spark} aria-hidden="true" />
        {kicker}
      </div>
      <button className={q.close} aria-label={w.close} onClick={() => crewStore.getState().close()}>
        <CloseGlyph />
      </button>
    </div>
  );
}

function ErrorLine() {
  const error = useCrew((st) => st.error);
  if (!error) return null;
  return (
    <div className={`${q.about} ${q.error}`} role="alert">
      {error}
    </div>
  );
}

/** Twelve lots of the crew's row: the taken ones lit in the crew's colour. */
function Row({ street }: { street: CrewStreet }) {
  const w = useWords(CREW);
  return (
    <div className={c.row} style={lit(street.colour)} aria-label={w.ofLimit(street.members, street.limit)}>
      {Array.from({ length: street.limit }, (_, i) => (
        <span key={i} className={`${c.lot} ${i < street.members ? c.lotOn : ''}`} />
      ))}
      <span className={c.count}>
        {street.members}/{street.limit}
      </span>
    </div>
  );
}

/** The headquarters: its level and how far the next one is. */
function Hq({ street }: { street: CrewStreet }) {
  const { level, units, next } = street.hq;
  const w = useWords(CREW);
  const from = HQ_LEVELS[level - 1] ?? 0;
  const part = next === null ? 1 : Math.min(1, (units - from) / Math.max(1, next - from));
  return (
    <div className={c.hq} style={lit(street.colour)}>
      <span className={c.hqBadge}>
        {w.hq} <b>{level}</b>
      </span>
      <span className={c.bar} aria-hidden="true">
        <i style={{ transform: `scaleX(${part})` }} />
      </span>
      <span className={c.hqUnits}>{next === null ? w.max : `${units}/${next}`}</span>
    </div>
  );
}

function Create() {
  const [name, setName] = useState('');
  const [colour, setColour] = useState<CrewColour>('cyan');
  const busy = useCrew((st) => st.busy);
  const w = useWords(CREW);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    // A phone's keyboard would cover the city: the name is focused on a desk only.
    if (window.matchMedia?.('(hover: hover) and (pointer: fine)').matches) input.current?.focus({ preventScroll: true });
  }, []);
  const ready = [...name.trim()].length >= 2 && !busy;
  const submit = () => {
    if (!ready) return;
    tick();
    void crewStore.getState().create(name, colour);
  };
  return (
    <>
      <Head kicker={w.newCrew} colour={colour} />
      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <input
          ref={input}
          className={c.field}
          style={lit(colour)}
          value={name}
          maxLength={NAME_MAX}
          placeholder={w.crewName}
          aria-label={w.crewName}
          autoComplete="off"
          spellCheck={false}
          enterKeyHint="go"
          onChange={(e) => setName(e.target.value)}
        />
        <div className={c.swatches} role="radiogroup" aria-label={w.streetColour}>
          {CREW_COLOURS.map((k) => (
            <button
              type="button"
              key={k}
              role="radio"
              aria-checked={k === colour}
              aria-label={w.colour(k)}
              className={`${c.swatch} ${k === colour ? c.swatchOn : ''}`}
              style={lit(k)}
              onClick={() => {
                tick();
                setColour(k);
              }}
            />
          ))}
        </div>
        <ErrorLine />
        <button type="submit" className={`${s.display} ${s.action} ${ready ? '' : q.off}`} disabled={!ready}>
          {busy ? w.starting : w.start}
        </button>
      </form>
      <button className={`${s.quiet} ${c.quietWide}`} onClick={() => crewStore.getState().open('code')}>
        {w.haveCode}
      </button>
    </>
  );
}

function Code() {
  const [code, setCode] = useState('');
  const busy = useCrew((st) => st.busy);
  const w = useWords(CREW);
  const clean = code.toUpperCase().replace(/[^0-9A-Z]/g, '');
  const ready = clean.length === 8 && !busy;
  return (
    <>
      <Head kicker={w.joinCrew} />
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!ready) return;
          tick();
          void crewStore.getState().peek(clean);
        }}
      >
        <input
          className={`${c.field} ${c.code}`}
          value={clean.length > 4 ? `${clean.slice(0, 4)}-${clean.slice(4, 8)}` : clean}
          placeholder={w.codeShape}
          aria-label={w.inviteCode}
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
          inputMode="text"
          enterKeyHint="go"
          onChange={(e) => setCode(e.target.value.slice(0, 12))}
        />
        <ErrorLine />
        <button type="submit" className={`${s.display} ${s.action} ${ready ? '' : q.off}`} disabled={!ready}>
          {w.find}
        </button>
      </form>
      <button className={`${s.quiet} ${c.quietWide}`} onClick={() => crewStore.getState().open('create')}>
        {w.startInstead}
      </button>
    </>
  );
}

/** The street behind an invite, and its one action: join — after claiming a quarter, for a newcomer. */
function Invite() {
  const invite = useCrew((st) => st.invite);
  const busy = useCrew((st) => st.busy);
  const status = useQuarter((st) => st.status);
  const inCrew = useCrew((st) => st.crew?.id ?? null);
  const w = useWords(CREW);
  if (!invite) return null;
  const street = invite.street;
  if (!street) {
    return (
      <>
        <Head kicker={w.anInvite} />
        <div className={c.title}>{invite.state === 'reading' ? '…' : w.notFound}</div>
        <ErrorLine />
      </>
    );
  }
  const already = inCrew === street.id;
  const full = street.members >= street.limit;
  const join = async () => {
    tick();
    if (quarterStore.getState().status !== 'resident') {
      // A newcomer claims a quarter first (the wallet's one message, no transaction), then joins.
      const claimed = await cityAccount.getState().begin('claim', 'card');
      if (!claimed) return;
    }
    await crewStore.getState().join(invite.code);
  };
  const label = busy ? w.joining : already ? w.yours : full ? w.full : status === 'resident' ? w.join : w.claimJoin;
  const ready = !busy && !already && !full;
  return (
    <>
      <Head kicker={w.anInvite} colour={street.colour} />
      <div className={c.title} style={lit(street.colour)}>
        {street.name}
      </div>
      <Row street={street} />
      <Hq street={street} />
      <ErrorLine />
      <button className={`${s.display} ${s.action} ${ready ? '' : q.off}`} disabled={!ready} onClick={() => void join()}>
        {label}
      </button>
    </>
  );
}

/** My crew: the row, the headquarters and two gifts, the invite as its one action, the rest behind «Details». */
function Home() {
  const crew = useCrew((st) => st.crew);
  const busy = useCrew((st) => st.busy);
  const shared = useCrew((st) => st.shared);
  const level = useQuarter((st) => st.me?.quarter.level ?? 1);
  const [details, setDetails] = useState(false);
  const w = useWords(CREW);
  if (!crew) return null;
  const piece = suggestedModule(crew.hq, level);
  const points = Math.min(POINTS_GIFT.max, 20, crew.me.points);
  const share = async () => {
    tick();
    const link = inviteLink(window.location.origin, crew.invite);
    // The link is copied whole with one tap, as the scouts' link is: the app's share sheet carries files only
    // (city/lib/app-bridge), and the system's own stands behind it.
    try {
      await navigator.clipboard.writeText(link);
      crewStore.getState().markShared();
    } catch {
      // No clipboard: the code stands under «Details».
      setDetails(true);
    }
  };
  return (
    <>
      <Head kicker={crew.name} colour={crew.colour} />
      <Row street={crew} />
      <Hq street={crew} />
      <div className={c.gifts}>
        <Gift
          label={w.module}
          glyph={<GiftGlyph />}
          done={crew.me.gave.module}
          off={busy || !piece}
          onGive={() => piece && void crewStore.getState().gift({ kind: 'module', module: piece })}
        />
        <Gift
          label={points >= POINTS_GIFT.min ? w.pts(points) : w.points}
          glyph={<PointsGlyph />}
          done={crew.me.gave.points}
          off={busy || points < POINTS_GIFT.min}
          onGive={() => void crewStore.getState().gift({ kind: 'points', points })}
        />
      </div>
      <ErrorLine />
      <button className={`${s.display} ${s.action}`} onClick={() => void share()}>
        {shared ? w.linkCopied : w.invite}
      </button>
      {details && <Details crew={crew} />}
      <div className={c.foot}>
        <button className={s.quiet} aria-expanded={details} onClick={() => setDetails(!details)}>
          {w.details}
        </button>
        <button className={`${s.quiet} ${c.leave}`} disabled={busy} onClick={() => void crewStore.getState().leave()}>
          {w.leave}
        </button>
      </div>
    </>
  );
}

function Gift({ label, glyph, done, off, onGive }: { label: string; glyph: ReactNode; done: boolean; off: boolean; onGive: () => void }) {
  const w = useWords(CREW);
  return (
    <button
      className={`${q.tile} ${c.gift} ${done ? c.giftDone : ''} ${off && !done ? q.tileLocked : ''}`}
      disabled={done || off}
      aria-label={done ? w.givenToday(label) : w.give(label)}
      onClick={() => {
        tick();
        onGive();
      }}
    >
      <span className={q.tileGlyph}>{glyph}</span>
      <span className={q.tileName}>{done ? w.given : label}</span>
    </button>
  );
}

function Details({ crew }: { crew: MyCrew }) {
  const w = useWords(CREW);
  return (
    <dl className={c.details}>
      <div>
        <dt>{w.code}</dt>
        <dd className={c.mono}>{shownInvite(crew.invite)}</dd>
      </div>
      <div>
        <dt>{w.thisWeek}</dt>
        <dd>{crew.score.total}</dd>
      </div>
      <div>
        <dt>{w.verified}</dt>
        <dd>
          {crew.score.verified}/{crew.people.length}
        </dd>
      </div>
    </dl>
  );
}
