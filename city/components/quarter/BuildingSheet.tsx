'use client';

import { useEffect } from 'react';
import type { Tower } from '@/city/lib/market/types';
import { KIND_NAMES } from '@/city/lib/quarter/kit';
import { OBJECT_NAMES, freshness, linkKey, linkKindOf, type Candidate, type ObjectAction, type ObjectView } from '@/city/lib/quarter/objects';
import { siteStore, useSite, type Picking } from '@/city/lib/quarter/site';
import { quarterStore } from '@/city/lib/quarter/store';
import type { Building, BuildingKind, LinkKind } from '@/city/lib/quarter/types';
import { useTrade } from '@/city/lib/trade/store';
import { useWallet } from '@/city/lib/trade/wallet';
import { CloseGlyph } from '../hud/glyphs';
import s from '../hud/hud.module.css';
import { RING_OPEN, RingGarage } from '../ring/RingGarage';
import { readLine, useNow } from './BuildingTag';
import q from './quarter.module.css';

/** The trade card stays a switch, as on a tower: `closed` sends a coin's action to its Launch page instead. */
const TRADE_OPEN = process.env.NEXT_PUBLIC_RYNTRA_CITY_TRADE !== 'closed';

/** Where a person gets an object of each kind, for a building whose owner has none yet. */
const GET_ONE: Record<LinkKind, { label: string; href: string } | null> = {
  mint: { label: 'Launch a coin', href: '/app/launch/new' },
  lp_position: { label: 'Find a pool', href: '/app/markets/pools' },
  strategy: { label: 'Open Strategy Lab', href: '/app/strategy-lab' },
  team: { label: 'Make a team', href: '/app/treasury/team' },
  prediction_book: { label: 'Open Predictions', href: '/app/predictions' },
  agent: null,
};

/** What a building of each kind can show, said the way the engine checks it. */
const WHAT: Record<LinkKind, string> = {
  mint: 'a coin you launched',
  lp_position: 'a pool position your wallet holds',
  strategy: 'a strategy of yours',
  team: 'a team you are in',
  prediction_book: 'your paper predictions',
  agent: 'your agent',
};

/**
 * A plot's sheet for a building on the engine: the object it shows, read from the engine now, each figure with its
 * source and age and one action into the engine's own card; with nothing linked, an honest empty state and the way to
 * link one. The city never counts money: every number here is a read, and a read that did not answer says so.
 */
export function BuildingSheet({ building }: { building: Building }) {
  const picking = useSite((st) => st.picking);
  // Linking belongs to its plot: another plot, or closing, ends it.
  useEffect(() => () => siteStore.getState().cancel(), []);
  const close = () => {
    siteStore.getState().cancel();
    quarterStore.getState().pick(null);
  };
  const name = KIND_NAMES[building.kind];
  return (
    <div className={`${s.panel} ${q.sheet}`} role="dialog" aria-label={`${name} on this plot`}>
      <div className={q.head}>
        <div className={s.kicker}>
          <span className={q.spark} aria-hidden="true" />
          {name} · level {building.level}
        </div>
        <button className={q.close} aria-label="Close" onClick={close}>
          <CloseGlyph />
        </button>
      </div>
      {picking?.slot === building.slot ? <LinkSteps picking={picking} kind={building.kind} /> : building.link ? <Linked building={building} /> : <Empty building={building} />}
    </div>
  );
}

/** Nothing linked: what the building would show, and the one way to link it, or why it cannot be linked yet. */
function Empty({ building }: { building: Building }) {
  const kind = linkKindOf(building.kind);
  const name = KIND_NAMES[building.kind];
  if (kind === 'agent' && RING_OPEN) return <RingGarage building={building} />;
  if (!kind || kind === 'agent') {
    return (
      <>
        <div className={q.title}>No agent here yet</div>
        <div className={q.hint}>The engine does not keep who owns an agent yet, so a garage cannot prove one is yours. It stays empty until it can.</div>
        <button className={`${s.display} ${s.action} ${q.off}`} disabled>
          Agents come later
        </button>
      </>
    );
  }
  const object = OBJECT_NAMES[kind];
  return (
    <>
      <div className={q.title}>Nothing linked yet</div>
      <div className={q.hint}>
        Link {WHAT[kind]} and this {name.toLowerCase()} shows it, read live from the engine. The city never counts money.
      </div>
      <button className={`${s.display} ${s.action}`} onClick={() => void siteStore.getState().startLink(building.slot)}>
        Link {kind === 'prediction_book' ? 'your' : 'a'} {object}
      </button>
    </>
  );
}

/** A linked building: its object as read now, and the one action into the engine. */
function Linked({ building }: { building: Building }) {
  const link = building.link!;
  const entry = useSite((st) => st.reads[linkKey(link)]);
  const signing = useSite((st) => st.signing);
  const signError = useSite((st) => st.signError);
  const connected = useSite((st) => Boolean(st.connection));
  // Opening the sheet reads the object again once its last read is a minute old.
  useEffect(() => {
    void siteStore.getState().refresh(link);
  }, [link]);
  const read = entry?.read ?? null;
  const change = () => void siteStore.getState().startLink(building.slot);

  if (read?.state === 'ok') return <ObjectFace view={read.view} loading={!!entry?.loading} onChange={change} />;
  return (
    <>
      <div className={q.title}>{read ? readLine(read) : 'Reading the engine…'}</div>
      <div className={q.hint}>
        {!read
          ? 'Every figure here comes from the engine or the chain, with the moment it was read.'
          : read.state === 'wallet'
            ? 'This is read by its wallet. Connect the wallet that holds it.'
            : read.state === 'proof'
              ? 'The engine shows this to its owner. One signed message, no transaction.'
              : read.state === 'gone'
                ? 'The engine no longer finds this for you. Link another, or keep the building as it is.'
                : 'The engine or the chain did not answer. Nothing is shown in its place.'}
      </div>
      {signError && <div className={`${q.about} ${q.error}`}>{signError}</div>}
      {read?.state === 'wallet' && !connected ? (
        <WalletChoice />
      ) : read?.state === 'proof' || (read?.state === 'wallet' && connected) ? (
        <button className={`${s.display} ${s.action}`} disabled={signing} aria-busy={signing} onClick={() => void siteStore.getState().prove()}>
          {signing ? 'Check your wallet…' : 'Sign in with your wallet'}
        </button>
      ) : (
        <div className={q.pair}>
          <button className={`${s.display} ${s.action}`} disabled={!read || !!entry?.loading} onClick={() => void siteStore.getState().refresh(link, 0)}>
            {!read || entry?.loading ? 'Reading…' : 'Read again'}
          </button>
          <button className={q.quiet} onClick={change}>
            Change
          </button>
        </div>
      )}
    </>
  );
}

/** The object as the engine read it: its name, its figures, where and when they were read, and its one action. */
function ObjectFace({ view, loading, onChange }: { view: ObjectView; loading: boolean; onChange: () => void }) {
  const now = useNow(5_000);
  const age = freshness(view.at, now);
  return (
    <>
      <div className={q.objectHead}>
        <div className={q.words}>
          <div className={q.title}>{view.title}</div>
          <div className={q.line}>{view.line}</div>
        </div>
        {view.signal && <span className={`${q.signal} ${view.signal === 'danger' ? q.signalDanger : ''}`}>{view.signal === 'danger' ? 'Out of range' : 'Live'}</span>}
      </div>
      {view.figures.length > 0 ? (
        <dl className={q.figures}>
          {view.figures.map((f) => (
            <div key={f.label} className={q.figure}>
              <dt>{f.label}</dt>
              <dd>{f.value}</dd>
            </div>
          ))}
        </dl>
      ) : (
        <div className={q.hint}>The engine gave no figures for this now.</div>
      )}
      <div className={`${q.source} ${age.stale ? q.sourceStale : ''}`}>
        {view.source} · {loading ? 'reading…' : age.stale ? `delayed, read ${age.text}` : `read ${age.text}`}
      </div>
      <div className={q.pair}>
        <Action action={view.action} />
        <button className={q.quiet} onClick={onChange}>
          Change
        </button>
      </div>
    </>
  );
}

/** The building's one action: the city's own trade card for a coin, the engine's page for anything else. */
function Action({ action }: { action: ObjectAction }) {
  if (action.kind === 'trade') {
    if (!TRADE_OPEN) {
      return (
        <a className={`${s.display} ${s.action}`} href={`/app/launch/${encodeURIComponent(action.mint)}`}>
          Open {action.symbol}
        </a>
      );
    }
    // The trade card reads only the coin's mint, name, symbol and picture; nothing else of a tower is passed.
    const tower = { id: action.mint, symbol: action.symbol, name: action.name, icon: action.icon } as Tower;
    return (
      <button className={`${s.display} ${s.action}`} onClick={() => useTrade.getState().openFor(tower)}>
        {action.label}
      </button>
    );
  }
  return (
    <a className={`${s.display} ${s.action}`} href={action.href}>
      {action.label}
    </a>
  );
}

/** The steps that link a building: a wallet, its one signed message, then the person's own objects. */
function LinkSteps({ picking, kind }: { picking: Picking; kind: BuildingKind }) {
  const link = linkKindOf(kind);
  const object = link ? OBJECT_NAMES[link] : 'object';
  const back = () => siteStore.getState().cancel();
  const error = picking.error && <div className={`${q.about} ${q.error}`} role="alert">{picking.error}</div>;

  if (picking.step === 'wallet') {
    return (
      <>
        <div className={q.title}>Connect your wallet</div>
        <div className={q.hint}>The engine checks that the {object} is yours by its wallet. Ryntra never holds your keys.</div>
        <WalletChoice />
        <button className={q.quiet} onClick={back}>
          Back
        </button>
      </>
    );
  }
  if (picking.step === 'proof') {
    return (
      <>
        <div className={q.title}>Sign in with your wallet</div>
        <div className={q.hint}>One signed message proves the wallet is yours. No transaction, nothing moves.</div>
        {error}
        <div className={q.pair}>
          <button className={`${s.display} ${s.action}`} disabled={picking.busy} aria-busy={picking.busy} onClick={() => void siteStore.getState().prove()}>
            {picking.busy ? 'Check your wallet…' : 'Sign the message'}
          </button>
          <button className={q.quiet} onClick={back}>
            Back
          </button>
        </div>
      </>
    );
  }
  const list = picking.list;
  const get = link ? GET_ONE[link] : null;
  return (
    <>
      <div className={q.title}>{picking.step === 'saving' ? 'Linking…' : `Pick your ${object}`}</div>
      {!list || picking.busy ? (
        <div className={q.hint}>{picking.step === 'saving' ? 'The world checks with the engine that it is yours.' : `Reading your ${object}s from the engine…`}</div>
      ) : list.state === 'ok' && list.items.length > 0 ? (
        <div className={q.choices}>
          {list.items.map((item: Candidate) => (
            <button key={JSON.stringify(item.link)} className={q.choice} onClick={() => void siteStore.getState().choose(item)}>
              <b>{item.title}</b>
              <span>{item.line}</span>
            </button>
          ))}
        </div>
      ) : list.state === 'ok' ? (
        <div className={q.hint}>This wallet has no {object} the engine can vouch for yet.</div>
      ) : list.state === 'not_yet' ? (
        <div className={q.hint}>The engine cannot prove one of these is yours yet.</div>
      ) : (
        <div className={q.hint}>The engine did not answer. Nothing is shown in its place.</div>
      )}
      {error}
      <div className={q.pair}>
        {list?.state === 'ok' && list.items.length === 0 && get ? (
          <a className={`${s.display} ${s.action}`} href={get.href}>
            {get.label}
          </a>
        ) : list?.state === 'unavailable' ? (
          <button className={`${s.display} ${s.action}`} onClick={() => void siteStore.getState().startLink(picking.slot)}>
            Try again
          </button>
        ) : null}
        <button className={q.quiet} onClick={back}>
          Back
        </button>
      </div>
    </>
  );
}

/** The wallets in this browser, one tap each; none found says where to get one. */
function WalletChoice() {
  const wallets = useWallet((st) => st.wallets);
  const connecting = useWallet((st) => st.connecting);
  const error = useWallet((st) => st.error);
  if (!wallets.length) return <div className={q.hint}>No Solana wallet in this browser. Open Ryntra in Phantom, Solflare or Backpack.</div>;
  return (
    <>
      <div className={q.wallets}>
        {wallets.map((w) => (
          <button key={w.name} className={q.choice} onClick={() => void useWallet.getState().connect(w.name)} disabled={Boolean(connecting)}>
            <b>{connecting === w.name ? `Opening ${w.name}…` : w.name}</b>
          </button>
        ))}
      </div>
      {error && <div className={`${q.about} ${q.error}`}>{error}</div>}
    </>
  );
}
