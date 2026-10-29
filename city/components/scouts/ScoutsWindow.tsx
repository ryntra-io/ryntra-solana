'use client';

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { openExternal } from '@/city/lib/app-bridge/page';
import { CoinIcon } from '@/city/components/chart/CoinIcon';
import { useCity } from '@/city/lib/city/store';
import { SCOUTS_ART, scoutsSrcSet } from '@/city/lib/scouts/art';
import { useScouts } from '@/city/lib/scouts/store';
import { ago, figure, flaggedMints, linkText, screenOf, solPrice, xIntent, type ScoutRow, type ScoutsView } from '@/city/lib/scouts/view';
import { ticker } from '@/city/lib/trade/format';
import { useWallet } from '@/city/lib/trade/wallet';
import { Connect } from '../money/bits';
import { FlagGlyph, KindGlyph, XGlyph } from './glyphs';
import s from './scouts.module.css';

/** The history shows this many rows; the rest are one tap away. */
const FIRST_ROWS = 5;

const KIND_LABEL: Readonly<Record<ScoutRow['kind'], string>> = {
  CASHBACK: 'Cashback',
  REFERRAL_L1: 'Friend',
  REFERRAL_L2: "Friend's friend",
  CLAIM: 'Payout',
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

  return (
    <div className={`${s.framed} ${screen === 'ready' && view ? '' : s.gated}`} aria-label="Scouts">
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
                  {status === 'proving' ? 'Check your wallet' : 'Show my link'}
                </button>
                <p className={s.quiet}>{message ?? 'One signature. No transaction.'}</p>
              </>
            ) : screen === 'failed' ? (
              <button type="button" className={`${s.display} ${s.secondary}`} onClick={() => owner && void useScouts.getState().read(owner, true)}>
                Try again
              </button>
            ) : (
              <div className={s.bones} aria-busy="true" aria-label="Reading">
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
        <span className={`${s.display} ${s.kicker}`}>Earned</span>
        <b className={`${s.display} ${s.big}`}>{earned.usd}</b>
        {earned.sol ? <span className={s.sol}>{earned.sol}</span> : null}
        <button type="button" className={`${s.info} ${rules ? s.infoOn : ''}`} aria-label="How shares work" aria-expanded={rules} onClick={() => setRules((v) => !v)}>
          i
        </button>
      </Hero>
      {stale ? <div className={s.stale} role="status" aria-label="Not updated" /> : null}

      {rules ? <Rules view={view} sol={sol} /> : null}

      <div className={s.stats}>
        <Stat label="Friends" value={String(view.friends)} extra={view.friendsOfFriends ? `+${view.friendsOfFriends}` : null} />
        <Stat label="From friends" {...money(view.fromFriends, sol)} />
        <Stat label="Cashback" {...money(view.cashback, sol)} />
      </div>

      {view.link ? <Share link={view.link} /> : null}

      {flags.length ? (
        <section className={s.flags} aria-label="Towers your friends trade">
          <span className={s.flagMark} aria-hidden="true">
            <FlagGlyph />
          </span>
          <div className={s.flagRow}>
            {flags.map((tower) => (
              <button
                key={tower.id}
                type="button"
                className={s.flagCoin}
                aria-label={`Fly to ${ticker(tower.symbol)}`}
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
        <section className={s.history} aria-label="History">
          <ul className={s.rows}>
            {rows.map((row, i) => (
              <Row key={`${row.at}-${row.kind}-${i}`} row={row} sol={sol} />
            ))}
          </ul>
          {view.rows.length > FIRST_ROWS ? (
            <button type="button" className={s.moreToggle} aria-expanded={all} onClick={() => setAll((v) => !v)}>
              {all ? 'Less' : 'All'}
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
  return { value: f.usd, extra: f.sol };
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
    <section className={s.share} aria-label="Your link">
      <span className={s.link} translate="no">
        {linkText(link)}
      </span>
      <div className={s.shareRow}>
        <button type="button" className={`${s.display} ${s.action}`} onClick={() => void copy()}>
          {copied ? 'Copied' : 'Copy link'}
        </button>
        <button type="button" className={`${s.display} ${s.secondary} ${s.x}`} aria-label="Share on X" onClick={() => openExternal(xIntent(link))}>
          <XGlyph />
        </button>
      </div>
    </section>
  );
}

function Row({ row, sol }: { row: ScoutRow; sol: number | null }) {
  const f = figure(row.amount, sol);
  const [now] = useState(() => Date.now());
  return (
    <li className={`${s.row} ${row.out ? s.out : ''}`}>
      <span className={s.kind} aria-hidden="true">
        <KindGlyph kind={row.kind} />
      </span>
      <span className={s.what}>
        <b>{KIND_LABEL[row.kind]}</b>
        {row.coin ? <span translate="no">{coinLabel(row.coin)}</span> : null}
      </span>
      <span className={s.amount}>
        <b>{f.usd === '—' ? '—' : `${row.out ? '−' : '+'}${f.usd}`}</b>
        {f.sol ? <span>{f.sol}</span> : null}
      </span>
      <time className={s.when} dateTime={row.at}>
        {ago(row.at, now)}
      </time>
    </li>
  );
}

/** «How shares work», behind «i»: the Growth line's rules as they apply to this wallet. Payouts open later, in SOL. */
function Rules({ view, sol }: { view: ScoutsView; sol: number | null }) {
  const pending = figure(view.pending, sol);
  return (
    <dl className={s.rules}>
      <dt>Your trades</dt>
      <dd>{view.cashbackShare}% back</dd>
      {view.friendShare !== null ? (
        <>
          <dt>A friend&apos;s trade</dt>
          <dd>
            {view.friendShare}%{view.rank ? <span className={s.rank}> · {view.rank.toLowerCase()}</span> : null}
          </dd>
        </>
      ) : null}
      {view.firstDays ? (
        <>
          <dt>A friend&apos;s first {view.firstDays.days} days</dt>
          <dd>{view.firstDays.share}%</dd>
        </>
      ) : null}
      <dt>A friend&apos;s friend</dt>
      <dd>{view.secondShare}%</dd>
      {view.pending !== '0.00' ? (
        <>
          <dt>Waiting</dt>
          <dd>{pending.usd}</dd>
        </>
      ) : null}
      <dt>Paid in</dt>
      <dd>SOL · opens soon</dd>
      <dd className={s.rulesFoot}>Shares of the fee Ryntra keeps.</dd>
    </dl>
  );
}
