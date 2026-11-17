'use client';

import { useEffect, useId, useState, type RefObject } from 'react';
import { dateText, num } from '@/city/lib/i18n/dict';
import { useLang } from '@/city/lib/i18n/lang';
import { pct, span } from '@/city/lib/launch/format';
import { POOL_AFTER, POOL_DEFAULT, poolOpensAt } from '@/city/lib/launch/pool';
import { ExplainBox, ExplainButton } from '@/terminal/coin/parts';
import { Chip, Icon, Kick, Segment, Switch, SwitchRow, Tile } from '@/terminal/ui';
import { Glyph } from './glyphs';
import { LADDER, dayOf, shareBpsOf, signaturesOf, sniperOf, solOf } from './launch-view';
import type { LaunchModel } from './useLaunchModel';
import { useSeconds } from './useSeconds';
import l from './launch.module.css';

/** The kinds of picture every wallet shows (`shrinkPicture` reads the file itself). */
const PICTURES = 'image/png,image/jpeg,image/webp,image/gif';

/**
 * When trading opens, on the person's own clock: as a value — «Today · 20:00», «Tomorrow · 09:30», «18 Nov · 20:00» —
 * or inside a sentence (`inline`) — «20:00», «20:00 tomorrow», «20:00, 18 Nov».
 */
export function useWhen(m: LaunchModel): (at: number, inline?: boolean) => string {
  const lang = useLang();
  const now = useSeconds(15_000);
  return (at: number, inline = false) => {
    const time = dateText(at * 1000, { hour: '2-digit', minute: '2-digit' }, lang);
    const day = dayOf(at, now ?? at);
    const date = () => dateText(at * 1000, { day: 'numeric', month: 'short' }, lang);
    if (inline) return day === 'today' ? time : day === 'tomorrow' ? m.w.timeTomorrow(time) : m.w.timeOnDay(time, date());
    return day === 'today' ? m.w.today(time) : day === 'tomorrow' ? m.w.tomorrow(time) : m.w.onDay(date(), time);
  };
}

/** A ladder's prices as the design writes them: «×2 … ×10». */
export function ladderSpan(): string {
  return `×${num(LADDER.near)} … ×${num(LADDER.far)}`;
}

/**
 * The new coin's form, as the approved design lays it out: the picture beside its name and ticker; how it starts
 * trading; for a pool, when trading opens and the take-profit ladder; the three tiles; and the launch's settings behind
 * one quiet row. Every change goes through the city's own stores; nothing here stores, builds or signs.
 */
export function Form({ m, fileRef, nameRef, desk = false }: { m: LaunchModel; fileRef: RefObject<HTMLInputElement | null>; nameRef: RefObject<HTMLInputElement | null>; desk?: boolean }) {
  const { w } = m;
  useLang();
  const ids = { name: useId(), symbol: useId(), how: useId(), ladder: useId(), ladderName: useId() };
  const [how, setHow] = useState(false);
  const [ladderHow, setLadderHow] = useState(false);
  // On its way, landed, or a pool stopped half-way (it continues as it began): the form stays as it is.
  const still = m.working || m.settled || m.halfWay;
  const bad = m.problem?.field;

  useEffect(() => {
    // A desk types at once; a phone opens its keyboard only on a tap.
    if (window.matchMedia?.('(pointer: fine)').matches) nameRef.current?.focus({ preventScroll: true });
  }, [nameRef]);

  const share = shareBpsOf(m.format, m.preset);
  return (
    <>
      <div className={l.coinRow}>
        <label className={l.drop} data-bad={bad === 'picture' ? '' : undefined} data-launch-picture="">
          {m.draft.picture ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img className={l.dropImage} src={m.draft.picture.url} alt="" />
          ) : (
            <>
              <Glyph name="picture" />
              <span>{w.picture}</span>
            </>
          )}
          <input
            ref={fileRef}
            className={l.file}
            type="file"
            accept={PICTURES}
            aria-label={m.draft.picture ? w.changePicture : w.addPicture}
            disabled={still}
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = '';
              void m.choosePicture(file);
            }}
          />
        </label>
        <div className={l.names}>
          <label className={l.field} data-bad={bad === 'name' ? '' : undefined} htmlFor={ids.name}>
            <Kick>{w.name}</Kick>
            <input
              ref={nameRef}
              id={ids.name}
              className={l.text}
              value={m.draft.name}
              maxLength={64}
              placeholder={w.namePlaceholder}
              autoComplete="off"
              spellCheck={false}
              disabled={still}
              data-launch-name=""
              onChange={(event) => m.setName(event.target.value)}
            />
          </label>
          <label className={l.field} data-bad={bad === 'symbol' ? '' : undefined} htmlFor={ids.symbol}>
            <Kick>{w.ticker}</Kick>
            <span className={l.tickerRow}>
              <span className={l.dollar} aria-hidden="true">
                $
              </span>
              <input
                id={ids.symbol}
                className={l.text}
                value={m.draft.symbol}
                maxLength={16}
                placeholder={w.tickerPlaceholder}
                autoComplete="off"
                autoCapitalize="characters"
                spellCheck={false}
                disabled={still}
                data-launch-symbol=""
                onChange={(event) => m.setSymbol(event.target.value)}
              />
            </span>
          </label>
        </div>
      </div>
      {m.problem ? (
        <p className={l.problem} role="status" data-launch-problem={m.problem.field}>
          {m.problem.words}
        </p>
      ) : null}

      {m.poolOpen ? (
        <div className={l.block}>
          <div className={l.blockHead}>
            <Kick className={l.grow}>{w.how}</Kick>
            <ExplainButton label={w.howInfo} open={how} controls={ids.how} onToggle={() => setHow((was) => !was)} />
          </div>
          {how ? (
            <ExplainBox id={ids.how}>
              <span className={l.explainLines}>
                <span>{m.preset ? w.curveHow(usdShort(m.preset.graduationMarketCapUsd)) : null}</span>
                <span>{w.poolHow}</span>
              </span>
            </ExplainBox>
          ) : null}
          <fieldset className={l.bare} disabled={still} data-launch-format={m.format}>
            <Segment
              label={w.how}
              value={m.format}
              onChange={(next) => !still && m.chooseFormat(next)}
              items={[
                { id: 'curve', label: w.curve },
                { id: 'pool', label: w.pool },
              ]}
            />
          </fieldset>
        </div>
      ) : null}

      {m.poolOpen ? <OpeningChips m={m} disabled={still} /> : null}
      {desk && m.format === 'curve' && m.shield?.switchable ? <SwitchRow label={w.fmtShield} on={m.shield.on} onChange={m.chooseShield} disabled={still} /> : null}


      {m.format === 'pool' && m.choice ? (
        <div className={l.block}>
          <div className={l.ladder} data-launch-ladder={m.choice.ladder ? 'on' : 'off'}>
            <Switch on={m.choice.ladder} labelledBy={ids.ladderName} disabled={still} onChange={(on) => m.setChoice({ ...m.choice!, ladder: on })} />
            <span id={ids.ladderName} className={l.ladderName}>
              {w.ladder}
            </span>
            <span className={l.ladderSpan}>
              <Chip tone="warn">{ladderSpan()}</Chip>
            </span>
            <span className={l.grow} />
            <ExplainButton label={w.ladderInfo} open={ladderHow} controls={ids.ladder} onToggle={() => setLadderHow((was) => !was)} />
          </div>
          {ladderHow ? <ExplainBox id={ids.ladder}>{w.ladderHow(pct(LADDER.shareBps), `×${num(LADDER.near)}`, `×${num(LADDER.far)}`)}</ExplainBox> : null}
        </div>
      ) : null}

      <div className={l.tiles} data-launch-tiles="" data-off={desk ? undefined : ''}>
        <Tile label={w.share} value={share !== null ? pct(share) : '—'} />
        <Tile label={w.cost} value={m.cost !== null ? w.about(num(solOf(m.cost), { minimumFractionDigits: 2, maximumFractionDigits: 4 })) : '—'} />
        <Tile label={w.signatures} value={num(signaturesOf(m.format))} />
      </div>

      <Settings m={m} disabled={still} />
    </>
  );
}

/** A dollar figure, short, as the city writes a preset's cap: «$75K». */
export function usdShort(value: number): string {
  if (value >= 1e6) return `$${num(Number((value / 1e6).toFixed(2)))}M`;
  if (value >= 1e3) return `$${num(Number((value / 1e3).toFixed(value >= 1e4 ? 0 : 1)))}K`;
  return `$${num(Math.round(value))}`;
}

/**
 * When trading opens, as one row of choices: «At once» is the curve, each wait is the pool's — only what the
 * engine serves. A moment a sentence said stands first, lit, while it is still ahead.
 */
function OpeningChips({ m, disabled }: { m: LaunchModel; disabled: boolean }) {
  const { w } = m;
  const now = useSeconds(15_000);
  const when = useWhen(m);
  const labels = [w.in15, w.in1h, w.in6h];
  const choice = m.format === 'pool' ? m.choice : null;
  const said = choice && choice.at !== null && now !== null && poolOpensAt(choice, now) === choice.at ? choice.at : null;
  return (
    <div className={l.block} data-launch-opening="">
      <Kick>{w.opens}</Kick>
      <div className={l.openChips} role="radiogroup" aria-label={w.opensWhen}>
        <button type="button" role="radio" aria-checked={m.format === 'curve'} className={l.openChip} disabled={disabled} onClick={() => m.chooseFormat('curve')}>
          {w.openNowChip}
        </button>
        {said !== null ? (
          <button type="button" role="radio" aria-checked className={l.openChip} disabled={disabled}>
            {when(said)}
          </button>
        ) : null}
        {POOL_AFTER.map((after, index) => (
          <button
            key={after}
            type="button"
            role="radio"
            aria-checked={said === null && choice !== null && choice.after === after}
            className={l.openChip}
            disabled={disabled}
            onClick={() => m.setChoice({ ...(m.choice ?? POOL_DEFAULT), after, at: null })}
          >
            {labels[index]}
          </button>
        ))}
      </div>
    </div>
  );
}

/**
 * The launch's settings, behind one quiet row: what the first buyers pay, how it opens, and the coin the fee is paid in.
 * On the curve the city's bot shield chooses between its two presets where both are served; for a pool the creator
 * picks SOL or USDC.
 */
function Settings({ m, disabled }: { m: LaunchModel; disabled: boolean }) {
  const { w } = m;
  const lang = useLang();
  const id = useId();
  const now = useSeconds(15_000);
  const when = useWhen(m);
  const [open, setOpen] = useState(false);
  const sniper = sniperOf(m.format, m.preset);
  const fee = sniper
    ? sniper.seconds !== null
      ? w.curveFee(pct(sniper.startBps), pct(sniper.endBps), span(sniper.seconds))
      : w.poolFee(pct(sniper.startBps), pct(sniper.endBps), `×${num(sniper.multiple ?? 0, undefined, lang)}`)
    : '—';
  const at = m.format === 'pool' && m.choice && now !== null ? poolOpensAt(m.choice, now) : null;
  return (
    <div className={l.settings} data-launch-settings={open ? 'open' : 'shut'}>
      <button type="button" className={l.settingsHead} aria-expanded={open} aria-controls={open ? id : undefined} onClick={() => setOpen((was) => !was)}>
        <Kick className={l.grow}>{w.settings}</Kick>
        <Icon name="chevron" size="s" className={open ? l.chevronUp : undefined} />
      </button>
      {open ? (
        <div id={id} className={l.settingsBody}>
          <div className={l.setting}>
            <span>{w.firstBuyers}</span>
            <b>{fee}</b>
          </div>
          <div className={l.setting}>
            <span>{w.opening}</span>
            <b>{m.format === 'pool' ? (at !== null ? when(at) : '—') : w.openNow}</b>
          </div>
          <div className={l.setting}>
            <span>{w.feeCoin}</span>
            {m.format === 'pool' && m.choice ? (
              <fieldset className={l.bare} disabled={disabled}>
              <Segment
                className={l.pair}
                label={w.feeCoinPick}
                value={m.choice.pair}
                onChange={(pair) => !disabled && m.setChoice({ ...m.choice!, pair })}
                items={[
                  { id: 'SOL', label: 'SOL' },
                  { id: 'USDC', label: 'USDC' },
                ]}
              />
              </fieldset>
            ) : (
              <b>{m.preset?.pair.symbol ?? '—'}</b>
            )}
          </div>
          <p className={l.settingsHow}>{w.settingsHow}</p>
        </div>
      ) : null}
    </div>
  );
}
