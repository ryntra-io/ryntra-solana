'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { openTower, openTradeCard } from '@/city/lib/coin/open';
import { useCity } from '@/city/lib/city/store';
import { digits, num, useWords } from '@/city/lib/i18n/dict';
import { usd } from '@/city/lib/launch/format';
import type { NewStage } from '@/city/lib/lens/lens';
import { changeOf, mintTail, padLabel, padsOf, shownLaunches, SORTS, STAGES, twinsOf, volumeOf, type NewLaunch } from '@/city/lib/lens/launches';
import { readNow, useNewLaunches } from '@/city/lib/lens/new-store';
import { NEW_WORDS } from '@/city/lib/lens/words';
import { isNamed } from '@/city/lib/market/types';
import { LighthouseGlyph, RingGlyph } from './glyphs';
import s from './new.module.css';

/** The ages on the list move on this often. */
const TICK_MS = 15_000;
/** Rows a ring shows while the first read is on its way. */
const SHADOWS = 6;

const closeList = () => useNewLaunches.getState().setList(false);

/** A narrow window's tabs say each ring in a word or two: three of them and their counts fit a phone. */
const TAB_WORD = { fresh: 'tabFresh', near: 'tabNear', graduated: 'tabGraduated' } as const;

/**
 * «New launches on Solana» (CITY-191) — every new launch of the network as a terminal, inside the city's window frame:
 * Just born · Final stretch · Graduated side by side, one ring at a time behind three tabs where the window is narrow.
 * A row is the coin's logo, ticker, market cap, age, launchpad, holders, volume and its change — the curve's way to
 * the DEX on the final stretch — and «Buy», the trade card in one tap. The wider the window, the more of a row it
 * shows. One quiet control orders the rings and cuts them to one launchpad; how it is all counted waits behind «i».
 * Every figure is the engine's; nothing is guessed.
 */
export default function NewLaunchesWindow() {
  const w = useWords(NEW_WORDS);
  const rings = useNewLaunches((st) => st.rings);
  const status = useNewLaunches((st) => st.status);
  const lighthouse = useNewLaunches((st) => st.lighthouse);
  const sort = useNewLaunches((st) => st.sort);
  const pad = useNewLaunches((st) => st.pad);
  const layout = useCity((st) => st.layout);
  const [tab, setTab] = useState<NewStage>('fresh');
  const [about, setAbout] = useState(false);
  const [menu, setMenu] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), TICK_MS);
    return () => clearInterval(timer);
  }, []);

  const towers = useMemo(() => new Map(layout.towers.map((placed) => [placed.tower.id, placed.tower])), [layout]);
  const all = useMemo(() => new Map(STAGES.flatMap((stage) => rings[stage].map((launch) => [launch.mint, launch] as const))), [rings]);
  const pads = useMemo(() => padsOf(rings), [rings]);
  const twins = useMemo(() => twinsOf(rings), [rings]);
  // A launchpad picked that has left the rings: every launchpad again, never an empty window.
  const padOn = pad && pads.includes(pad) ? pad : null;
  const shown = useMemo(
    () => ({ fresh: shownLaunches(rings.fresh, sort, padOn), near: shownLaunches(rings.near, sort, padOn), graduated: shownLaunches(rings.graduated, sort, padOn) }),
    [rings, sort, padOn],
  );
  const beacon = lighthouse ? (all.get(lighthouse.mint) ?? null) : null;
  const empty = STAGES.every((stage) => rings[stage].length === 0);
  const waiting = empty && (status === 'idle' || status === 'reading');

  /* A Ryntra launch or a named tower flies to its tower; any other coin opens its trade card, routed by Jupiter. */
  const go = (launch: NewLaunch) => {
    closeList();
    const tower = towers.get(launch.mint);
    if (tower && (launch.ryntra || isNamed(tower))) openTower(launch.mint);
    else if (launch.symbol) openTradeCard({ mint: launch.mint, symbol: launch.symbol, name: launch.name ?? launch.symbol, icon: launch.icon });
    else if (tower) openTower(launch.mint);
  };
  /* «Buy»: the trade card at once — a Ryntra launch through its own tower, where its curve or pool trades it. */
  const buy = (launch: NewLaunch) => {
    if (launch.ryntra || !launch.symbol) return go(launch);
    closeList();
    openTradeCard({ mint: launch.mint, symbol: launch.symbol, name: launch.name ?? launch.symbol, icon: launch.icon });
  };

  return (
    <div className={s.root} data-city-new-list="">
      <div className={s.topbar}>
        {beacon && lighthouse ? (
          <button type="button" className={s.beacon} onClick={() => go(beacon)} aria-label={w.open(beacon.symbol ? `$${beacon.symbol}` : w.newPool)}>
            <span className={s.beaconLamp} aria-hidden="true">
              <LighthouseGlyph />
            </span>
            <span className={s.beaconWord}>{w.lighthouse}</span>
            <Coin launch={beacon} small />
            <b className={s.symbol}>{beacon.symbol ? `$${beacon.symbol}` : w.newPool}</b>
            <b className={s.beaconCount}>{w.buyers(lighthouse.independent, `${lighthouse.atLeast ? '≥' : ''}${num(lighthouse.independent)}`)}</b>
          </button>
        ) : (
          <span className={`${s.live} ${status === 'off' ? s.liveOff : ''}`}>
            <i aria-hidden="true" />
            {w.live}
          </span>
        )}
        <div className={s.tools}>
          {padOn ? (
            <button type="button" className={s.picked} onClick={() => useNewLaunches.getState().setPad(null)} aria-label={w.clearPad(padOn)} title={w.clearPad(padOn)}>
              {padOn}
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" aria-hidden="true">
                <path d="M7 7l10 10M17 7 7 17" />
              </svg>
            </button>
          ) : null}
          <button
            type="button"
            className={`${s.tool} ${menu || sort !== 'feed' || padOn ? s.toolOn : ''}`}
            aria-expanded={menu}
            aria-label={w.filter}
            title={w.filter}
            onClick={() => setMenu((v) => !v)}
            data-new-filter=""
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
              <path d="M4 7h16M7 12h10M10 17h4" />
            </svg>
          </button>
          <button
            type="button"
            className={`${s.tool} ${s.toolI} ${about ? s.toolOn : ''}`}
            aria-expanded={about}
            aria-label={w.about}
            title={w.about}
            onClick={() => setAbout((v) => !v)}
            data-new-about=""
          >
            i
          </button>
        </div>
        {menu ? <Menu pads={pads} padOn={padOn} onClose={() => setMenu(false)} /> : null}
      </div>

      <div className={s.tabs} role="tablist" aria-label={w.listLabel}>
        {STAGES.map((stage) => (
          <button key={stage} type="button" role="tab" aria-selected={tab === stage} className={`${s.tab} ${tab === stage ? s.tabOn : ''}`} onClick={() => setTab(stage)} data-stage={stage}>
            <RingGlyph stage={stage} />
            <span>{w[TAB_WORD[stage]]}</span>
            <b className={s.count}>{waiting ? '' : num(shown[stage].length)}</b>
          </button>
        ))}
      </div>

      {status === 'off' && empty ? (
        <div className={s.silent}>
          <span>{w.silent}</span>
          <button type="button" className={s.retry} onClick={() => void readNow()}>
            {w.retry}
          </button>
        </div>
      ) : (
        <div className={s.columns}>
          {STAGES.map((stage) => (
            <section key={stage} className={`${s.column} ${tab === stage ? s.columnOn : ''}`} data-stage={stage} aria-label={w[stage]}>
              <div className={s.head}>
                <RingGlyph stage={stage} />
                <span>{w[stage]}</span>
                <b className={s.count}>{waiting ? '' : num(shown[stage].length)}</b>
              </div>
              <ul className={s.rows}>
                {waiting
                  ? Array.from({ length: SHADOWS }, (_, i) => <li key={i} className={s.shadow} aria-hidden="true" />)
                  : shown[stage].map((launch) => (
                      <Row
                        key={launch.mint}
                        launch={launch}
                        now={now}
                        beacon={launch.mint === lighthouse?.mint}
                        twin={launch.symbol !== null && twins.has(launch.symbol.toLowerCase())}
                        onGo={() => go(launch)}
                        onBuy={() => buy(launch)}
                      />
                    ))}
                {!waiting && shown[stage].length === 0 ? <li className={s.none}>{padOn && rings[stage].length ? w.nonePad : w.none}</li> : null}
              </ul>
            </section>
          ))}
        </div>
      )}

      {about ? (
        <div className={s.about} role="note">
          <button type="button" className={s.aboutClose} aria-label={w.close} onClick={() => setAbout(false)}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true">
              <path d="M6 6l12 12M18 6 6 18" />
            </svg>
          </button>
          <p>{w.aboutNetwork}</p>
          <p>{w.aboutFigures}</p>
          <p>{w.aboutLighthouse}</p>
          <p>{w.aboutRisk}</p>
        </div>
      ) : null}
    </div>
  );
}

/** The one quiet control: the rings' order and the launchpad they are cut to. A tap outside or Escape puts it away. */
function Menu({ pads, padOn, onClose }: { pads: readonly string[]; padOn: string | null; onClose: () => void }) {
  const w = useWords(NEW_WORDS);
  const sort = useNewLaunches((st) => st.sort);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const outside = (event: PointerEvent) => {
      const target = event.target as Element | null;
      if (box.current?.contains(target as Node) || target?.closest?.('[data-new-filter]')) return;
      onClose();
    };
    const key = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      event.preventDefault();
      onClose();
    };
    window.addEventListener('pointerdown', outside);
    window.addEventListener('keydown', key, true);
    return () => {
      window.removeEventListener('pointerdown', outside);
      window.removeEventListener('keydown', key, true);
    };
  }, [onClose]);
  const { setSort, setPad } = useNewLaunches.getState();
  return (
    <div ref={box} className={s.menu} role="group" aria-label={w.filter}>
      <span className={s.menuLabel}>{w.order}</span>
      <div className={s.choices}>
        {SORTS.map((one) => (
          <button key={one} type="button" className={`${s.choice} ${sort === one ? s.choiceOn : ''}`} aria-pressed={sort === one} onClick={() => setSort(one)}>
            {w[one]}
          </button>
        ))}
      </div>
      {pads.length > 1 ? (
        <>
          <span className={s.menuLabel}>{w.launchpad}</span>
          <div className={s.choices}>
            <button type="button" className={`${s.choice} ${padOn === null ? s.choiceOn : ''}`} aria-pressed={padOn === null} onClick={() => setPad(null)}>
              {w.allPads}
            </button>
            {pads.map((one) => (
              <button key={one} type="button" className={`${s.choice} ${padOn === one ? s.choiceOn : ''}`} aria-pressed={padOn === one} onClick={() => setPad(one)}>
                {one}
              </button>
            ))}
          </div>
        </>
      ) : null}
    </div>
  );
}

function Row({ launch, now, beacon, twin, onGo, onBuy }: { launch: NewLaunch; now: number; beacon: boolean; twin: boolean; onGo: () => void; onBuy: () => void }) {
  const w = useWords(NEW_WORDS);
  const symbol = launch.symbol ? `$${launch.symbol}` : w.newPool;
  const since = launch.stage === 'graduated' ? launch.graduatedAt : launch.bornAt;
  const name = launch.name && launch.name.toLowerCase() !== launch.symbol?.toLowerCase() ? launch.name : null;
  // Two coins of one ticker: the hint and the reader say whose, by name and the address's end; the screen by the name.
  const hint = twin ? [symbol, name, mintTail(launch.mint)].filter(Boolean).join(' · ') : undefined;
  const volume = volumeOf(launch);
  const change = changeOf(launch);
  const near = launch.stage === 'near' && launch.progress !== null;
  return (
    <li className={`${s.item} ${launch.ryntra ? s.ryntra : ''}`}>
      <button type="button" className={s.row} onClick={onGo} aria-label={w.open(hint ?? symbol)} title={hint}>
        <Coin launch={launch} />
        <span className={s.main}>
          <span className={s.line}>
            <b className={s.symbol}>{symbol}</b>
            {beacon ? (
              <span className={s.rowLamp} aria-hidden="true">
                <LighthouseGlyph />
              </span>
            ) : null}
            {name ? <span className={`${s.name} ${twin ? s.nameTwin : ''}`}>{name}</span> : null}
          </span>
          <span className={s.facts}>
            <span className={s.age}>{since !== null ? ageText(now - since, w) : ''}</span>
            <Pad launch={launch} />
            {launch.holders !== null ? (
              <span className={s.stat} title={w.holdersOf(holdersText(launch))}>
                <HoldersGlyph />
                {compact(launch.holders)}
              </span>
            ) : null}
            {volume !== null ? (
              <span className={s.stat} title={w.volumeOf(usd(volume))}>
                <VolumeGlyph />
                {usd(volume)}
              </span>
            ) : null}
            {launch.top10Pct !== null ? (
              <span className={s.stat} title={w.top10(pct(launch.top10Pct))}>
                <TopGlyph />
                {pct(launch.top10Pct)}
              </span>
            ) : null}
          </span>
        </span>
        <span className={s.figures}>
          <b className={s.cap}>{launch.marketCapUsd !== null ? usd(launch.marketCapUsd) : '—'}</b>
          {near ? (
            <span className={s.progress} title={w.progress(pct(launch.progress!))}>
              <span className={s.bar} aria-hidden="true">
                <span style={{ width: `${Math.max(4, Math.min(100, launch.progress!))}%` }} />
              </span>
              <span className={s.pct}>{digits(`${Math.floor(launch.progress!)}%`)}</span>
            </span>
          ) : change !== null ? (
            <span className={`${s.change} ${change >= 0 ? s.up : s.down}`}>{signed(change)}</span>
          ) : null}
        </span>
      </button>
      {launch.symbol ? (
        <button type="button" className={s.buy} onClick={onBuy} aria-label={w.buyCoin(symbol)}>
          <BoltGlyph />
          <span>{w.buy}</span>
        </button>
      ) : null}
    </li>
  );
}

/** The launchpad as people know it; Ryntra's own in Ryntra's orange. */
function Pad({ launch }: { launch: NewLaunch }) {
  const label = padLabel(launch.launchpad);
  if (!label) return null;
  return <span className={`${s.pad} ${launch.ryntra ? s.padRyntra : ''}`}>{label}</span>;
}

/**
 * The coin's logo from the engine over its first letter on the launchpad's disc: the letter stays until the logo has
 * drawn, and comes back when the logo fails or draws nothing — never an empty circle.
 */
function Coin({ launch, small = false }: { launch: NewLaunch; small?: boolean }) {
  const [failed, setFailed] = useState<string | null>(null);
  const [drawn, setDrawn] = useState<string | null>(null);
  const src = launch.icon && failed !== launch.icon ? launch.icon : null;
  const shown = src !== null && drawn === src;
  return (
    <span className={`${s.coin} ${small ? s.coinSmall : ''} ${launch.ryntra ? s.coinRyntra : ''}`} aria-hidden="true">
      {shown ? null : <span className={s.letter}>{(launch.symbol ?? '?').slice(0, 1)}</span>}
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={src}
          alt=""
          loading="lazy"
          draggable={false}
          className={shown ? s.logoOn : s.logo}
          onLoad={(event) => (event.currentTarget.naturalWidth > 1 ? setDrawn(src) : setFailed(src))}
          onError={() => setFailed(src)}
        />
      ) : null}
    </span>
  );
}

const HoldersGlyph = () => (
  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true">
    <circle cx="6" cy="5.5" r="2.4" />
    <path d="M1.8 13.5c.6-2.4 2.2-3.6 4.2-3.6s3.6 1.2 4.2 3.6" />
    <path d="M10.6 3.4a2.3 2.3 0 0 1 0 4.4M12 9.9c1.2.4 2 1.6 2.3 3.6" opacity="0.6" />
  </svg>
);

const VolumeGlyph = () => (
  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden="true">
    <path d="M3 13V9M6.5 13V5M10 13V7.5M13.5 13V3" />
  </svg>
);

const TopGlyph = () => (
  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" aria-hidden="true">
    <path d="M2.5 12.5h11l1-7-3.5 2.5L8 3 5 8 1.5 5.5z" />
  </svg>
);

const BoltGlyph = () => (
  <svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
    <path d="M9.2 1 3 9.2h4.1L6.4 15 13 6.6H8.8z" />
  </svg>
);

const pct = (value: number) => digits(`${value >= 10 ? Math.round(value) : Number(value.toFixed(1))}%`);

function signed(value: number): string {
  const abs = Math.abs(value);
  const text = abs >= 1000 ? `${Math.round(abs / 100) / 10}K%` : abs >= 100 ? `${Math.round(abs)}%` : `${Number(abs.toFixed(1))}%`;
  return digits(`${value >= 0 ? '+' : '−'}${text}`);
}

/** A count of holders as a row says it: 812 · 2.1K. */
function compact(value: number): string {
  if (value >= 1e4) return digits(`${Math.round(value / 1e3)}K`);
  if (value >= 1e3) return digits(`${Number((value / 1e3).toFixed(1))}K`);
  return num(value);
}

const holdersText = (launch: NewLaunch) => `${launch.holdersAtLeast ? '≥' : ''}${num(launch.holders ?? 0)}`;

function ageText(ms: number, w: { minutes: (n: number) => string; hours: (n: number) => string; days: (n: number) => string }): string {
  const minutes = Math.max(0, Math.floor(ms / 60_000));
  if (minutes < 60) return w.minutes(Math.max(1, minutes));
  if (minutes < 48 * 60) return w.hours(Math.floor(minutes / 60));
  return w.days(Math.floor(minutes / 1440));
}
