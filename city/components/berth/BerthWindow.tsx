'use client';

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { LaunchCabinetRow, LaunchClaimReviewResponse, LaunchCreatorCabinetResponse } from '@/lib/api/v1/contract';
import { districtFrame } from '@/city/lib/art/frames';
import { useCity } from '@/city/lib/city/store';
import { useGameMap } from '@/city/lib/game/map';
import { digits, num, useWords } from '@/city/lib/i18n/dict';
import { useLang, type Lang } from '@/city/lib/i18n/lang';
import { cardsOf, claimReady, dayCount, pickLaunch, pocketsShown, proofUrl, streamsOf, totalsOf, unitsOf, withJustLanded, type BerthCard, type DayCount, type Stream, type TowerFigures } from '@/city/lib/launch/berth';
import { runClaim, type ClaimPhase } from '@/city/lib/launch/berth-flow';
import { berthEngine, readCabinet, readLaunch, useBerth } from '@/city/lib/launch/berth-store';
import { amountText, cardDateText, claimFailureText, moneyText, moveText, pocketStateText, pocketText, priceText, shareText } from '@/city/lib/launch/berth-words';
import { allLaunches, launchWallet, useLaunch } from '@/city/lib/launch/district';
import { sol } from '@/city/lib/launch/format';
import { sameOriginImage } from '@/city/lib/launch/towers';
import { cityLaunchOpen } from '@/city/lib/launch/gate';
import { cardTag, creatorCard } from '@/city/lib/launch/cards';
import { coinLink } from '@/city/lib/share/coin-link';
import { pctText } from '@/city/lib/launch/trade-words';
import type { WalletOption } from '@/city/lib/launch/wallet';
import { BERTH } from '@/city/lib/launch/words';
import { CoinIcon } from '../chart/CoinIcon';
import { ShareGlyph } from '../hud/glyphs';
import { useShareCard } from '../launch/useShareCard';
import s from './berth.module.css';

type W = (typeof BERTH)['en'];

/** The cabinet is read again this often while the window is open; a claim reads it at once. */
const CABINET_MS = 30_000;
/** A launch that just landed and is not listed yet is looked for this often. */
const LANDED_MS = 6_000;
/** The tower's price and holders are read again this often while it is on screen. */
const FIGURES_MS = 30_000;
/** The live frames of our own city the cards stand on: the docks where a tower is born, the skyline it joins. */
const DOCKS = districtFrame('launch').files[0]!.src;
const SKYLINE = districtFrame('market').files[0]!.src;

/**
 * «Моя вежа» inside the window frame (CITY-141, CITY-168): the launch's head on a frame of our own docks — the one figure,
 * what the wallet's part earned, and the days its tower has stood — the coin's price and holders as the engine reads
 * them, the two cards and the one amber action, «Забрати». The city frames the tower itself above the sheet. The three
 * streams by $1,000, what the claim takes pocket by pocket and the receipts sit behind «i».
 */
export default function BerthWindow() {
  const connection = useLaunch((st) => st.connection);
  const setConnection = useLaunch((st) => st.setConnection);
  const cabinet = useBerth((st) => (st.wallet === connection?.address ? st.cabinet : null));
  const status = useBerth((st) => (st.wallet === connection?.address ? st.status : 'idle'));
  const w = useWords(BERTH);
  const address = connection?.address ?? null;
  const mine = useLaunch((st) => st.mine);
  const presets = useLaunch((st) => st.presets);
  const rows = useMemo(() => (cabinet && address ? withJustLanded(cabinet.launches, mine, address, presets) : []), [cabinet, address, mine, presets]);
  const unlisted = cabinet ? rows.length > cabinet.launches.length : false;

  /* The wallet the city already has comes back without a prompt. */
  useEffect(() => {
    if (connection) return;
    let live = true;
    void launchWallet()
      .then((wallet) => wallet.restore())
      .then((restored) => live && restored && setConnection(restored))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [connection, setConnection]);

  /* The wallet's launches, read now and while the window is open. */
  useEffect(() => {
    if (!address) return;
    void readCabinet(address);
    const timer = setInterval(() => document.visibilityState === 'visible' && !useBerth.getState().busy && void readCabinet(address, { poll: true }), unlisted ? LANDED_MS : CABINET_MS);
    return () => clearInterval(timer);
  }, [address, unlisted]);

  if (!address) return <Gate kind="connect" />;
  if (!cabinet) return status === 'failed' ? <Gate kind="failed" onAgain={() => void readCabinet(address)} /> : <Gate kind="reading" />;
  if (!rows.length) return <Gate kind="empty" />;
  return <Berth cabinet={cabinet} rows={rows} wallet={address} title={w.title} />;
}

/* ---------------------------------------------------------------- before the figures */

/** No launch yet: the berth gives way to the launch sheet. */
function raiseTower() {
  useBerth.getState().close();
  useLaunch.getState().openSheet();
}

function Gate({ kind, onAgain }: { kind: 'connect' | 'reading' | 'failed' | 'empty'; onAgain?: () => void }) {
  const w = useWords(BERTH);
  const lang = useLang();
  const preset = useLaunch((st) => st.preset);
  /* Before any figure of the wallet's: the three streams a launch here earns, by the preset the city launches on. */
  const rates = preset ? streamsOf({ earnings: null, migrated: true }, preset) : [];
  const pair = preset ? { symbol: preset.pair.symbol, decimals: preset.pair.decimals, dollar: true } : null;
  return (
    <div className={`${s.framed} ${s.gated}`}>
      <div className={s.hero} style={{ backgroundImage: `url(${DOCKS})` }}>
        <div className={s.heroShade} />
        {kind === 'empty' && <span className={`${s.display} ${s.gateTitle}`}>{w.empty}</span>}
      </div>
      {pair && rates.length > 0 && (
        <Streams lang={lang}>
          {rates.map((stream) => (
            <RateTile key={stream.id} stream={stream} pair={pair} lang={lang} />
          ))}
        </Streams>
      )}
      <div className={s.gate}>
        {kind === 'connect' ? (
          <ConnectWallet />
        ) : kind === 'empty' ? (
          <button type="button" className={`${s.display} ${s.action}`} onClick={raiseTower}>
            {w.raise}
          </button>
        ) : kind === 'failed' ? (
          <>
            <p className={s.quiet}>{w.unread}</p>
            <button type="button" className={`${s.display} ${s.secondary}`} onClick={onAgain}>
              {w.again}
            </button>
          </>
        ) : (
          <div className={s.bones} aria-busy="true" aria-label={w.reading}>
            <span />
            <span />
          </div>
        )}
      </div>
    </div>
  );
}

/** The creator's wallet: the city's one wallet, or the stand-in's beside the stub engine. */
function ConnectWallet() {
  const w = useWords(BERTH);
  const setConnection = useLaunch((st) => st.setConnection);
  const [options, setOptions] = useState<readonly WalletOption[] | null>(null);
  const [connecting, setConnecting] = useState<string | null>(null);
  const pick = async (name: string) => {
    setConnecting(name);
    const wallet = await launchWallet();
    const answer = await wallet.connect(name);
    setConnecting(null);
    if (answer.ok) setConnection(answer.connection);
  };
  const connect = async () => {
    const wallet = await launchWallet();
    const list = wallet.options();
    if (list.length === 1) return pick(list[0]!.name);
    setOptions(list);
  };
  if (!options)
    return (
      <button type="button" className={`${s.display} ${s.action}`} onClick={connect}>
        {w.connect}
      </button>
    );
  if (!options.length) return <p className={s.quiet}>{w.noWallet}</p>;
  return (
    <div className={s.wallets} role="list">
      {options.map((option) => (
        <button key={option.name} type="button" role="listitem" className={s.walletPick} onClick={() => void pick(option.name)} disabled={connecting !== null}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {option.icon ? <img src={option.icon} alt="" /> : null}
          <span>{connecting === option.name ? w.opening(option.name) : option.name}</span>
        </button>
      ))}
    </div>
  );
}

/* ---------------------------------------------------------------- the berth */

function Berth({ cabinet, rows, wallet, title }: { cabinet: LaunchCreatorCabinetResponse; rows: readonly LaunchCabinetRow[]; wallet: string; title: string }) {
  const lang = useLang();
  const focus = useBerth((st) => st.focus);
  const picked = useBerth((st) => st.picked);
  const token = useMemo(() => pickLaunch(rows, picked ?? focus), [rows, picked, focus]);
  const row = rows.find((launch) => launch.token === token) ?? rows[0]!;
  const unlisted = !cabinet.launches.some((launch) => launch.token === row.token);
  const presets = useLaunch((st) => st.presets);
  const network = useLaunch((st) => st.network) ?? cabinet.network;
  const stub = useLaunch((st) => st.stub);
  const open = useLaunch((st) => st.stub || cityLaunchOpen(st.network));
  const feed = useLaunch((st) => st.feed);
  const mine = useLaunch((st) => st.mine);
  const review = useBerth((st) => st.reviews[row.token] ?? null);
  const graduation = useBerth((st) => st.graduations[row.token] ?? null);
  const figures = useBerth((st) => st.figures[row.token] ?? null);
  const [details, setDetails] = useState(false);
  /* The engine's own clock when it is ahead of this one, so a fresh read never counts a day back. */
  const now = Math.max(useMinute(), Date.parse(cabinet.observedAt) || 0);

  /* The launch's own reads: its market — the price, the holders, the move's mark on the chain — and the claim's Review while something waits. */
  const waiting = row.claimable;
  useEffect(() => {
    if (waiting && open) void readLaunch(row.token, wallet, { market: false, review: true });
  }, [row.token, wallet, waiting, open, row.earnings?.mine.unclaimedRaw]);
  useEffect(() => {
    const read = () => void readLaunch(row.token, wallet, { market: true, review: false });
    read();
    const timer = setInterval(() => document.visibilityState === 'visible' && !useBerth.getState().busy && read(), FIGURES_MS);
    return () => clearInterval(timer);
  }, [row.token, wallet]);

  /* The tower itself, framed above the sheet while it is on screen; a tower the city does not stand leaves the camera be. */
  const standing = useCity((st) => st.layout.towers.some((placed) => placed.tower.id === row.token));
  useEffect(() => {
    if (!standing) return;
    useGameMap.getState().look([row.token], { aboveSheet: true });
    return () => useGameMap.getState().clear();
  }, [row.token, standing]);

  const preset = presets.find((entry) => entry.id === row.preset) ?? null;
  const streams = streamsOf(row, preset);
  const totals = totalsOf(row);
  const tower = useMemo(() => allLaunches({ feed, mine }).find((launch) => launch.token === row.token) ?? null, [feed, mine, row.token]);
  const days = dayCount(row.launchedAt, now, tower?.checks ?? null);
  const cards = cardsOf(row, graduation);
  /* The two cards to share: the cabinet's launch, the chart's mark of the move, the feed's holders — nothing else. */
  const facts = { graduation, holders: tower?.holders != null ? { count: tower.holders, atLeast: tower.holdersAtLeast } : null, tag: cardTag(network, stub) };
  /* Shared only for a coin the city's feed knows is up: one Ryntra took down (MC-1), or one the feed did not read, keeps
     its cards in the berth unshared. */
  const shared = tower && !tower.hidden ? { born: creatorCard('born', row, facts), graduated: creatorCard('graduated', row, facts) } : { born: null, graduated: null };
  const sharing = useShareCard();

  return (
    <div className={s.framed} aria-label={title}>
      {rows.length > 1 && <Strip rows={rows} token={row.token} />}

      <div className={`${s.hero} ${s.head}`} style={{ backgroundImage: `url(${DOCKS})` }}>
        <div className={s.heroShade} />
        <div className={s.heroTop}>
          <span className={s.coin}>
            <Face row={row} picture={tower?.image ?? null} />
          </span>
          <span className={s.coinWords}>
            <b className={s.display}>${row.symbol}</b>
            <span>{row.name}</span>
          </span>
          {(network === 'solana:devnet' || stub) && <span className={s.tag}>{stub ? BERTH[lang].stub : BERTH[lang].devnet}</span>}
          {standing && (
            <button type="button" className={s.toTower} aria-label={BERTH[lang].seeTower} title={BERTH[lang].seeTower} data-berth-tower="" onClick={() => seeTower(row.token)}>
              <ToTowerGlyph />
            </button>
          )}
        </div>
        <div className={s.heroFoot}>
          <div className={s.earned}>
            <span className={`${s.display} ${s.kicker}`}>{BERTH[lang].earned}</span>
            <b className={`${s.display} ${s.big}`}>{totals ? moneyText(totals.earnedRaw, row.pair, lang) : '—'}</b>
          </div>
          {days && <DayRing count={days} lang={lang} />}
        </div>
      </div>

      <Figures figures={figures} tower={tower} pair={row.pair} lang={lang} />

      <div className={s.cards}>
        {cards.map((card) => {
          const share = shared[card.id];
          return <Card key={card.id} card={card} row={row} lang={lang} making={sharing.making === card.id} onShare={share ? () => void sharing.share(card.id, share, coinLink(row.token)) : null} label={sharing.label} />;
        })}
        {sharing.saved && (
          <p className={s.notice} role="status">
            {sharing.savedLine}
          </p>
        )}
      </div>

      {details && (
        <Details row={row} review={review} receipts={cabinet.receipts.filter((receipt) => receipt.token === row.token)} moments={cards} network={network} lang={lang}>
          <Streams lang={lang}>
            {streams.map((stream) => (
              <StreamTile key={stream.id} stream={stream} row={row} lang={lang} />
            ))}
          </Streams>
        </Details>
      )}

      <ClaimDock key={`${wallet}:${row.token}`} row={row} review={review} wallet={wallet} network={network} open={open} unlisted={unlisted} details={details} onDetails={() => setDetails((v) => !v)} />
    </div>
  );
}

/**
 * The coin's own face, the moment it lands: the engine's copy of the picture on this origin, or the creator's picture the
 * city still holds from the liftoff. Its first letter stands under the picture while it loads, and alone with neither.
 */
function Face({ row, picture }: { row: LaunchCabinetRow; picture: string | null }) {
  const src = picture ?? sameOriginImage(row.image);
  if (!src) return <CoinIcon tower={{ id: row.token, icon: row.image, symbol: row.symbol }} />;
  return (
    <span className={s.face}>
      <CoinIcon tower={{ id: row.token, icon: null, symbol: row.symbol }} />
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={src} alt="" />
    </span>
  );
}

/** The tower itself: the window steps aside and the tower's own window opens, Buy and Sell in it. */
function seeTower(token: string) {
  useBerth.getState().close();
  useCity.getState().select(token);
}

const ToTowerGlyph = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="square" aria-hidden="true">
    <path d="M8 16L16 8M9 8h7v7" />
  </svg>
);

/**
 * The coin as the market reads it: its price and how far it moved since the launch, its holders, and the curve's way to
 * the pool. A figure the engine has not read is a dash, and the feed's holders stand in until its own read is here.
 */
function Figures({ figures, tower, pair, lang }: { figures: TowerFigures | null; tower: Readonly<{ holders: number | null; holdersAtLeast: boolean }> | null; pair: LaunchCabinetRow['pair']; lang: Lang }) {
  const w = BERTH[lang];
  const read = figures ? { count: figures.holders, atLeast: figures.holdersAtLeast } : tower?.holders != null ? { count: tower.holders, atLeast: tower.holdersAtLeast } : null;
  /* «At least none» says nothing: the node has not counted yet. */
  const holders = read && !(read.atLeast && read.count === 0) ? read : null;
  const progress = figures?.progressPct ?? null;
  const price = figures ? priceText(figures.price, pair, lang) : '—';
  return (
    <section className={s.figures} aria-label={w.title}>
      <div className={s.figure} data-berth-price="">
        <span className={`${s.display} ${s.figureLabel}`}>{w.price}</span>
        <b className={`${s.display} ${s.figureValue} ${price.length > 11 ? s.figureLong : ''}`}>{price}</b>
        {figures && Math.abs(figures.sinceLaunchBps) >= 100 && <span className={figures.sinceLaunchBps > 0 ? s.moveUp : s.moveDown}>{moveText(figures.sinceLaunchBps, lang)}</span>}
      </div>
      <div className={s.figure} data-berth-holders="">
        <span className={`${s.display} ${s.figureLabel}`}>{w.holders}</span>
        <b className={`${s.display} ${s.figureValue}`}>{holders ? `${holders.atLeast ? '≥' : ''}${num(holders.count)}` : '—'}</b>
      </div>
      {progress !== null && (
        <div className={s.way} role="img" aria-label={w.toExit(shareText(progress * 100, lang))}>
          <span className={s.wayBar} aria-hidden="true">
            <span style={{ width: `${Math.max(2, Math.min(100, progress))}%` }} />
          </span>
          <span className={s.wayWords}>{w.toExit(shareText(progress * 100, lang))}</span>
        </div>
      )}
    </section>
  );
}

/** The wallet's launches, when there is more than one: a tap shows another. */
function Strip({ rows, token }: { rows: readonly LaunchCabinetRow[]; token: string }) {
  const w = useWords(BERTH);
  const busy = useBerth((st) => st.busy);
  return (
    <div className={s.strip} role="tablist" aria-label={w.launches}>
      {rows.map((row) => (
        <button key={row.token} type="button" role="tab" aria-selected={row.token === token} className={`${s.chip} ${row.token === token ? s.chipOn : ''}`} disabled={busy} onClick={() => useBerth.getState().pick(row.token)}>
          <Face row={row} picture={null} />
          <span>${row.symbol}</span>
          {row.claimable && <i className={s.chipDot} aria-hidden="true" />}
        </button>
      ))}
    </div>
  );
}

/** The days the tower has stood, as a ring to day 90 with the checks of days 7, 30 and 90 on it. */
function DayRing({ count, lang }: { count: DayCount; lang: Lang }) {
  const w = BERTH[lang];
  const R = 42;
  const C = 2 * Math.PI * R;
  const label = [w.dayRing(count.days, count.next), ...count.checks.filter((check) => check.state === 'alive').map((check) => w.checkPassed(check.days))].join(' · ');
  return (
    <div className={s.ring} role="img" aria-label={label}>
      <svg viewBox="0 0 100 100" aria-hidden="true">
        <circle className={s.ringTrack} cx="50" cy="50" r={R} />
        <circle className={s.ringFill} cx="50" cy="50" r={R} strokeDasharray={`${C * count.fill} ${C}`} />
        {count.checks.map((check) => {
          const angle = check.at * 2 * Math.PI - Math.PI / 2;
          return <circle key={check.days} className={`${s.tick} ${TICK[check.state]}`} cx={50 + R * Math.cos(angle)} cy={50 + R * Math.sin(angle)} r="5" />;
        })}
      </svg>
      <span className={s.ringFigure}>
        <b className={s.display}>{digits(String(count.days || count.hours || count.minutes), lang)}</b>
        <span>{count.days ? w.days(count.days) : count.hours ? w.hours : w.minutes}</span>
      </span>
    </div>
  );
}

const TICK: Readonly<Record<DayCount['checks'][number]['state'], string>> = { alive: s.tickAlive, quiet: s.tickQuiet, young: '', unread: '' };

/** The three streams under one line: what each takes from every $1,000. */
function Streams({ lang, children }: { lang: Lang; children: ReactNode }) {
  return (
    <section className={s.streamsBlock} aria-label={BERTH[lang].per1kHead}>
      <span className={`${s.display} ${s.streamsHead}`}>{BERTH[lang].per1kHead}</span>
      <div className={s.streams}>{children}</div>
    </section>
  );
}

/** One stream: its rate by $1,000, the creator's share it is cut from, and what it earned — or when it opens. */
function StreamTile({ stream, row, lang }: { stream: Stream; row: LaunchCabinetRow; lang: Lang }) {
  const w = BERTH[lang];
  const progress = row.progressBps === null ? null : Math.floor(row.progressBps / 100);
  return (
    <RateTile stream={stream} pair={row.pair} lang={lang}>
      <span className={s.streamEarned}>
        {stream.state === 'ahead' ? (progress !== null && stream.id === 'exit' ? w.toExit(shareText(progress * 100, lang)) : w.afterExit) : stream.earnedRaw === null ? '—' : moneyText(stream.earnedRaw, row.pair, lang)}
      </span>
    </RateTile>
  );
}

/** A stream's rate by $1,000 and the share it is cut from — on its own before the wallet's figures, or over them. */
function RateTile({ stream, pair, lang, children }: { stream: Stream; pair: Readonly<{ symbol: string; decimals: number; dollar: boolean }>; lang: Lang; children?: ReactNode }) {
  const w = BERTH[lang];
  const tag = stream.shareBps === null ? null : stream.id === 'pool' ? w.forLife(shareText(stream.shareBps, lang)) : shareText(stream.shareBps, lang);
  return (
    <div className={`${s.stream} ${stream.state === 'ahead' ? s.streamAhead : ''}`} data-stream={stream.id}>
      <span className={`${s.display} ${s.streamLabel}`}>{w[stream.id satisfies keyof W]}</span>
      <b className={`${s.display} ${s.rate}`}>{stream.per1k === null ? '—' : amountText(stream.per1k, pair, lang)}</b>
      <span className={s.share}>{tag ?? ' '}</span>
      {children}
    </div>
  );
}

/**
 * «Народилась» and «Вийшла» on frames of our own city: the docks, then the skyline the tower joins. A card whose moment
 * came is one tap to share (CITY-145): the card is drawn from the same frame and the engine's figures; where it rests on
 * the chain sits behind «i».
 */
function Card({ card, row, lang, making, onShare, label }: { card: BerthCard; row: LaunchCabinetRow; lang: Lang; making: boolean; onShare: (() => void) | null; label: string }) {
  const w = BERTH[lang];
  const name = card.id === 'born' ? w.born : w.graduated;
  const body = (
    <>
      <span className={s.cardShade} />
      <span className={s.cardTop}>
        <span className={`${s.display} ${s.cardKicker}`}>{name}</span>
        {onShare && (
          <span className={s.cardShare} aria-hidden="true">
            <ShareGlyph />
          </span>
        )}
      </span>
      <span className={s.cardFoot}>
        <b className={s.display}>${row.symbol}</b>
        <span>{card.reached ? (card.at ? cardDateText(card.at, lang) : ' ') : card.pct !== null ? w.toExit(shareText(card.pct * 100, lang)) : w.notYet}</span>
      </span>
      {!card.reached && card.pct !== null && (
        <span className={s.cardBar} aria-hidden="true">
          <span style={{ width: `${Math.max(2, Math.min(100, card.pct))}%` }} />
        </span>
      )}
    </>
  );
  const style = { backgroundImage: `url(${card.id === 'born' ? DOCKS : SKYLINE})` };
  const className = `${s.card} ${card.reached ? '' : s.cardAhead} ${making ? s.cardMaking : ''}`;
  return onShare ? (
    <button type="button" className={className} style={style} onClick={making ? undefined : onShare} aria-disabled={making} aria-label={`${label} · ${name} · $${row.symbol}`} title={label} data-share-card={card.id}>
      {body}
    </button>
  ) : (
    <div className={className} style={style}>
      {body}
    </div>
  );
}

/** Behind «i»: the rates' source, what the claim takes pocket by pocket, what waits and what was taken, the receipts. */
function Details({ row, review, receipts, moments, network, lang, children }: { row: LaunchCabinetRow; review: LaunchClaimReviewResponse | null; receipts: LaunchCreatorCabinetResponse['receipts']; moments: readonly BerthCard[]; network: 'solana:devnet' | 'solana:mainnet'; lang: Lang; children: ReactNode }) {
  const w = BERTH[lang];
  const ref = useRef<HTMLDivElement>(null);
  /* Opened under the cards, just above the pinned dock: the window scrolls down to it. */
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      const pane = ref.current?.parentElement;
      const still = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
      pane?.scrollTo({ top: pane.scrollHeight, behavior: still ? 'auto' : 'smooth' });
    });
    return () => cancelAnimationFrame(frame);
  }, []);
  const presets = useLaunch((st) => st.presets);
  const preset = presets.find((entry) => entry.id === row.preset) ?? null;
  const totals = totalsOf(row);
  const share = row.earnings?.mine.shareBps ?? 10_000;
  const pockets = pocketsShown(review);
  return (
    <div ref={ref} className={s.details}>
      {children}
      {preset?.terms && <p>{w.rates(pctText(preset.sniperFee.endBps, lang), pctText(preset.terms.pool.endFeeBps, lang))}</p>}
      <p>{w.exitRate}</p>
      {share < 10_000 && <p>{w.sharedLine(shareText(share, lang))}</p>}
      {totals && (
        <dl className={s.pairs}>
          <dt>{w.waiting}</dt>
          <dd>{moneyText(totals.unclaimedRaw, row.pair, lang)}</dd>
          <dt>{w.taken}</dt>
          <dd>{moneyText(totals.claimedRaw, row.pair, lang)}</dd>
        </dl>
      )}
      {pockets.length > 0 && (
        <ul className={s.pockets}>
          {pockets.map((pocket) => (
            <li key={pocket.pocket}>
              <span>{pocketText(pocket.pocket, lang)}</span>
              <em>{pocketStateText(pocket.state, lang)}</em>
              <b>{pocket.amountRaw !== null && pocket.amountRaw !== '0' && pocket.pocket !== 'transferFee' ? moneyText(pocket.amountRaw, row.pair, lang) : ' '}</b>
            </li>
          ))}
        </ul>
      )}
      {/* Where the two cards' moments rest on the chain: the token for «Born», the move's transaction for «Graduated». */}
      <ul className={s.receipts}>
        {moments.map((moment) =>
          moment.proof ? (
            <li key={moment.id}>
              <span>{moment.id === 'born' ? w.born : w.graduated}</span>
              <b>{moment.at ? cardDateText(moment.at, lang) : ' '}</b>
              <a href={proofUrl(moment.proof, network)} target="_blank" rel="noreferrer" aria-label={w.seeOnChain}>
                ↗
              </a>
            </li>
          ) : null,
        )}
      </ul>
      {receipts.length > 0 && (
        <>
          <div className={s.detailsHead}>{w.receipts}</div>
          <ul className={s.receipts}>
            {receipts.slice(0, 3).map((receipt) => (
              <li key={receipt.signature}>
                <span>{receipt.at ? cardDateText(Date.parse(receipt.at), lang) : ' '}</span>
                <b>{moneyText(receipt.receivedRaw, receipt.pair, lang)}</b>
                <a href={proofUrl({ kind: 'tx', id: receipt.signature }, network)} target="_blank" rel="noreferrer" aria-label={w.seeOnChain}>
                  ↗
                </a>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

/* ---------------------------------------------------------------- «Забрати» */

/**
 * The pinned dock: one honest line before the signature (what reaches the wallet, the network's fee, one signature),
 * «i», and the one amber action. While the claim runs it holds the window; after it, the receipt and Solscan.
 */
function ClaimDock({ row, review, wallet, network, open, unlisted, details, onDetails }: { row: LaunchCabinetRow; review: LaunchClaimReviewResponse | null; wallet: string; network: 'solana:devnet' | 'solana:mainnet'; open: boolean; unlisted: boolean; details: boolean; onDetails: () => void }) {
  const lang = useLang();
  const w = BERTH[lang];
  const connection = useLaunch((st) => st.connection);
  const [phase, setPhase] = useState<ClaimPhase | null>(null);
  const busy = useRef(false);
  const working = phase !== null && (phase.step === 'build' || phase.step === 'sign' || phase.step === 'send');
  useEffect(() => {
    useBerth.getState().setBusy(working);
  }, [working]);
  useEffect(() => () => useBerth.getState().setBusy(false), []);

  const ready = claimReady(row, review);
  const claim = async () => {
    if (busy.current || !connection || connection.address !== wallet || !ready.can) return;
    busy.current = true;
    try {
      const loaded = await Promise.all([berthEngine(), launchWallet()]).catch(() => null);
      if (!loaded) return setPhase({ step: 'failed', failure: { code: 'UNAVAILABLE', stage: 'before', message: '' } });
      const [engine, signer] = loaded;
      const result = await runClaim({ engine, signer: signer.signer(connection), token: row.token, pairMint: row.pair.mint, network, open, onPhase: setPhase });
      /* The counters moved: the cabinet and the Review are read again at once. */
      if (result.step === 'done' || (result.step === 'failed' && result.failure.stage === 'send')) {
        await readCabinet(wallet);
        void readLaunch(row.token, wallet, { market: false, review: true });
      }
    } finally {
      busy.current = false;
    }
  };

  if (phase?.step === 'done') {
    const { done } = phase;
    const title = done.state === 'PENDING' ? w.pending : done.state === 'PARTIAL' ? w.partial : w.claimed(moneyText(done.receivedRaw, row.pair, lang));
    return (
      <div className={s.dock}>
        <div className={s.done} role="status">
          <div className={`${s.display} ${s.doneTitle}`}>
            <span className={s.check} aria-hidden="true">
              ✓
            </span>
            {title}
          </div>
          {done.signatures[0] && (
            <a className={s.doneLink} href={proofUrl({ kind: 'tx', id: done.signatures[0] }, done.network)} target="_blank" rel="noreferrer">
              {w.explorer} ↗
            </a>
          )}
        </div>
        <button type="button" className={`${s.display} ${s.secondary} ${s.wide}`} onClick={() => setPhase(null)}>
          {w.done}
        </button>
      </div>
    );
  }

  return (
    <div className={s.dock}>
      <div className={s.lineRow}>
        <span className={`${s.line} ${ready.can ? '' : s.lineQuiet}`} aria-live="polite">
          {ready.can ? (
            <>
              {w.honest(moneyText(ready.expectedRaw, row.pair, lang))}
              {ready.networkLamports && <> · {w.networkCost(sol(ready.networkLamports))}</>}
              {/* The one signature is the action's own word too; a narrow window keeps the line to one row without it. */}
              <span className={s.sig}> · {w.oneSignature}</span>
            </>
          ) : ready.why === 'moved' ? (
            w.moved
          ) : ready.why === 'unread' && !unlisted ? (
            w.unread
          ) : (
            ' '
          )}
        </span>
        <button type="button" className={`${s.info} ${details ? s.infoOn : ''}`} aria-label={details ? w.hide : w.details} aria-expanded={details} onClick={onDetails}>
          i
        </button>
      </div>
      {phase?.step === 'failed' && (
        <div className={s.problem} role="alert">
          {claimFailureText(phase.failure, connection?.wallet ?? null, lang)}
        </div>
      )}
      {working ? (
        <Working phase={phase} wallet={connection?.wallet ?? null} row={row} lang={lang} />
      ) : !open ? (
        <div className={s.closed}>{w.closed}</div>
      ) : (
        <button type="button" className={`${s.display} ${s.action}`} onClick={() => void claim()} disabled={!ready.can}>
          {ready.can ? w.claim(moneyText(ready.expectedRaw, row.pair, lang)) : w.nothingYet}
        </button>
      )}
    </div>
  );
}

function Working({ phase, wallet, row, lang }: { phase: ClaimPhase | null; wallet: string | null; row: LaunchCabinetRow; lang: Lang }) {
  const w = BERTH[lang];
  let title = w.build;
  let line = w.buildLine;
  if (phase?.step === 'sign') {
    title = w.confirmIn(phase.wallet || wallet || '');
    line = phase.again ? w.signAgain : w.signLine(amountText(unitsOf(phase.expectedRaw, row.pair.decimals), row.pair, lang));
  } else if (phase?.step === 'send') {
    title = w.sending;
    line = w.sendingLine;
  }
  return (
    <div className={s.working} role="status" aria-live="polite">
      <span className={s.spinner} aria-hidden="true" />
      <div>
        <div className={`${s.display} ${s.workingTitle}`}>{title}</div>
        <div className={s.workingLine}>{line}</div>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- the page */

/** The clock the day counter reads, a tick a minute while the window is open. */
function useMinute(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(timer);
  }, []);
  return now;
}
