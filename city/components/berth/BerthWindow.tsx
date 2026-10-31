'use client';

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { LaunchCabinetRow, LaunchClaimReviewResponse, LaunchCreatorCabinetResponse } from '@/lib/api/v1/contract';
import { districtFrame } from '@/city/lib/art/frames';
import { digits, useWords } from '@/city/lib/i18n/dict';
import { useLang, type Lang } from '@/city/lib/i18n/lang';
import { cardsOf, claimReady, dayCount, pickLaunch, pocketsShown, proofUrl, streamsOf, totalsOf, unitsOf, type BerthCard, type DayCount, type Stream } from '@/city/lib/launch/berth';
import { runClaim, type ClaimPhase } from '@/city/lib/launch/berth-flow';
import { berthEngine, readCabinet, readLaunch, useBerth } from '@/city/lib/launch/berth-store';
import { amountText, cardDateText, claimFailureText, moneyText, pocketStateText, pocketText, shareText } from '@/city/lib/launch/berth-words';
import { allLaunches, launchWallet, useLaunch } from '@/city/lib/launch/district';
import { sol } from '@/city/lib/launch/format';
import { cityLaunchOpen } from '@/city/lib/launch/gate';
import { pctText } from '@/city/lib/launch/trade-words';
import type { WalletOption } from '@/city/lib/launch/wallet';
import { BERTH } from '@/city/lib/launch/words';
import { CoinIcon } from '../chart/CoinIcon';
import s from './berth.module.css';

type W = (typeof BERTH)['en'];

/** The cabinet is read again this often while the window is open; a claim reads it at once. */
const CABINET_MS = 30_000;
/** The live frames of our own city the cards stand on: the docks where a tower is born, the skyline it joins. */
const DOCKS = districtFrame('launch').files[0]!.src;
const SKYLINE = districtFrame('market').files[0]!.src;

/**
 * «Мій причал» inside the window frame: the launch's head on a frame of our own docks — what the wallet's part earned,
 * the days its tower has stood — then the three streams by $1,000, the two cards and the one amber action, «Забрати».
 * How each figure is made, what the claim takes pocket by pocket and the receipts sit behind «i».
 */
export default function BerthWindow() {
  const connection = useLaunch((st) => st.connection);
  const setConnection = useLaunch((st) => st.setConnection);
  const cabinet = useBerth((st) => (st.wallet === connection?.address ? st.cabinet : null));
  const status = useBerth((st) => (st.wallet === connection?.address ? st.status : 'idle'));
  const w = useWords(BERTH);
  const address = connection?.address ?? null;

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
    const timer = setInterval(() => document.visibilityState === 'visible' && !useBerth.getState().busy && void readCabinet(address), CABINET_MS);
    return () => clearInterval(timer);
  }, [address]);

  if (!address) return <Gate kind="connect" />;
  if (!cabinet) return status === 'failed' ? <Gate kind="failed" onAgain={() => void readCabinet(address)} /> : <Gate kind="reading" />;
  if (!cabinet.launches.length) return <Gate kind="empty" />;
  return <Berth cabinet={cabinet} wallet={address} title={w.title} />;
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

function Berth({ cabinet, wallet, title }: { cabinet: LaunchCreatorCabinetResponse; wallet: string; title: string }) {
  const lang = useLang();
  const focus = useBerth((st) => st.focus);
  const picked = useBerth((st) => st.picked);
  const token = useMemo(() => pickLaunch(cabinet.launches, picked ?? focus), [cabinet.launches, picked, focus]);
  const row = cabinet.launches.find((launch) => launch.token === token) ?? cabinet.launches[0]!;
  const presets = useLaunch((st) => st.presets);
  const network = useLaunch((st) => st.network) ?? cabinet.network;
  const stub = useLaunch((st) => st.stub);
  const open = useLaunch((st) => st.stub || cityLaunchOpen(st.network));
  const feed = useLaunch((st) => st.feed);
  const mine = useLaunch((st) => st.mine);
  const review = useBerth((st) => st.reviews[row.token] ?? null);
  const graduation = useBerth((st) => st.graduations[row.token] ?? null);
  const [details, setDetails] = useState(false);
  /* The engine's own clock when it is ahead of this one, so a fresh read never counts a day back. */
  const now = Math.max(useMinute(), Date.parse(cabinet.observedAt) || 0);

  /* The launch's own reads: its move's mark on the chain once it moved, and the claim's Review while something waits. */
  const migrated = row.migrated === true;
  const waiting = row.claimable;
  useEffect(() => {
    const known = useBerth.getState();
    const need = { graduation: migrated && !(row.token in known.graduations), review: waiting && open };
    if (need.graduation || need.review) void readLaunch(row.token, wallet, need);
  }, [row.token, wallet, migrated, waiting, open, row.earnings?.mine.unclaimedRaw]);

  const preset = presets.find((entry) => entry.id === row.preset) ?? null;
  const streams = streamsOf(row, preset);
  const totals = totalsOf(row);
  const checks = useMemo(() => allLaunches({ feed, mine }).find((launch) => launch.token === row.token)?.checks ?? null, [feed, mine, row.token]);
  const days = dayCount(row.launchedAt, now, checks);
  const cards = cardsOf(row, graduation);

  return (
    <div className={s.framed} aria-label={title}>
      {cabinet.launches.length > 1 && <Strip rows={cabinet.launches} token={row.token} />}

      <div className={`${s.hero} ${s.head}`} style={{ backgroundImage: `url(${DOCKS})` }}>
        <div className={s.heroShade} />
        <div className={s.heroTop}>
          <span className={s.coin}>
            <CoinIcon tower={{ id: row.token, icon: row.image, symbol: row.symbol }} />
          </span>
          <span className={s.coinWords}>
            <b className={s.display}>${row.symbol}</b>
            <span>{row.name}</span>
          </span>
          {(network === 'solana:devnet' || stub) && <span className={s.tag}>{stub ? BERTH[lang].stub : BERTH[lang].devnet}</span>}
        </div>
        <div className={s.heroFoot}>
          <div className={s.earned}>
            <span className={`${s.display} ${s.kicker}`}>{BERTH[lang].earned}</span>
            <b className={`${s.display} ${s.big}`}>{totals ? moneyText(totals.earnedRaw, row.pair, lang) : '—'}</b>
          </div>
          {days && <DayRing count={days} lang={lang} />}
        </div>
      </div>

      <Streams lang={lang}>
        {streams.map((stream) => (
          <StreamTile key={stream.id} stream={stream} row={row} lang={lang} />
        ))}
      </Streams>

      <div className={s.cards}>
        {cards.map((card) => (
          <Card key={card.id} card={card} row={row} network={network} lang={lang} />
        ))}
      </div>

      {details && <Details row={row} review={review} receipts={cabinet.receipts.filter((receipt) => receipt.token === row.token)} network={network} lang={lang} />}

      <ClaimDock key={`${wallet}:${row.token}`} row={row} review={review} wallet={wallet} network={network} open={open} details={details} onDetails={() => setDetails((v) => !v)} />
    </div>
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
          <CoinIcon tower={{ id: row.token, icon: row.image, symbol: row.symbol }} />
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

/** «Народилась» and «Вийшла» on frames of our own city: the docks, then the skyline the tower joins. */
function Card({ card, row, network, lang }: { card: BerthCard; row: LaunchCabinetRow; network: 'solana:devnet' | 'solana:mainnet'; lang: Lang }) {
  const w = BERTH[lang];
  const body = (
    <>
      <span className={s.cardShade} />
      <span className={`${s.display} ${s.cardKicker}`}>{card.id === 'born' ? w.born : w.graduated}</span>
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
  const className = `${s.card} ${card.reached ? '' : s.cardAhead}`;
  return card.proof ? (
    <a className={className} style={style} href={proofUrl(card.proof, network)} target="_blank" rel="noreferrer" aria-label={`${card.id === 'born' ? w.born : w.graduated} · ${w.seeOnChain}`}>
      {body}
    </a>
  ) : (
    <div className={className} style={style}>
      {body}
    </div>
  );
}

/** Behind «i»: the rates' source, what the claim takes pocket by pocket, what waits and what was taken, the receipts. */
function Details({ row, review, receipts, network, lang }: { row: LaunchCabinetRow; review: LaunchClaimReviewResponse | null; receipts: LaunchCreatorCabinetResponse['receipts']; network: 'solana:devnet' | 'solana:mainnet'; lang: Lang }) {
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
function ClaimDock({ row, review, wallet, network, open, details, onDetails }: { row: LaunchCabinetRow; review: LaunchClaimReviewResponse | null; wallet: string; network: 'solana:devnet' | 'solana:mainnet'; open: boolean; details: boolean; onDetails: () => void }) {
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
        void readLaunch(row.token, wallet, { graduation: false, review: true });
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
          ) : ready.why === 'unread' ? (
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
