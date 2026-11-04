'use client';

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { openExternal } from '@/city/lib/app-bridge/page';
import { CoinIcon } from '@/city/components/chart/CoinIcon';
import { digits, useWords, type TextKey } from '@/city/lib/i18n/dict';
import { useCity } from '@/city/lib/city/store';
import { SCOUTS_ART, scoutsSrcSet } from '@/city/lib/scouts/art';
import { openPartners } from '@/city/lib/partners/store';
import { useScouts } from '@/city/lib/scouts/store';
import { ago, figure, flaggedMints, linkText, screenOf, solPrice, xIntent, type ScoutRow, type ScoutsView } from '@/city/lib/scouts/view';
import { ticker } from '@/city/lib/trade/format';
import { useWallet } from '@/city/lib/trade/wallet';
import { Connect } from '../money/bits';
import { PARTNERS } from '../partners/words';
import { FlagGlyph, KindGlyph, XGlyph } from './glyphs';
import s from './scouts.module.css';
import { SCOUTS } from './words';

/** The history shows this many rows; the rest are one tap away. */
const FIRST_ROWS = 5;

const KIND_LABEL: Readonly<Record<ScoutRow['kind'], TextKey<typeof SCOUTS>>> = {
  CASHBACK: 'kindCashback',
  REFERRAL_L1: 'kindFriend',
  REFERRAL_L2: 'kindFriendOfFriend',
  CLAIM: 'kindPayout',
};

/** The Growth engine's ranks by name; a rank the city does not know yet reads as the engine writes it. */
const RANK_LABEL: Readonly<Record<string, TextKey<typeof SCOUTS>>> = {
  BRONZE: 'bronze',
  SILVER: 'silver',
  GOLD: 'gold',
  SAPPHIRE: 'sapphire',
  DIAMOND: 'diamond',
};

/**
 * «Scouts» inside the window frame: what you earned, your link to share, the people you brought and your share of
 * their trades, the towers they trade and the history — every figure the Growth engine's, «$ ≈ SOL». The rules are
 * behind «i». Payouts are not here: they open with the Growth line's release.
 */
export default function ScoutsWindow() {
  const connection = useWallet((st) => st.connection);
  const owner = connection?.address ?? null;
  const status = useScouts((st) => (st.owner === owner ? st.status : 'none'));
  const view = useScouts((st) => (st.owner === owner ? st.view : null));
  const message = useScouts((st) => st.message);
  const screen = screenOf(owner, status, view);
  const w = useWords(SCOUTS);

  return (
    <div className={`${s.framed} ${screen === 'ready' && view ? '' : s.gated}`} aria-label={w.scouts}>
      {screen === 'ready' && view ? (
        <Ready view={view} stale={status === 'failed'} />
      ) : (
        <>
          <Hero />
          <div className={s.gate}>
            {screen === 'connect' ? (
              <Connect />
            ) : screen === 'prove' ? (
              <>
                <button
                  type="button"
                  className={`${s.display} ${s.action}`}
                  disabled={status === 'proving'}
                  onClick={() => connection && void useScouts.getState().prove(connection)}
                >
                  {status === 'proving' ? w.checkWallet : w.showLink}
                </button>
                <p className={s.quiet}>{message ?? w.oneSignature}</p>
              </>
            ) : screen === 'failed' ? (
              <button type="button" className={`${s.display} ${s.secondary}`} onClick={() => owner && void useScouts.getState().read(owner, true)}>
                {w.tryAgain}
              </button>
            ) : (
              <div className={s.bones} aria-busy="true" aria-label={w.reading}>
                <span />
                <span />
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

/** The frame at the head of the window: a still of our own city at night, fading into the glass. */
function Hero({ children }: { children?: ReactNode }) {
  return (
    <div className={s.hero}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img className={s.art} src={SCOUTS_ART.small} srcSet={scoutsSrcSet} sizes="(min-width: 900px) 480px, 100vw" alt="" decoding="async" />
      <div className={s.heroBody}>{children}</div>
    </div>
  );
}

function Ready({ view, stale }: { view: ScoutsView; stale: boolean }) {
  const w = useWords(SCOUTS);
  const towers = useCity((st) => st.snapshot.towers);
  const sol = useMemo(() => solPrice(towers), [towers]);
  const flags = useMemo(() => {
    const byId = new Map(towers.map((tower) => [tower.id, tower]));
    return flaggedMints(view.rows, towers).map((mint) => byId.get(mint)!);
  }, [view.rows, towers]);
  const [rules, setRules] = useState(false);
  const [all, setAll] = useState(false);
  const earned = figure(view.earned, sol);
  const rows = all ? view.rows : view.rows.slice(0, FIRST_ROWS);

  return (
    <>
      <Hero>
        <span className={`${s.display} ${s.kicker}`}>{w.earned}</span>
        <b className={`${s.display} ${s.big}`}>{digits(earned.usd)}</b>
        {earned.sol ? <span className={s.sol}>{digits(earned.sol)}</span> : null}
        <button type="button" className={`${s.info} ${rules ? s.infoOn : ''}`} aria-label={w.howShares} aria-expanded={rules} onClick={() => setRules((v) => !v)}>
          i
        </button>
      </Hero>
      {stale ? <div className={s.stale} role="status" aria-label={w.notUpdated} /> : null}

      {rules ? <Rules view={view} sol={sol} /> : null}

      <div className={s.stats}>
        <Stat label={w.friends} value={digits(String(view.friends))} extra={view.friendsOfFriends ? digits(`+${view.friendsOfFriends}`) : null} />
        <Stat label={w.fromFriends} {...money(view.fromFriends, sol)} />
        <Stat label={w.cashback} {...money(view.cashback, sol)} />
      </div>

      {view.link ? <Share link={view.link} /> : null}

      {flags.length ? (
        <section className={s.flags} aria-label={w.towersFriends}>
          <span className={s.flagMark} aria-hidden="true">
            <FlagGlyph />
          </span>
          <div className={s.flagRow}>
            {flags.map((tower) => (
              <button
                key={tower.id}
                type="button"
                className={s.flagCoin}
                aria-label={w.flyTo(ticker(tower.symbol))}
                onClick={() => {
                  useScouts.getState().close();
                  useCity.getState().select(tower.id);
                }}
              >
                <CoinIcon tower={tower} />
                <span>{ticker(tower.symbol)}</span>
              </button>
            ))}
          </div>
        </section>
      ) : null}

      {view.rows.length ? (
        <section className={s.history} aria-label={w.history}>
          <ul className={s.rows}>
            {rows.map((row, i) => (
              <Row key={`${row.at}-${row.kind}-${i}`} row={row} sol={sol} />
            ))}
          </ul>
          {view.rows.length > FIRST_ROWS ? (
            <button type="button" className={s.moreToggle} aria-expanded={all} onClick={() => setAll((v) => !v)}>
              {all ? w.less : w.all}
              <span className={s.chevron} data-open={all ? '' : undefined} aria-hidden="true" />
            </button>
          ) : null}
        </section>
      ) : null}
    </>
  );
}

/** SOL and the dollar coins by their names, every other coin as its ticker. */
const coinLabel = (coin: string) => (/^(SOL|WSOL|USDC|USDT)$/i.test(coin) ? coin.toUpperCase() : ticker(coin));

const money = (text: string, sol: number | null) => {
  const f = figure(text, sol);
  return { value: digits(f.usd), extra: f.sol ? digits(f.sol) : null };
};

function Stat({ label, value, extra }: { label: string; value: string; extra: string | null }) {
  return (
    <div className={s.stat}>
      <span className={s.statLabel}>{label}</span>
      <b className={`${s.display} ${s.statValue}`}>{value}</b>
      <span className={s.statExtra}>{extra ?? ' '}</span>
    </div>
  );
}

/** Your link: copied whole with one tap, or posted on X. The one action of the window. */
function Share({ link }: { link: string }) {
  const w = useWords(SCOUTS);
  const [copied, setCopied] = useState(false);
  useEffect(() => setCopied(false), [link]);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2_000);
    } catch {
      // The link is on screen whole either way.
    }
  };
  return (
    <section className={s.share} aria-label={w.yourLink}>
      <span className={s.link} translate="no">
        {linkText(link)}
      </span>
      <div className={s.shareRow}>
        <button type="button" className={`${s.display} ${s.action}`} onClick={() => void copy()}>
          {copied ? w.copied : w.copyLink}
        </button>
        <button type="button" className={`${s.display} ${s.secondary} ${s.x}`} aria-label={w.shareOnX} onClick={() => openExternal(xIntent(link))}>
          <XGlyph />
        </button>
      </div>
    </section>
  );
}

function Row({ row, sol }: { row: ScoutRow; sol: number | null }) {
  // Reading the words repaints the row, its age with it, when the language changes.
  const w = useWords(SCOUTS);
  const f = figure(row.amount, sol);
  const [now] = useState(() => Date.now());
  return (
    <li className={`${s.row} ${row.out ? s.out : ''}`}>
      <span className={s.kind} aria-hidden="true">
        <KindGlyph kind={row.kind} />
      </span>
      <span className={s.what}>
        <b>{w[KIND_LABEL[row.kind]]}</b>
        {row.coin ? <span translate="no">{coinLabel(row.coin)}</span> : null}
      </span>
      <span className={s.amount}>
        <b>{f.usd === '—' ? '—' : digits(`${row.out ? '−' : '+'}${f.usd}`)}</b>
        {f.sol ? <span>{digits(f.sol)}</span> : null}
      </span>
      <time className={s.when} dateTime={row.at}>
        {ago(row.at, now)}
      </time>
    </li>
  );
}

/** «How shares work», behind «i»: the Growth line's rules as they apply to this wallet. Payouts open later, in SOL. */
function Rules({ view, sol }: { view: ScoutsView; sol: number | null }) {
  const w = useWords(SCOUTS);
  const partners = useWords(PARTNERS).kicker;
  const pending = figure(view.pending, sol);
  const rankKey = view.rank ? RANK_LABEL[view.rank.toUpperCase()] : undefined;
  const rank = view.rank ? (rankKey ? w[rankKey] : view.rank.toLowerCase()) : null;
  return (
    <dl className={s.rules}>
      <dt>{w.yourTrades}</dt>
      <dd>{w.back(digits(String(view.cashbackShare)))}</dd>
      {view.friendShare !== null ? (
        <>
          <dt>{w.friendTrade}</dt>
          <dd>
            {digits(`${view.friendShare}%`)}
            {rank ? <span className={s.rank}> · {rank}</span> : null}
          </dd>
        </>
      ) : null}
      {view.firstDays ? (
        <>
          <dt>{w.friendFirstDays(view.firstDays.days)}</dt>
          <dd>{digits(`${view.firstDays.share}%`)}</dd>
        </>
      ) : null}
      <dt>{w.friendOfFriend}</dt>
      <dd>{digits(`${view.secondShare}%`)}</dd>
      {view.pending !== '0.00' ? (
        <>
          <dt>{w.waiting}</dt>
          <dd>{digits(pending.usd)}</dd>
        </>
      ) : null}
      <dt>{w.paidIn}</dt>
      <dd>{w.paidInSoon}</dd>
      <dd className={s.rulesFoot}>{w.rulesFoot}</dd>
      {/* The partner programme (CITY-126): the whole offer and «Мій район», one tap away. */}
      <dd className={s.rulesFoot}>
        <button
          type="button"
          className={s.moreToggle}
          onClick={() => {
            useScouts.getState().close();
            openPartners();
          }}
        >
          {partners}
          <span className={s.chevron} aria-hidden="true" style={{ transform: 'rotate(-45deg)' }} />
        </button>
      </dd>
    </dl>
  );
}
