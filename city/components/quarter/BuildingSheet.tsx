'use client';

import { useEffect } from 'react';
import { useWords } from '@/city/lib/i18n/dict';
import type { Tower } from '@/city/lib/market/types';
import { KIND_NAMES } from '@/city/lib/quarter/kit';
import { freshness, linkKey, linkKindOf, type Candidate, type ObjectAction, type ObjectView } from '@/city/lib/quarter/objects';
import { siteStore, useSite, type Picking } from '@/city/lib/quarter/site';
import { quarterStore } from '@/city/lib/quarter/store';
import type { Building, BuildingKind, LinkKind } from '@/city/lib/quarter/types';
import { useTrade } from '@/city/lib/trade/store';
import { useWallet } from '@/city/lib/trade/wallet';
import { CloseGlyph } from '../hud/glyphs';
import s from '../hud/hud.module.css';
import { openInCity } from '../open/OpenFromAddress';
import { RING_OPEN, RingGarage } from '../ring/RingGarage';
import { readLine, useNow } from './BuildingTag';
import q from './quarter.module.css';
import { QUARTER } from './words';

/** The trade card stays a switch, as on a tower: `closed` sends a coin's action to its own address in the city instead. */
const TRADE_OPEN = process.env.NEXT_PUBLIC_RYNTRA_CITY_TRADE !== 'closed';

/** Where a person gets an object of each kind, for a building whose owner has none yet; its words are `QUARTER.getOne`. */
const GET_ONE: Record<LinkKind, string | null> = {
  mint: '/?open=launch',
  lp_position: '/?open=harbor',
  strategy: '/?open=agents',
  team: '/?open=agents',
  prediction_book: '/?open=oracle',
  agent: null,
};

/**
 * A plot's sheet for a building on the engine: the object it shows, read from the engine now, each figure with its
 * source and age and one action into the engine's own card; with nothing linked, an honest empty state and the way to
 * link one. The city never counts money: every number here is a read, and a read that did not answer says so.
 */
export function BuildingSheet({ building }: { building: Building }) {
  const picking = useSite((st) => st.picking);
  const w = useWords(QUARTER);
  // Linking belongs to its plot: another plot, or closing, ends it.
  useEffect(() => () => siteStore.getState().cancel(), []);
  const close = () => {
    siteStore.getState().cancel();
    quarterStore.getState().pick(null);
  };
  const name = KIND_NAMES[building.kind];
  return (
    <div className={`${s.panel} ${q.sheet}`} role="dialog" aria-label={w.onPlot(name)}>
      <div className={q.head}>
        <div className={s.kicker}>
          <span className={q.spark} aria-hidden="true" />
          {w.nameLevel(name, building.level)}
        </div>
        <button className={q.close} aria-label={w.close} onClick={close}>
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
  const w = useWords(QUARTER);
  if (kind === 'agent' && RING_OPEN) return <RingGarage building={building} />;
  if (!kind || kind === 'agent') {
    return (
      <>
        <div className={q.title}>{w.noAgent}</div>
        <div className={q.hint}>{w.noAgentHint}</div>
        <button className={`${s.display} ${s.action} ${q.off}`} disabled>
          {w.agentsLater}
        </button>
      </>
    );
  }
  return (
    <>
      <div className={q.title}>{w.nothingLinked}</div>
      <div className={q.hint}>{w.linkHint(kind, name.toLowerCase())}</div>
      <button className={`${s.display} ${s.action}`} onClick={() => void siteStore.getState().startLink(building.slot)}>
        {w.linkObject(kind)}
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
  const w = useWords(QUARTER);
  // Opening the sheet reads the object again once its last read is a minute old.
  useEffect(() => {
    void siteStore.getState().refresh(link);
  }, [link]);
  const read = entry?.read ?? null;
  const change = () => void siteStore.getState().startLink(building.slot);

  if (read?.state === 'ok') return <ObjectFace view={read.view} loading={!!entry?.loading} onChange={change} />;
  return (
    <>
      <div className={q.title}>{read ? readLine(read) : w.readingEngine}</div>
      <div className={q.hint}>
        {!read ? w.hintFirst : read.state === 'wallet' ? w.hintWallet : read.state === 'proof' ? w.hintProof : read.state === 'gone' ? w.hintGone : w.hintUnavailable}
      </div>
      {signError && <div className={`${q.about} ${q.error}`}>{signError}</div>}
      {read?.state === 'wallet' && !connected ? (
        <WalletChoice />
      ) : read?.state === 'proof' || (read?.state === 'wallet' && connected) ? (
        <button className={`${s.display} ${s.action}`} disabled={signing} aria-busy={signing} onClick={() => void siteStore.getState().prove()}>
          {signing ? w.checkingWallet : w.signInWallet}
        </button>
      ) : (
        <div className={q.pair}>
          <button className={`${s.display} ${s.action}`} disabled={!read || !!entry?.loading} onClick={() => void siteStore.getState().refresh(link, 0)}>
            {!read || entry?.loading ? w.readingDots : w.readAgain}
          </button>
          <button className={q.quiet} onClick={change}>
            {w.change}
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
  const w = useWords(QUARTER);
  return (
    <>
      <div className={q.objectHead}>
        <div className={q.words}>
          <div className={q.title}>{view.title}</div>
          <div className={q.line}>{view.line}</div>
        </div>
        {view.signal && <span className={`${q.signal} ${view.signal === 'danger' ? q.signalDanger : ''}`}>{view.signal === 'danger' ? w.outOfRange : w.live}</span>}
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
        <div className={q.hint}>{w.noFigures}</div>
      )}
      <div className={`${q.source} ${age.stale ? q.sourceStale : ''}`}>
        {view.source} · {loading ? w.readingLower : age.stale ? w.delayedRead(age.text) : w.readAge(age.text)}
      </div>
      <div className={q.pair}>
        <Action action={view.action} />
        <button className={q.quiet} onClick={onChange}>
          {w.change}
        </button>
      </div>
    </>
  );
}

/** The building's one action: the city's own trade card for a coin, the engine's page for anything else. */
function Action({ action }: { action: ObjectAction }) {
  const w = useWords(QUARTER);
  if (action.kind === 'trade') {
    if (!TRADE_OPEN) {
      return (
        <a className={`${s.display} ${s.action}`} href={`/c/${encodeURIComponent(action.mint)}`}>
          {w.openSymbol(action.symbol)}
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
    <a className={`${s.display} ${s.action}`} href={action.href} onClick={(event) => openInCity(action.href) && event.preventDefault()}>
      {action.label}
    </a>
  );
}

/** The steps that link a building: a wallet, its one signed message, then the person's own objects. */
function LinkSteps({ picking, kind }: { picking: Picking; kind: BuildingKind }) {
  const link = linkKindOf(kind);
  const object = link ?? 'object';
  const w = useWords(QUARTER);
  const back = () => siteStore.getState().cancel();
  const error = picking.error && <div className={`${q.about} ${q.error}`} role="alert">{picking.error}</div>;

  if (picking.step === 'wallet') {
    return (
      <>
        <div className={q.title}>{w.connectYourWallet}</div>
        <div className={q.hint}>{w.checksYours(object)}</div>
        <WalletChoice />
        <button className={q.quiet} onClick={back}>
          {w.back}
        </button>
      </>
    );
  }
  if (picking.step === 'proof') {
    return (
      <>
        <div className={q.title}>{w.signInWallet}</div>
        <div className={q.hint}>{w.proofHint}</div>
        {error}
        <div className={q.pair}>
          <button className={`${s.display} ${s.action}`} disabled={picking.busy} aria-busy={picking.busy} onClick={() => void siteStore.getState().prove()}>
            {picking.busy ? w.checkingWallet : w.signMessage}
          </button>
          <button className={q.quiet} onClick={back}>
            {w.back}
          </button>
        </div>
      </>
    );
  }
  const list = picking.list;
  const href = link ? GET_ONE[link] : null;
  const get = link && href ? { label: w.getOne(link), href } : null;
  return (
    <>
      <div className={q.title}>{picking.step === 'saving' ? w.linking : w.pick(object)}</div>
      {!list || picking.busy ? (
        <div className={q.hint}>{picking.step === 'saving' ? w.worldChecks : w.readingYours(object)}</div>
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
        <div className={q.hint}>{w.noneYet(object)}</div>
      ) : list.state === 'not_yet' ? (
        <div className={q.hint}>{w.cannotProve}</div>
      ) : (
        <div className={q.hint}>{w.noAnswer}</div>
      )}
      {error}
      <div className={q.pair}>
        {list?.state === 'ok' && list.items.length === 0 && get ? (
          <a className={`${s.display} ${s.action}`} href={get.href} onClick={(event) => openInCity(get.href) && event.preventDefault()}>
            {get.label}
          </a>
        ) : list?.state === 'unavailable' ? (
          <button className={`${s.display} ${s.action}`} onClick={() => void siteStore.getState().startLink(picking.slot)}>
            {w.tryAgain}
          </button>
        ) : null}
        <button className={q.quiet} onClick={back}>
          {w.back}
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
  const w = useWords(QUARTER);
  if (!wallets.length) return <div className={q.hint}>{w.noWalletOpen}</div>;
  return (
    <>
      <div className={q.wallets}>
        {wallets.map((one) => (
          <button key={one.name} className={q.choice} onClick={() => void useWallet.getState().connect(one.name)} disabled={Boolean(connecting)}>
            <b>{connecting === one.name ? w.opening(one.name) : one.name}</b>
          </button>
        ))}
      </div>
      {error && <div className={`${q.about} ${q.error}`}>{error}</div>}
    </>
  );
}
