'use client';

import { useEffect, type ReactNode } from 'react';
import { keeperLine, wholeOf } from '@/lib/care/range-limits';
import type { KeeperChoice } from '@/lib/care/stock-keeper-terms';
import type { ProBoat, ProPier } from '@/city/lib/earn/pro';
import { digits, useWords } from '@/city/lib/i18n/dict';
import { useLang } from '@/city/lib/i18n/lang';
import { useWallet } from '@/city/lib/trade/wallet';
import { Action, Chip, Kick, Quiet, Segment } from '@/terminal/ui';
import { Note, OneLine, Result, TicketHead } from '../bits';
import type { Coin } from '../rows';
import { COST_IDS, MODE_WORD, PACE_IDS, PACE_WORD, WIDTH_IDS, WIDTH_WORD, choiceFor, costSolOf, doorLine, failureOf, keeperOf, keeperPool, modesOf, movesOf, sameChoice, widthOf } from './model';
import { KEEPER_LOCKED, useKeeper } from './store';
import { KEEPER } from './words';
import e from '../earn.module.css';
import k from './keeper.module.css';

/** The bounds' Review follows the choice on screen after this pause. */
const AUTO_REVIEW_MS = 250;

/**
 * The stock pool's keeper on a position, mounted around the position's own ticket: in a pool the agent keeps
 * here, a quiet line under the ticket says what the keeper does now and opens its bounds; the bounds then stand in the
 * ticket's place with their one amber action. Anywhere else, the ticket alone.
 */
export function KeeperMount({ boat, pier, coins, name, onConnect, children }: { boat: ProBoat; pier: ProPier; coins: readonly Coin[]; name: string; onConnect: () => void; children: ReactNode }) {
  const connection = useWallet((st) => st.connection);
  const loaded = useKeeper((st) => st.loaded);
  const open = useKeeper((st) => st.open);
  const owner = connection?.address ?? null;
  useEffect(() => {
    if (owner) void useKeeper.getState().load(owner);
  }, [owner]);
  const status = loaded.status === 'ready' && loaded.owner === owner ? loaded.value : null;
  if (!status || !keeperPool(pier, status)) return <>{children}</>;
  if (open === boat.nftMint) return <KeeperTicket boat={boat} pier={pier} coins={coins} name={name} onConnect={onConnect} />;
  return (
    <>
      {children}
      <KeeperDoor boat={boat} />
    </>
  );
}

/** The quiet line under the position: the agent's state in a few words, and the way to its bounds. */
function KeeperDoor({ boat }: { boat: ProBoat }) {
  const w = useWords(KEEPER);
  const loaded = useKeeper((st) => st.loaded);
  const view = keeperOf(loaded.status === 'ready' ? loaded.value : null, boat.nftMint);
  const line = doorLine(view);
  const working = view?.status === 'working';
  return (
    <div className={k.door}>
      <span className={k.doorWords}>
        <span className={k.doorHead}>
          <Kick>{w.agent}</Kick>
          {view ? (
            <Chip tone={working ? 'ok' : 'plain'} dot={working}>
              {working ? w.atWork : w.stopped}
            </Chip>
          ) : null}
        </span>
        <span className={`${e.cap} ${e.capWrap}`}>{line === 'off' || line === 'stopped' ? w.off : w[line]}</span>
      </span>
      <Quiet size="s" onClick={() => useKeeper.getState().openFor(boat.nftMint, working ? view!.choice : null)}>
        {working ? w.bounds : w.give}
      </Quiet>
    </div>
  );
}

/** The bounds the person signs once, the one line before the signature, and the one amber action. */
function KeeperTicket({ boat, pier, coins, name, onConnect }: { boat: ProBoat; pier: ProPier; coins: readonly Coin[]; name: string; onConnect: () => void }) {
  const w = useWords(KEEPER);
  const lang = useLang();
  const connection = useWallet((st) => st.connection);
  const loaded = useKeeper((st) => st.loaded);
  const choice = useKeeper((st) => st.choice);
  const review = useKeeper((st) => st.review);
  const phase = useKeeper((st) => st.phase);
  const code = useKeeper((st) => st.code);
  const quiet = useKeeper((st) => st.quiet);
  const status = loaded.status === 'ready' ? loaded.value : null;
  const view = keeperOf(status, boat.nftMint);
  const working = view?.status === 'working' ? view : null;
  const modes = modesOf(status);
  const asked = choiceFor(choice, modes);
  const shown = review && review.nftMint === boat.nftMint && sameChoice(review.choice, asked) ? review : null;
  const unchanged = working !== null && sameChoice(working.choice, asked);

  // The Review of exactly the bounds on screen, while the person reads them — never opening the wallet by itself: without
  // the wallet's proof in this browser, it waits for the tap.
  useEffect(() => {
    if (!connection || unchanged || shown || phase !== 'idle' || quiet === boat.nftMint) return;
    const timer = setTimeout(() => void useKeeper.getState().prepare(connection, { pool: pier.address, nftMint: boat.nftMint }, true), AUTO_REVIEW_MS);
    return () => clearTimeout(timer);
  }, [connection, unchanged, shown, phase, quiet, pier.address, boat.nftMint]);

  const head = <TicketHead coins={coins} name={name} sub={w.title} extra={working ? <Chip tone="ok" dot>{w.atWork}</Chip> : undefined} />;
  const back = (
    <Quiet full onClick={() => useKeeper.getState().close()}>
      {w.back}
    </Quiet>
  );

  if (phase === 'done' || phase === 'stopped') {
    const gave = phase === 'done';
    return (
      <>
        {head}
        <Result good word={gave ? w.doneGive : w.doneStop} line={gave ? w.doneGiveLine : w.doneStopLine} />
        <Quiet full onClick={() => useKeeper.getState().close()}>
          {w.ok}
        </Quiet>
      </>
    );
  }

  const set = (patch: Partial<KeeperChoice>) => useKeeper.getState().setChoice(patch);
  const width = widthOf(asked.width);
  const terms = shown?.terms ?? null;
  const coinWords = shown?.coins ?? { x: { symbol: pier.x.symbol, decimals: pier.x.decimals }, y: { symbol: pier.y.symbol, decimals: pier.y.decimals } };
  const line = terms ? digits(keeperLine(terms, coinWords, lang), lang) : null;
  const putBackText = terms?.approval ? digits(`${wholeOf(terms.approval.xRaw, coinWords.x.decimals)} ${coinWords.x.symbol} · ${wholeOf(terms.approval.yRaw, coinWords.y.decimals)} ${coinWords.y.symbol}`, lang) : null;
  const waiting = phase === 'reviewing' || KEEPER_LOCKED.has(phase);
  const label = phase === 'reviewing' ? w.building : phase === 'wallet' ? w.inWallet : phase === 'sending' ? w.sending : working ? w.update : w.giveTo;
  const press = () => {
    if (!connection) return onConnect();
    if (shown) void useKeeper.getState().confirm(connection);
    else void useKeeper.getState().prepare(connection, { pool: pier.address, nftMint: boat.nftMint });
  };

  return (
    <>
      {head}
      <fieldset className={e.form} disabled={KEEPER_LOCKED.has(phase)}>
        <div className={`${e.choice} ${k.keep}`}>
          <Kick>{w.width}</Kick>
          <Segment label={w.width} value={asked.width} onChange={(id) => set({ width: id })} items={WIDTH_IDS.map((id) => ({ id, label: w[WIDTH_WORD[id]] }))} />
          <span className={`${e.cap} ${e.capWrap}`}>{digits(asked.putBack ? w.widthLine(width.day, width.night) : w.pullWidthLine(width.night), lang)}</span>
        </div>
        {modes.includes('shift') ? (
          <>
            <div className={`${e.choice} ${k.keep}`}>
              <Kick>{w.mode}</Kick>
              <Segment label={w.mode} value={asked.putBack ? 'shift' : 'pull'} onChange={(id) => set({ putBack: id === 'shift' })} items={modes.map((id) => ({ id, label: w[MODE_WORD[id]] }))} />
            </div>
            {asked.putBack ? (
              <>
                <div className={`${e.choice} ${k.keep}`}>
                  <Kick>{w.pace}</Kick>
                  <Segment label={w.pace} value={asked.pace} onChange={(id) => set({ pace: id })} items={PACE_IDS.map((id) => ({ id, label: w[PACE_WORD[id]] }))} />
                  <span className={e.cap}>{digits(w.paceLine(String(movesOf(asked.pace))), lang)}</span>
                </div>
                <div className={`${e.choice} ${k.keep}`}>
                  <Kick>{w.cost}</Kick>
                  <Segment label={w.cost} value={asked.cost} onChange={(id) => set({ cost: id })} items={COST_IDS.map((id) => ({ id, label: digits(costSolOf(id), lang) }))} />
                  <span className={e.cap}>{w.costLine}</span>
                </div>
              </>
            ) : null}
          </>
        ) : null}
      </fieldset>
      {line ? (
        <div className={k.line}>
          <OneLine line={line} label={w.infoLabel}>
            <KeeperDetails mode={terms!.mode} putBack={putBackText} pullOnly={!modes.includes('shift')} />
          </OneLine>
        </div>
      ) : null}
      {phase === 'failed' ? <Note tone="error">{w[failureOf(code)]}</Note> : phase === 'cancelled' ? <Note tone="plain">{w.cancelled}</Note> : null}
      <Action onClick={phase === 'failed' || phase === 'cancelled' ? () => useKeeper.getState().again() : press} busy={waiting} disabled={waiting || (connection !== null && (unchanged || (!shown && phase === 'idle')))}>
        {connection ? (phase === 'failed' || phase === 'cancelled' ? w.again : label) : w.connect}
      </Action>
      {working ? (
        <Quiet full onClick={() => connection && void useKeeper.getState().stop(connection, working.key)} disabled={waiting}>
          {w.stop}
        </Quiet>
      ) : null}
      {back}
    </>
  );
}

/** Behind the «i»: what the agent may and may not do, how the hours move it, and what is honestly not possible. */
function KeeperDetails({ mode, putBack, pullOnly }: { mode: 'pull' | 'shift'; putBack: string | null; pullOnly: boolean }) {
  const w = useWords(KEEPER);
  return (
    <>
      <span className={k.detailsHead}>{w.may}</span>
      <ul className={k.list}>
        <li>{w.mayCollect}</li>
        <li>{w.mayTakeOut}</li>
        {mode === 'shift' ? <li>{w.mayMove}</li> : null}
        {mode === 'shift' && putBack ? <li>{w.mayPutBack(putBack)}</li> : null}
      </ul>
      <span className={k.detailsHead}>{w.mayNot}</span>
      <ul className={k.list}>
        <li>{w.notPay}</li>
        <li>{w.notLock}</li>
        <li>{w.notTrade}</li>
        <li>{w.notOutside}</li>
      </ul>
      <span>{w.hoursText}</span>
      <span>{`${w.feeText} ${w.jumpText}`}</span>
      {pullOnly ? <span>{w.pullOnly}</span> : null}
      <span>{w.stopText}</span>
    </>
  );
}
