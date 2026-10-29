'use client';

import { useEffect, useMemo, useState } from 'react';
import { depositTiles, spendable, splitDeposit } from '@/city/lib/districts/harbor/deposit';
import { defaultRange, feeShare, percent, rangeText, riskWords, usd, VENUE_NAME, type HarborPool } from '@/city/lib/districts/harbor/pools';
import { rangeLine, towerMintOf, type HarborPosition } from '@/city/lib/districts/harbor/positions';
import { reviewFigures } from '@/city/lib/districts/harbor/review';
import { BUSY, keyOf, LOCKED, ownHoldings, useHarbor, type Connection, type Notice, type Target } from '@/city/lib/districts/harbor/store';
import { useCity } from '@/city/lib/city/store';
import { colourOf } from '@/city/lib/trade/colour';
import { formatUnits, shortAddress } from '@/city/lib/trade/format';
import { useWallet } from '@/city/lib/trade/wallet';
import { explorerTxUrl } from '@/lib/solana/explorer';
import { isPhoneUserAgent, PHANTOM_DOWNLOAD_URL, phantomBrowseUrl } from '@/lib/solana/open-in-wallet';
import { CloseGlyph } from '../hud/glyphs';
import s from './harbor.module.css';

/**
 * The Harbor: the pools of Solana with the engine's figures, one plain card to add to a pool, and your positions with
 * what they earned. The person signs every action in their own wallet; the engine builds and checks it. No game
 * motion inside: the city lights your tower outside the card.
 */
export function HarborSheet() {
  const view = useHarbor((st) => st.view);
  const pool = useHarbor((st) => st.pool);
  const phase = useHarbor((st) => st.phase);
  const hide = useHarbor((st) => st.hide);
  const setView = useHarbor((st) => st.setView);
  const positions = useHarbor((st) => st.positions);
  // Only a signature or a send holds the sheet; a Review being built never does.
  const locked = LOCKED.has(phase);
  const count = positions.status === 'ready' ? positions.positions.length : 0;
  const outcome = useHarbor((st) => st.outcome);
  // An outcome stays on screen until the person moves on, also while the chain is asked about it again.
  const finished = outcome !== null;
  const adding = view === 'add' && pool;
  return (
    <div className={s.sheet} role="dialog" aria-label="Harbor">
      <div className={s.head}>
        {adding && !finished ? (
          <button className={s.iconButton} aria-label="Back to pools" onClick={() => setView('pools')} disabled={locked}>
            ←
          </button>
        ) : null}
        <div className={s.title}>
          <div className={`${s.display} ${s.name}`}>{adding ? pool.pair : 'Harbor'}</div>
          <div className={s.sub}>{adding ? `Meteora ${VENUE_NAME[pool.kind]} · no Ryntra fee` : 'Earn a share of a pool’s trading fees.'}</div>
        </div>
        <button className={s.iconButton} aria-label="Close" onClick={hide} disabled={locked}>
          <CloseGlyph />
        </button>
      </div>
      {finished ? (
        <Outcome />
      ) : adding ? (
        <AddCard pool={pool} />
      ) : (
        <>
          <div className={s.tabs} role="tablist" aria-label="Pools or your positions">
            {(['pools', 'mine'] as const).map((id) => (
              <button key={id} role="tab" aria-selected={view === id} className={`${s.tab} ${view === id ? s.tabOn : ''}`} onClick={() => setView(id)} disabled={locked}>
                {id === 'pools' ? 'Pools' : `Mine${count ? ` · ${count}` : ''}`}
              </button>
            ))}
          </div>
          {view === 'mine' ? <Mine /> : <Pools />}
        </>
      )}
    </div>
  );
}

function Pools() {
  const list = useHarbor((st) => st.list);
  const choose = useHarbor((st) => st.choose);
  const loadPools = useHarbor((st) => st.loadPools);
  const holdings = useWallet((st) => ownHoldings(st.connection, st.holdings));
  if (list.status === 'error') {
    return (
      <>
        <div className={s.empty}>{list.message}</div>
        <div className={s.grow} />
        <button className={`${s.display} ${s.action}`} onClick={() => void loadPools()}>
          Try again
        </button>
      </>
    );
  }
  if (list.status !== 'ready') {
    return (
      <div className={s.list} aria-label="Loading pools">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className={s.row}>
            <span className={s.shimmer} />
          </div>
        ))}
      </div>
    );
  }
  if (!list.pools.length) return <div className={s.empty}>No pool deep enough to list right now.</div>;
  return (
    <>
      <div className={s.list}>
        {list.pools.map((pool) => (
          <button key={pool.address} className={s.row} onClick={() => choose(pool, holdings)}>
            <span className={`${s.display} ${s.pairName}`}>
              {pool.pair}
              <span className={s.tag}>{VENUE_NAME[pool.kind]}</span>
            </span>
            <span className={s.rowFigure}>
              {usd(pool.lpFees24hUsd)}
              <small>Fees 24H</small>
            </span>
            <span className={s.rowLine}>
              Liquidity <b>{usd(pool.tvlUsd)}</b> · volume 24H <b>{usd(pool.volume24hUsd)}</b> · {rangeText(pool, defaultRange(pool))}
            </span>
          </button>
        ))}
      </div>
      <div className={s.notice}>Meteora&apos;s figures{list.at ? `, read ${clock(Date.parse(list.at))}` : ''}. A day&apos;s fees are no promise of the next.</div>
    </>
  );
}

function AddCard({ pool }: { pool: HarborPool }) {
  const tile = useHarbor((st) => st.tile);
  const setTile = useHarbor((st) => st.setTile);
  const phase = useHarbor((st) => st.phase);
  const reviewed = useHarbor((st) => st.reviewed);
  const notice = useHarbor((st) => st.notice);
  const statesFor = useHarbor((st) => st.states);
  const connection = useWallet((st) => st.connection);
  const holdings = useWallet((st) => ownHoldings(st.connection, st.holdings));
  const states = connection && statesFor?.owner === connection.address ? statesFor.value : null;
  const ceiling = states?.maxDepositUsd ?? null;
  const tiles = useMemo(() => depositTiles(pool, holdings, ceiling), [pool, holdings, ceiling]);
  const range = useMemo(() => defaultRange(pool), [pool]);
  const chosen = tiles[tile] ?? tiles[0]!;
  const key = connection ? keyOf(connection.address, { kind: 'add' }, pool, tile) : null;
  const shown = reviewed && reviewed.key === key ? reviewed : null;
  const figures = shown ? reviewFigures(shown.review, { x: pool.x.symbol, y: pool.y.symbol }, pool) : null;
  const putIn = figures ? figures.amounts.join(' + ') : chosen.split ? `${chosen.split.xShown} ${pool.x.symbol} + ${chosen.split.yShown} ${pool.y.symbol}` : null;
  const share = feeShare(pool, figures?.valueUsd ?? chosen.usd);
  const hx = spendable(holdings, pool.x.mint);
  const hy = spendable(holdings, pool.y.mint);
  const balance = holdings && hx !== null && hy !== null ? `You have ${formatUnits(hx.toString(), pool.x.decimals, 'down')} ${pool.x.symbol} · ${formatUnits(hy.toString(), pool.y.decimals, 'down')} ${pool.y.symbol}` : null;
  const unpriced = !splitDeposit(pool, 1);
  return (
    <>
      <div className={s.block}>
        <div className={s.label}>Range</div>
        <div className={s.value}>{rangeText(pool, range)}</div>
        <div className={`${s.line} ${s.risk}`}>{riskWords(pool, range)}</div>
      </div>
      <div className={s.block}>
        <div className={s.labelRow}>
          <span className={s.label}>You put in</span>
          {balance && <span className={s.balance}>{balance}</span>}
        </div>
        <div className={s.tiles} role="radiogroup" aria-label="Amount">
          {tiles.map((t, index) => (
            <button
              key={t.usd}
              role="radio"
              aria-checked={index === tile}
              className={`${s.tile} ${index === tile ? s.tileOn : ''}`}
              onClick={() => setTile(index)}
              disabled={BUSY.has(phase) || !t.split || t.overCeiling || (!t.fits && index !== tile)}
            >
              <span className={`${s.display} ${s.tileFigure}`}>${t.usd}</span>
            </button>
          ))}
        </div>
        {putIn ? <div className={s.value}>{figures ? putIn : `≈ ${putIn}`}</div> : <div className={s.line}>This pool has no dollar price now.</div>}
      </div>
      <div className={s.block}>
        <div className={s.label}>You get</div>
        {share ? (
          <div className={s.line}>
            <b>{percent(share.sharePct)}</b> of the pool&apos;s fees while in range. Yesterday that share earned <b>≈ {usd(share.dayUsd)}</b>.
          </div>
        ) : (
          <div className={s.line}>A share of the pool&apos;s fees while the price is in your range.</div>
        )}
      </div>
      {figures ? (
        <div className={s.line} style={{ marginTop: 10 }}>
          Network <b>{figures.networkSol} SOL</b>
          {figures.rentSol ? (
            <>
              {' · new accounts '}
              <b>{figures.rentSol} SOL</b>
              {figures.rentBack ? ', back on exit' : ''}
            </>
          ) : null}
          {figures.transactions > 1 ? ` · ${figures.transactions} signatures` : ''}
        </div>
      ) : phase === 'reviewing' ? (
        <span className={s.shimmer} aria-label="The engine is building the exact figures" />
      ) : null}
      <Note notice={notice ?? (figures?.note ? { tone: 'warn', text: figures.note } : null)} />
      <div className={s.grow} />
      <Action
        target={{ kind: 'add' }}
        verb="Add liquidity"
        ready={Boolean(shown)}
        blocked={unpriced ? 'No price now' : !chosen.split ? 'No price now' : !chosen.fits ? `Not enough ${chosen.short}` : states && states.add.status !== 'on' ? 'Opens after a live check' : null}
      />
      <WalletLine />
    </>
  );
}

function Mine() {
  const positions = useHarbor((st) => st.positions);
  const target = useHarbor((st) => st.target);
  const reviewed = useHarbor((st) => st.reviewed);
  const notice = useHarbor((st) => st.notice);
  const phase = useHarbor((st) => st.phase);
  const prepare = useHarbor((st) => st.prepare);
  const statesFor = useHarbor((st) => st.states);
  const connection = useWallet((st) => st.connection);
  const holdings = useWallet((st) => ownHoldings(st.connection, st.holdings));
  if (!connection) {
    return (
      <>
        <div className={s.empty}>Connect your wallet to see your pool positions and what they earned.</div>
        <div className={s.grow} />
        <Action target={null} verb="" ready={false} blocked={null} />
      </>
    );
  }
  if (positions.status !== 'ready' || positions.owner !== connection.address) {
    return positions.status === 'error' ? <div className={s.empty}>{positions.message}</div> : <span className={s.shimmer} aria-label="Reading your positions" />;
  }
  if (!positions.positions.length) return <div className={s.empty}>No pool positions in this wallet yet. Pick a pool and add to it.</div>;
  const states = statesFor?.owner === connection.address ? statesFor.value : null;
  const acting = target && target.kind !== 'add' ? target : null;
  const shown = acting && reviewed && reviewed.key === keyOf(connection.address, acting, null, 0) ? reviewed : null;
  return (
    <>
      <div className={s.list}>
        {positions.positions.map((p) => {
          const mine = acting?.position.address === p.address;
          return (
            <div key={p.address} className={s.row} style={mine ? { boxShadow: 'inset 0 0 0 2px rgba(153, 69, 255, 0.5)' } : undefined}>
              <span className={`${s.display} ${s.pairName}`}>
                {p.pair}
                <span className={s.tag}>{p.venueName}</span>
              </span>
              <span className={`${s.rowFigure} ${s.in}`}>
                {usd(p.earnedUsd)}
                <small>Earned</small>
              </span>
              <span className={s.rowLine}>
                <span className={p.inRange ? s.in : s.out}>{rangeLine(p)}</span> · holds <b>{usd(p.valueUsd)}</b>
                {p.earned ? ` · ${p.earned}` : ''}
              </span>
              <span className={s.rowActions}>
                <PositionButton label="Take fees" position={p} kind="claim" on={mine && acting?.kind === 'claim'} disabled={BUSY.has(phase) || !p.earned || p.feesElsewhere || states?.claim.status !== 'on'} onPrepare={() => void prepare(connection, { kind: 'claim', position: p }, holdings)} />
                <PositionButton label="Exit" position={p} kind="exit" on={mine && acting?.kind === 'exit'} disabled={BUSY.has(phase) || states?.remove.status !== 'on'} onPrepare={() => void prepare(connection, { kind: 'exit', position: p }, holdings)} />
              </span>
            </div>
          );
        })}
      </div>
      {states && states.claim.status !== 'on' && <div className={s.notice}>Taking fees and exiting open after a live check.</div>}
      {acting && shown && <PositionReview target={acting} />}
      {acting && !shown && phase === 'reviewing' && <span className={s.shimmer} aria-label="The engine is building the exact figures" />}
      <Note notice={notice} />
      <div className={s.grow} />
      {acting && <Action target={acting} verb={acting.kind === 'claim' ? 'Take fees' : 'Exit position'} ready={Boolean(shown)} blocked={null} />}
      <WalletLine />
    </>
  );
}

function PositionButton({ label, on, disabled, onPrepare }: { label: string; position: HarborPosition; kind: 'claim' | 'exit'; on: boolean; disabled: boolean; onPrepare: () => void }) {
  return (
    <button className={`${s.small} ${on ? s.smallOn : ''}`} onClick={onPrepare} disabled={disabled} aria-pressed={on}>
      {label}
    </button>
  );
}

function PositionReview({ target }: { target: Exclude<Target, { kind: 'add' }> }) {
  const reviewed = useHarbor((st) => st.reviewed);
  if (!reviewed) return null;
  const f = reviewFigures(reviewed.review, target.position.symbols, null);
  return (
    <div className={s.block}>
      <div className={s.label}>{target.kind === 'claim' ? 'You take' : 'You get back'}</div>
      <div className={s.value}>{f.amounts.join(' + ') || 'Nothing to take now'}</div>
      <div className={s.line}>
        Network <b>{f.networkSol} SOL</b>
        {f.rentReturnedSol ? (
          <>
            {' · rent back '}
            <b>{f.rentReturnedSol} SOL</b>
          </>
        ) : null}
        {target.kind === 'exit' ? ' · the position closes' : ' · the position stays'}
      </div>
      {f.note && <div className={`${s.notice} ${s.noticeWarn}`}>{f.note}</div>}
    </div>
  );
}

function Note({ notice }: { notice: Notice | null }) {
  if (!notice) return null;
  return (
    <div className={`${s.notice} ${notice.tone === 'warn' ? s.noticeWarn : s.noticeError}`} role={notice.tone === 'error' ? 'alert' : 'status'}>
      {notice.text}
    </div>
  );
}

/** The one amber action: connect, sign what the Review shows, or say plainly why not. */
function Action({ target, verb, ready, blocked }: { target: Target | null; verb: string; ready: boolean; blocked: string | null }) {
  const phase = useHarbor((st) => st.phase);
  const confirm = useHarbor((st) => st.confirm);
  const prepare = useHarbor((st) => st.prepare);
  const connection = useWallet((st) => st.connection);
  const connecting = useWallet((st) => st.connecting);
  const holdings = useWallet((st) => ownHoldings(st.connection, st.holdings));
  const [picking, setPicking] = useState(false);
  useEffect(() => {
    if (connection) setPicking(false);
  }, [connection]);
  if (!connection && picking) return <WalletPicker onBack={() => setPicking(false)} />;
  let label = verb;
  let disabled = false;
  let waiting = false;
  if (phase === 'reviewing') [label, disabled, waiting] = ['Getting exact figures…', true, true];
  else if (phase === 'wallet') [label, disabled, waiting] = [`Confirm in ${connection?.wallet ?? 'your wallet'}`, true, true];
  else if (phase === 'sending') [label, disabled, waiting] = ['Reading the network…', true, true];
  else if (connecting) [label, disabled, waiting] = ['Connecting…', true, true];
  else if (!connection) label = 'Connect wallet';
  else if (blocked) [label, disabled] = [blocked, true];
  const press = () => {
    if (!connection) {
      const { wallets, connect } = useWallet.getState();
      if (wallets.length === 1) void connect(wallets[0]!.name);
      else setPicking(true);
      return;
    }
    if (!target) return;
    if (ready) void confirm(connection as Connection, holdings);
    else void prepare(connection as Connection, target, holdings);
  };
  if (connection && !target) return null;
  return (
    <button className={`${s.display} ${s.action} ${waiting ? s.waiting : ''}`} onClick={press} disabled={disabled}>
      {label}
    </button>
  );
}

function WalletPicker({ onBack }: { onBack: () => void }) {
  const wallets = useWallet((st) => st.wallets);
  const connecting = useWallet((st) => st.connecting);
  const error = useWallet((st) => st.error);
  const connect = useWallet((st) => st.connect);
  const [phone, setPhone] = useState(false);
  useEffect(() => setPhone(isPhoneUserAgent(navigator.userAgent)), []);
  if (!wallets.length) {
    const here = typeof window === 'undefined' ? '' : window.location.href;
    const origin = typeof window === 'undefined' ? '' : window.location.origin;
    return (
      <>
        <div className={s.notice}>{phone ? 'This browser has no Solana wallet. Open Ryntra inside your wallet app.' : 'No Solana wallet in this browser. Add one, then come back.'}</div>
        <a className={`${s.display} ${s.action}`} href={phone ? phantomBrowseUrl(here, origin) : PHANTOM_DOWNLOAD_URL} target={phone ? undefined : '_blank'} rel="noreferrer">
          {phone ? 'Open in Phantom' : 'Get Phantom'}
        </a>
        <button className={s.quiet} onClick={onBack}>
          Back
        </button>
      </>
    );
  }
  return (
    <>
      <div className={s.wallets}>
        {wallets.map((wallet) => (
          <button key={wallet.name} className={s.walletButton} onClick={() => void connect(wallet.name)} disabled={Boolean(connecting)}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            {wallet.icon ? <img src={wallet.icon} alt="" /> : null}
            {connecting === wallet.name ? `Opening ${wallet.name}…` : wallet.name}
          </button>
        ))}
      </div>
      {error && <div className={`${s.notice} ${s.noticeError}`}>{error}</div>}
      <button className={s.quiet} onClick={onBack}>
        Back
      </button>
    </>
  );
}

function WalletLine() {
  const connection = useWallet((st) => st.connection);
  const disconnect = useWallet((st) => st.disconnect);
  const phase = useHarbor((st) => st.phase);
  if (!connection) return null;
  return (
    <div className={s.walletLine} style={{ ['--player' as string]: colourOf(connection.address) }}>
      <span className={s.dot} aria-hidden="true" />
      <span className={s.address}>{shortAddress(connection.address)}</span>
      <span>· {connection.wallet}</span>
      <button className={s.link} onClick={disconnect} disabled={BUSY.has(phase)}>
        Disconnect
      </button>
    </div>
  );
}

const DONE: Readonly<Record<string, Readonly<{ kicker: string; line: string }>>> = {
  add: { kicker: 'In the pool', line: 'Your tower glows in your colour while the position is open.' },
  claim: { kicker: 'Fees taken', line: 'The fees are in your wallet. The position keeps earning.' },
  exit: { kicker: 'Out of the pool', line: 'Your coins and fees are back in your wallet.' },
};

function Outcome() {
  const outcome = useHarbor((st) => st.outcome);
  const target = useHarbor((st) => st.target);
  const pool = useHarbor((st) => st.pool);
  const again = useHarbor((st) => st.again);
  const seePositions = useHarbor((st) => st.seePositions);
  const hide = useHarbor((st) => st.hide);
  const recheck = useHarbor((st) => st.recheck);
  const phase = useHarbor((st) => st.phase);
  const sent = useHarbor((st) => st.sent);
  const connection = useWallet((st) => st.connection);
  if (!outcome) return null;
  const what = target?.kind ?? 'add';
  const symbols = target && target.kind !== 'add' ? target.position.symbols : pool ? { x: pool.x.symbol, y: pool.y.symbol } : null;
  const amounts = sent && symbols ? reviewFigures(sent.review, symbols, null).amounts.join(' + ') : '';
  // An add's Review states what goes in at most: the pool may take a little less.
  const moved = amounts && what === 'add' ? `Up to ${amounts}` : amounts;
  const name = (outcome.kind === 'done' && moved) || (target && target.kind !== 'add' ? target.position.pair : (pool?.pair ?? ''));
  const signature = outcome.kind === 'failed' ? outcome.signature : 'signatures' in outcome ? (outcome.signatures.at(-1) ?? null) : null;
  let kicker = DONE[what]!.kicker;
  let line = DONE[what]!.line;
  let tone = '';
  // A partly landed add has already opened a position: it is seen in your positions, never built a second time.
  const partialAdd = outcome.kind === 'partial' && what === 'add';
  if (partialAdd) [kicker, line, tone] = ['Partly done', 'Part of it landed and the rest did not. What landed stays; see it in your positions.', s.kickerWarn];
  else if (outcome.kind === 'partial') [kicker, line, tone] = ['Partly done', 'Part of it landed and the rest did not. What landed stays; try the rest again.', s.kickerWarn];
  else if (outcome.kind === 'failed') [kicker, line, tone] = ['Didn’t go through', 'It reached the chain and failed. Only the network fee was spent.', s.kickerDanger];
  else if (outcome.kind === 'unknown') [kicker, line, tone] = ['Still checking', 'The network has not said yet. Do not send it again; check in a moment.', s.kickerWarn];
  return (
    <>
      <div className={`${s.kicker} ${tone}`}>{kicker}</div>
      <div className={`${s.display} ${s.result}`}>{name}</div>
      <div className={s.line}>{line}</div>
      {signature && (
        <a className={s.explorer} href={explorerTxUrl('mainnet', signature)} target="_blank" rel="noreferrer">
          View transaction ↗
        </a>
      )}
      <div className={s.grow} />
      {outcome.kind === 'unknown' ? (
        <button className={`${s.display} ${s.action} ${phase === 'sending' ? s.waiting : ''}`} onClick={() => connection && void recheck(connection.address)} disabled={phase === 'sending'}>
          Check again
        </button>
      ) : partialAdd ? (
        <button className={`${s.display} ${s.action}`} onClick={() => seePositions(connection?.address ?? null)}>
          See my positions
        </button>
      ) : (
        <button className={`${s.display} ${s.action}`} onClick={outcome.kind === 'done' && what === 'add' ? () => seeTower(pool, hide) : again}>
          {outcome.kind !== 'done' ? 'Try again' : what === 'add' ? 'Back to the city' : 'Back to my positions'}
        </button>
      )}
      <WalletLine />
    </>
  );
}

/** Back to the city, at the tower the new position lights. */
function seeTower(pool: HarborPool | null, hide: () => void) {
  hide();
  if (!pool) return;
  const mint = towerMintOf(pool);
  const city = useCity.getState();
  if (city.layout.towers.some((t) => t.tower.id === mint)) city.select(mint);
}

function clock(at: number): string {
  return Number.isFinite(at) ? new Date(at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : '';
}
