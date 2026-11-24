'use client';

import { useEffect, useId, useState, type RefObject } from 'react';
import { dateText, num } from '@/city/lib/i18n/dict';
import { useLang } from '@/city/lib/i18n/lang';
import { pct, span } from '@/city/lib/launch/format';
import { POOL_AFTER, POOL_DEFAULT, poolOpensAt } from '@/city/lib/launch/pool';
import { reviewRows } from '@/city/lib/launch/terms';
import { DESCRIPTION_MAX, type LinkKind } from '@/lib/launch/form';
import { ExplainBox, ExplainButton, Rows } from '@/terminal/coin/parts';
import { Kick, Segment, Switch } from '@/terminal/ui';
import { Glyph } from './glyphs';
import { StartFromSet } from './presets/StartFromSet';
import { LADDER, POOL_SPLIT_BPS, dayOf, shareBpsOf, signaturesOf, sniperOf, solOf } from './launch-view';
import { ProRewards } from './pro-rewards/ProRewards';
import { rewardHowOf } from './pro-rewards/view';
import type { LaunchModel } from './useLaunchModel';
import { useSeconds } from './useSeconds';
import l from './launch.module.css';

/** The kinds of picture every wallet shows (`shrinkPicture` reads the file itself). */
const PICTURES = 'image/png,image/jpeg,image/webp,image/gif';

/** The links in the order people read them on a launchpad: X, Telegram, the website. */
const LINKS: readonly LinkKind[] = ['x', 'telegram', 'website'];

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

/** A dollar figure, short, as the city writes a preset's cap: «$75K». */
export function usdShort(value: number): string {
  if (value >= 1e6) return `$${num(Number((value / 1e6).toFixed(2)))}M`;
  if (value >= 1e3) return `$${num(Number((value / 1e3).toFixed(value >= 1e4 ? 0 : 1)))}K`;
  return `$${num(Math.round(value))}`;
}

/**
 * The new coin, as a launchpad lays it out: a large picture — dropped or chosen, seen square and round — beside
 * its name and ticker; a line about it and its links; for a pool, when trading opens and the take-profit ladder; then
 * the launch's price and the creator's share in one row, everything else behind its «i». Every change goes through the
 * city's own stores; nothing here stores, builds or signs.
 */
export function Form({ m, fileRef, nameRef }: { m: LaunchModel; fileRef: RefObject<HTMLInputElement | null>; nameRef: RefObject<HTMLInputElement | null> }) {
  const { w } = m;
  useLang();
  const ids = { name: useId(), symbol: useId(), about: useId() };
  // On its way, landed, or a pool stopped half-way (it continues as it began): the form stays as it is.
  const still = m.working || m.settled || m.halfWay;
  const bad = m.problem?.field;

  useEffect(() => {
    // A desk types at once; a phone opens its keyboard only on a tap.
    if (window.matchMedia?.('(pointer: fine)').matches) nameRef.current?.focus({ preventScroll: true });
  }, [nameRef]);

  return (
    <>
      <div className={l.coinRow}>
        <Drop m={m} fileRef={fileRef} still={still} bad={bad === 'picture'} />
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
            <span className={l.tickerRow} data-empty={m.draft.symbol ? undefined : ''}>
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

      <div className={l.about} data-launch-about="">
        <label className={l.field} data-bad={bad === 'description' ? '' : undefined} htmlFor={ids.about}>
          <span className={l.fieldHead}>
            <Kick className={l.grow}>{w.description}</Kick>
            {m.about.description ? <span className={l.count}>{`${[...m.about.description.trim()].length}/${DESCRIPTION_MAX}`}</span> : null}
          </span>
          <textarea
            id={ids.about}
            className={l.textArea}
            value={m.about.description}
            rows={2}
            maxLength={DESCRIPTION_MAX + 20}
            placeholder={w.descriptionPlaceholder}
            disabled={still}
            data-launch-description=""
            onChange={(event) => m.setAbout({ description: event.target.value })}
            onBlur={() => m.leave('description')}
          />
        </label>
        <div className={l.links} role="group" aria-label={w.links}>
          {LINKS.map((kind) => (
            <label key={kind} className={l.link} data-bad={bad === kind ? '' : undefined}>
              <Glyph name={kind === 'website' ? 'globe' : kind} small />
              <input
                className={l.linkText}
                value={m.about[kind]}
                inputMode="url"
                maxLength={200}
                placeholder={kind === 'x' ? w.xPlaceholder : kind === 'telegram' ? w.telegramPlaceholder : w.websitePlaceholder}
                aria-label={kind === 'x' ? w.xLink : kind === 'telegram' ? w.telegramLink : w.website}
                autoComplete="off"
                autoCapitalize="none"
                spellCheck={false}
                disabled={still}
                data-launch-link={kind}
                onChange={(event) => m.setAbout({ [kind]: event.target.value })}
                onBlur={() => m.leave(kind)}
              />
            </label>
          ))}
        </div>
      </div>

      {m.problem ? (
        <p className={l.problem} role="status" data-launch-problem={m.problem.field}>
          {m.problem.words}
        </p>
      ) : null}

      {m.format === 'pool' ? <OpeningChips m={m} disabled={still} /> : null}

      {m.format === 'pool' && m.choice ? (
        <Toggle
          name={w.ladder}
          on={m.choice.ladder}
          onChange={(on) => m.setChoice({ ...m.choice!, ladder: on })}
          disabled={still}
          info={w.ladderInfo}
          how={w.ladderHow(pct(LADDER.shareBps), `×${num(LADDER.near)}`, `×${num(LADDER.far)}`)}
          mark="ladder"
        />
      ) : null}

      {m.format === 'pool' && m.choice ? <ProRewards choice={m.choice} onChoice={m.setChoice} symbol={m.symbol || w.tickerPlaceholder} disabled={still} /> : null}
      <StartFromSet m={m} />

      {m.format === 'curve' && m.shield?.switchable ? (
        <Toggle name={w.fmtShield} on={m.shield.on} onChange={m.chooseShield} disabled={still} info={w.shieldInfo} how={w.settingsHow} mark="shield" />
      ) : null}

      <Terms m={m} disabled={still} />
    </>
  );
}

/**
 * The picture, large: dropped on it or chosen from the files. Once there it stands square — as a launchpad's banner — with
 * its round cut beside it, as every coin's logo; without one, the place to drop it.
 */
function Drop({ m, fileRef, still, bad }: { m: LaunchModel; fileRef: RefObject<HTMLInputElement | null>; still: boolean; bad: boolean }) {
  const { w } = m;
  const [over, setOver] = useState(false);
  const picture = m.draft.picture;
  return (
    <label
      className={l.drop}
      data-bad={bad ? '' : undefined}
      data-over={over ? '' : undefined}
      data-has={picture ? '' : undefined}
      data-launch-picture=""
      onDragOver={(event) => {
        if (still) return;
        event.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(event) => {
        event.preventDefault();
        setOver(false);
        if (!still) void m.choosePicture(event.dataTransfer.files?.[0]);
      }}
    >
      {picture ? (
        <>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className={l.dropImage} src={picture.url} alt="" />
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className={l.dropRound} src={picture.url} alt="" />
          <span className={l.dropChange}>{w.change}</span>
        </>
      ) : (
        <>
          <span className={l.dropSign}>
            <Glyph name="upload" />
          </span>
          <b className={l.dropTitle}>{w.dropTitle}</b>
          <b className={l.dropTitleTouch}>{w.addPicture}</b>
          <span className={l.dropOr}>{w.dropOr}</span>
        </>
      )}
      <input
        ref={fileRef}
        className={l.file}
        type="file"
        accept={PICTURES}
        aria-label={picture ? w.changePicture : w.addPicture}
        disabled={still}
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = '';
          void m.choosePicture(file);
        }}
      />
    </label>
  );
}

/**
 * A choice that is on or off, as one row: the switch first, its name, and what it does behind its «i» — the take-profit
 * ladder (its prices too, never on the form) and the sniper shield alike.
 */
function Toggle({ name, on, onChange, disabled, info, how, mark }: { name: string; on: boolean; onChange: (on: boolean) => void; disabled: boolean; info: string; how: string; mark: 'ladder' | 'shield' }) {
  const ids = { name: useId(), how: useId() };
  const [open, setOpen] = useState(false);
  return (
    <div className={l.block}>
      <div className={l.ladder} data-launch-ladder={mark === 'ladder' ? (on ? 'on' : 'off') : undefined} data-launch-shield={mark === 'shield' ? (on ? 'on' : 'off') : undefined}>
        <Switch on={on} labelledBy={ids.name} disabled={disabled} onChange={onChange} />
        <span id={ids.name} className={l.ladderName}>
          {name}
        </span>
        <span className={l.grow} />
        <ExplainButton label={info} open={open} controls={ids.how} onToggle={() => setOpen((was) => !was)} />
      </div>
      {open ? <ExplainBox id={ids.how}>{how}</ExplainBox> : null}
    </div>
  );
}

/**
 * When a pool's trading opens, as one row of choices: each wait the engine serves; a moment a sentence said stands first,
 * lit, while it is still ahead.
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
 * The launch in one row: its price and the creator's share of the fees. Behind its «i», the rest — the network's deposit
 * with its figure, the signatures, what the first buyers pay, where the curve goes or the pool's fee coin, and who gets
 * what of every fee.
 */
function Terms({ m, disabled }: { m: LaunchModel; disabled: boolean }) {
  const { w } = m;
  const lang = useLang();
  const id = useId();
  const now = useSeconds(15_000);
  const when = useWhen(m);
  const [open, setOpen] = useState(false);
  const share = shareBpsOf(m.format, m.preset);
  const deposit = m.cost !== null ? w.about(num(solOf(m.cost), { minimumFractionDigits: 2, maximumFractionDigits: 4 })) : null;
  // The launch fee: none where the format takes none. What Solana keeps as its deposit is behind «i», with its figure.
  const free = m.free || m.preset === null;
  const ladder = m.format === 'pool' && m.choice?.ladder === true;
  const sniper = sniperOf(m.format, m.preset);
  const fee = sniper
    ? sniper.seconds !== null
      ? w.curveFee(pct(sniper.startBps), pct(sniper.endBps), span(sniper.seconds))
      : w.poolFee(pct(sniper.startBps), pct(sniper.endBps), `×${num(sniper.multiple ?? 0, undefined, lang)}`)
    : null;
  const facts: (readonly [string, string])[] = [
    // The deposit's figure stands in the row once it is known; until then «i» says who works it out.
    ...(deposit === null ? [[w.cost, w.costSoon] as const] : []),
    [w.signatures, num(signaturesOf(m.format))],
    ...(fee ? [[w.firstBuyers, fee] as const] : []),
    ...(m.format === 'pool' && m.choice && now !== null ? [[w.opening, when(poolOpensAt(m.choice, now))] as const] : []),
    ...(m.format === 'curve' && m.preset ? [[w.movesAt, usdShort(m.preset.graduationMarketCapUsd)] as const] : []),
  ];
  const split: readonly (readonly [string, readonly string[]])[] =
    m.format === 'pool'
      ? [
          [w.how, [rewardHowOf(m.choice, lang) ?? (ladder ? w.poolHowLadder(pct(10_000 - LADDER.shareBps), pct(LADDER.shareBps)) : w.poolHow)]],
          [w.share, [w.lineShare(pct(POOL_SPLIT_BPS.creator)), w.poolTheRest(pct(POOL_SPLIT_BPS.ryntra))]],
          [w.cost, [w.costPool]],
        ]
      : m.preset && m.network
        ? // The city's review: the whole split before the signature — you, Ryntra, Meteora, the exit.
          reviewRows(m.preset, m.network, m.cost, false)
            .filter((row) => row.id !== 'network' && row.id !== 'halo')
            .map((row) => [row.label, row.id === 'line' ? [row.lines.join(' · ')] : row.lines] as const)
        : [];
  return (
    <div className={l.termsBlock}>
      <div className={l.terms} data-launch-terms={m.format}>
        <span className={l.termList}>
          {free ? (
            <span className={l.term}>
              <span>{w.price}</span>
              <b data-launch-price="">{w.priceNoFee}</b>
            </span>
          ) : null}
          {deposit !== null ? (
            <span className={l.term}>
              <span>{w.cost}</span>
              <b data-launch-deposit="">{deposit}</b>
            </span>
          ) : null}
          {share !== null ? (
            <span className={l.term}>
              <span>{w.share}</span>
              <b>{pct(share)}</b>
            </span>
          ) : null}
        </span>
        <ExplainButton label={w.launchDetails} open={open} controls={id} onToggle={() => setOpen((was) => !was)} />
      </div>
      {open ? (
        <ExplainBox id={id}>
          <span className={l.explainRows} data-launch-details="">
            <Rows rows={facts} />
            {m.format === 'pool' && m.choice ? (
              <span className={l.setting}>
                <span>{w.feeCoin}</span>
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
              </span>
            ) : null}
            {split.map(([name, lines]) => (
              <span key={name} className={l.explainRow}>
                <b>{name}</b>
                {lines.map((text) => (
                  <span key={text}>{text}</span>
                ))}
              </span>
            ))}
          </span>
        </ExplainBox>
      ) : null}
    </div>
  );
}
