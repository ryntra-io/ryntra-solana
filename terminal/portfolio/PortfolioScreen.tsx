'use client';

import { useCallback, useEffect, useMemo, useRef, type ReactNode } from 'react';
import { digits, useWords } from '@/city/lib/i18n/dict';
import { useLang } from '@/city/lib/i18n/lang';
import { flowLive } from '@/city/lib/money/flag';
import { useMoney } from '@/city/lib/money/open';
import { useMoneyStore } from '@/city/lib/money/store';
import { useTrade, type CoinRef } from '@/city/lib/trade/store';
import { useWallet } from '@/city/lib/trade/wallet';
import { ticketFree } from '@/terminal/coin/ticket-rules';
import { sumText } from '@/terminal/earn/rows';
import { openPanel } from '@/terminal/shell/frame';
import { Split } from '@/terminal/shell/Split';
import { useAskHere } from '@/terminal/shell/useAskHere';
import { NARROW, useNarrow } from '@/terminal/shell/useNarrow';
import { connectWallet } from '@/terminal/shell/Wallet';
import { SHELF_WORDS } from '@/terminal/shell/words';
import { Recent } from '@/terminal/swap/Recent';
import { turnMoney as showMoney, useSwapScreen } from '@/terminal/swap/state';
import { Action, Chip, Icon, Panel, Quiet, Title } from '@/terminal/ui';
import { ActPanel, ActSheet } from './Acts';
import { addressOf, collectable, exitLines, exitable, mintOf, primaryOf, shortAddress, type ActionId } from './all-view';
import { ALL } from './all-words';
import { cleanBusy, followClean, settleClean, useClean } from './clean';
import { counts, estimateSol, riskMap, solFigure } from './clean-view';
import { CLEAN } from './clean-words';
import { exitBusy, followExit, openExit, settleExit, useExit } from './exit';
import { Glyph } from './glyphs';
import { Groups, type CoinAsk } from './Groups';
import { AddressField, Bones, Welcome } from './Lookup';
import { mayClose } from './portfolio-view';
import { PrivatePanel } from './Private';
import { setAct, setWatch, usePortfolioScreen, type Act } from './state';
import { ActionBar, ThumbBar, TotalPanel, type Offer } from './Summary';
import { useAgentsHeld } from './useAgentsHeld';
import { useAll } from './useAll';
import { PORTFOLIO } from './words';
import a from './all.module.css';

/** After a trade or a transfer lands, the wallet's coins are read again — and once more for a network that lags. */
const AFTER_MS = [1_500, 7_000] as const;

/** Whether the panel in front may close now: never while money is mid-way. */
function closable(act: Act | null): boolean {
  if (!act) return true;
  if (act.kind === 'clean') return !cleanBusy();
  if (act.kind === 'exit') return !exitBusy();
  const card = useTrade.getState();
  return mayClose({ trade: act.kind === 'trade', phase: card.phase, held: card.held, moneyBusy: useMoney.getState().busy });
}

/** What a panel leaves behind as it goes: a transfer hands the Swap screen its bridge back, a clean and an exit forget their result. */
function settle(act: Act | null): void {
  if (act?.kind === 'send') showMoney('bridge');
  if (act?.kind === 'clean') settleClean();
  if (act?.kind === 'exit') settleExit();
}

function closeAct(): void {
  const act = usePortfolioScreen.getState().act;
  if (!act || !closable(act)) return;
  settle(act);
  setAct(null);
}

/**
 * The trade card on a coin and a side, by the card's own rules: on the coin it already stands on the side only switches;
 * on another coin it opens there — never over a trade still under way. The ticket then shows the card as it is.
 */
function pickTrade(coin: CoinRef, side: 'buy' | 'sell'): void {
  const card = useTrade.getState();
  if (card.open && card.tower?.mint === coin.id && card.view === 'spot') card.setSide(side);
  else if (ticketFree(card)) card.openFor(coin, side, { view: 'spot' });
}

/** The panel's place on a desk, brought into view as it opens. */
const ACT_ID = 'portfolio-act';

/**
 * The Portfolio — «Everything in Solana»: whatever a wallet holds across Solana, in one place. Without a wallet the
 * screen takes an address and shows it read only; with one it acts: the total with its parts, three actions on top —
 * «Collect fees», «Exit everything», «Clean wallet», one of them amber — and the groups under them: pools, staking,
 * deposits and loans, the agents, the coins, the dust. Every figure is the engine's read (`GET /api/v1/portfolio`);
 * every trade, transfer, clean and exit is the engine's own logic, as it is. On a phone the same blocks stand one under
 * another, the actions in the thumb's reach, and a panel is a sheet.
 */
export function PortfolioScreen() {
  const narrow = useNarrow();
  const w = useWords(ALL);
  const m = useWords(PORTFOLIO);
  const c = useWords(CLEAN);
  const names = useWords(SHELF_WORDS);
  const lang = useLang();
  const owner = useWallet((st) => st.connection?.address ?? null);
  const watch = usePortfolioScreen((st) => st.watch);
  const act = usePortfolioScreen((st) => st.act);
  const busy = useMoney((st) => st.busy);
  // Where a trade on the ticket stands: a panel that waited on it goes once it ends.
  const cardPhase = useTrade((st) => st.phase);
  const cardHeld = useTrade((st) => st.held);
  const address = watch ?? owner;
  const own = owner !== null && address === owner;
  const deposit = flowLive('deposit');
  const sends = flowLive('send');
  const recent = useRef<HTMLDivElement>(null);
  const top = useRef<HTMLDivElement>(null);

  const agents = useAgentsHeld(own ? owner : null);
  const data = useAll(address, agents.usd);
  const cleanRead = useClean((st) => (address && st.owner === address ? st.read : null));
  const cleanChoice = useClean((st) => st.choice);
  const cleanDone = useClean((st) => st.phase === 'done');
  const door = useExit((st) => st.door);
  const exitLanded = useExit((st) => st.landed);

  // A link that carries an address opens on it; the address on screen stays in the link, so it can be shared.
  const linked = useRef(false);
  useEffect(() => {
    const url = new URL(window.location.href);
    if (!linked.current) {
      linked.current = true;
      const asked = addressOf(url.searchParams.get('owner') ?? '');
      if (asked && asked !== usePortfolioScreen.getState().watch) {
        setWatch(asked);
        return;
      }
    }
    if ((url.searchParams.get('owner') ?? null) === watch) return;
    if (watch) url.searchParams.set('owner', watch);
    else url.searchParams.delete('owner');
    window.history.replaceState(window.history.state, '', url);
  }, [watch]);
  // The person's own address, looked at: it is simply their wallet.
  useEffect(() => {
    if (watch && watch === owner) setWatch(null);
  }, [watch, owner]);

  // The money logic follows the connected wallet; the clean's read and the exit's door follow the wallet on screen.
  useEffect(() => useMoneyStore.getState().follow(owner), [owner]);
  const cleanSigning = useClean((st) => st.phase === 'signing' || st.phase === 'sending');
  const exitSigning = useExit((st) => st.phase === 'signing' || st.phase === 'sending');
  // A signature under way keeps its wallet; the stores follow the wallet on screen again once it ends.
  useEffect(() => followClean(address), [address, cleanSigning]);
  useEffect(() => followExit(address), [address, exitSigning]);
  // Another wallet on screen, or none: the panel of the last one goes.
  const shownFor = useRef(address);
  useEffect(() => {
    if (shownFor.current === address || !closable(usePortfolioScreen.getState().act)) return;
    shownFor.current = address;
    closeAct();
  }, [address, cleanSigning, exitSigning, busy, cardPhase, cardHeld]);
  // Leaving the screen: the panel goes with it — the ticket lets its card go, never under a signature.
  useEffect(
    () => () => {
      settle(usePortfolioScreen.getState().act);
      usePortfolioScreen.setState({ act: null });
    },
    [],
  );
  // A transfer's panel closed by its own control turns the Swap screen's money panel back to the bridge: it goes here too.
  useEffect(
    () =>
      useSwapScreen.subscribe((now, before) => {
        if (before.money === 'send' && now.money !== 'send' && usePortfolioScreen.getState().act?.kind === 'send') setAct(null);
      }),
    [],
  );
  // What ends on this screen — a trade, a transfer, a bridge, a clean, an exit — shows in the groups and in «Recent» at once.
  const landed = data.landed;
  useEffect(() => {
    const timers: ReturnType<typeof setTimeout>[] = [];
    const after = () => {
      landed();
      void useMoneyStore.getState().readActivity();
      useWallet.getState().refreshHoldings(AFTER_MS);
      for (const ms of AFTER_MS) timers.push(setTimeout(() => useMoneyStore.getState().readWallet(), ms));
    };
    const offTrade = useTrade.subscribe((card, before) => {
      if (card.phase !== before.phase && card.phase === 'done') after();
    });
    const offMoney = useMoneyStore.subscribe((now, before) => {
      if ((now.send.settled && !before.send.settled) || (now.bridge.receipt && !before.bridge.receipt)) after();
    });
    return () => {
      offTrade();
      offMoney();
      timers.forEach(clearTimeout);
    };
  }, [landed]);
  const seen = useRef({ clean: cleanDone, exits: exitLanded });
  useEffect(() => {
    const was = seen.current;
    seen.current = { clean: cleanDone, exits: exitLanded };
    if ((cleanDone && !was.clean) || exitLanded > was.exits) landed();
  }, [cleanDone, exitLanded, landed]);

  const open = useCallback((next: Act) => {
    const now = usePortfolioScreen.getState().act;
    if (now && !closable(now)) return;
    if (next.kind === 'trade') pickTrade(next.coin, next.side);
    else if (next.kind === 'topUp') showMoney('bridge', 'in');
    else if (next.kind === 'send') showMoney('send');
    else if (now?.kind === 'send') showMoney('bridge');
    if (now?.kind === 'clean' && next.kind !== 'clean') settleClean();
    setAct(next);
    // A desk shows the panel beside the groups: it is brought into view.
    if (!window.matchMedia(NARROW).matches) requestAnimationFrame(() => document.getElementById(ACT_ID)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }));
  }, []);
  const topUp = useCallback(() => open(deposit ? { kind: 'topUp' } : { kind: 'receive' }), [open, deposit]);
  const trade = useCallback((coin: CoinAsk, side: 'buy' | 'sell') => open({ kind: 'trade', coin: { id: coin.mint, symbol: coin.symbol, name: coin.name, icon: coin.icon }, side }), [open]);
  const connect = useCallback(() => {
    // A phone's wallet lives in the frame's own sheet.
    if (window.matchMedia(NARROW).matches) openPanel('sheet');
    connectWallet();
  }, []);
  const groups = data.groups;
  /** The exit's panel: for everything, or — from a row — with only that row switched on. */
  const exit = useCallback(
    (mode: 'exit' | 'collect', only: string | null = null) => {
      const now = usePortfolioScreen.getState().act;
      if (now && !closable(now)) return;
      openExit(mode, only);
      open({ kind: 'exit' });
    },
    [open],
  );

  // A sentence for the agent that leads here: the portfolio from the top, or the recent activity.
  useAskHere((ask) => {
    if (ask.command.kind !== 'money') return;
    const place = ask.command.place === 'activity' ? recent.current : top.current;
    requestAnimationFrame(() => place?.scrollIntoView({ block: 'start', behavior: 'smooth' }));
  });

  const risk = useMemo(() => riskMap(cleanRead), [cleanRead]);
  const solUsd = data.answer?.solUsd ?? null;

  // The three actions, each with what it gives this wallet now.
  const collect = useMemo(() => collectable(groups), [groups]);
  const exits = useMemo(() => exitLines(groups).filter(exitable).length, [groups]);
  const cleanSol = cleanRead?.canClean ? estimateSol(cleanRead, cleanChoice) : null;
  const offers = useMemo(() => {
    const out: Offer[] = [];
    if (collect.rows.length) out.push({ id: 'collect', glyph: 'collect', title: w.collectTitle, fact: w.collectFact(sumText(collect.usd, lang), collect.rows.length), word: w.collect, open: door.canCollect, onPress: () => exit('collect') });
    if (exits) out.push({ id: 'exit', glyph: 'exit', title: w.exitTitle, fact: w.exitFact(exits), word: w.exitRow, open: door.canExit, onPress: () => exit('exit') });
    if (cleanRead && cleanSol !== null) {
      const n = counts(cleanRead, cleanChoice);
      // The figure first, as the other two actions say theirs: what comes back, then what it takes.
      out.push({ id: 'clean', glyph: 'sweep', title: c.title, fact: w.cleanFact(digits(solFigure(cleanSol), lang), n.coins, n.accounts), word: c.clean, open: true, onPress: () => open({ kind: 'clean' }) });
    }
    return out;
  }, [collect, exits, cleanRead, cleanSol, cleanChoice, door, w, c, lang, exit, open]);
  const primary = primaryOf({ own, collectUsd: door.canCollect && collect.rows.length ? collect.usd : null, cleanUsd: cleanSol !== null ? (solUsd ? cleanSol * solUsd : 0.01) : null });
  // The panel in front carries the amber action; the bar is quiet while one is open.
  const barPrimary: ActionId | null = act === null && (primary === 'collect' || primary === 'clean') ? primary : null;

  const traded = act?.kind === 'trade' ? groups.filter((group) => group.id === 'coins' || group.id === 'dust').flatMap((group) => group.rows).find((row) => mintOf(row.position) === act.coin.id) : undefined;
  const price = { usd: traded?.price ?? null, dayPct: act?.kind === 'trade' ? (data.coin(act.coin.id)?.dayPct ?? null) : null };
  const panel = act ? <ActPanel act={act} data={data} onClose={closeAct} onTopUp={topUp} price={price} /> : null;
  const held = data.read === 'ready' && data.sum !== null && !data.sum.empty;
  const money = own && held ? <MoneyActions amber={act === null && primary === 'topUp'} deposit={deposit} sends={sends} busy={busy} onOpen={open} onTopUp={topUp} /> : null;
  const side = panel && !narrow ? (
    <div id={ACT_ID}>{panel}</div>
  ) : own ? (
    <div className={a.side}>
      <PrivatePanel />
      <div ref={recent}>
        <Recent title={m.recent} edge />
      </div>
    </div>
  ) : null;

  return (
    <>
      <div className={a.head} ref={top}>
        <Title>{names.portfolio}</Title>
        {watch ? (
          <span className={a.whose}>
            <span className={a.whoseAddress} translate="no" title={watch}>
              {shortAddress(watch)}
            </span>
            <Chip>{w.viewOnly}</Chip>
            <Quiet size="s" aria-label={w.closeWatch} onClick={() => setWatch(null)}>
              <Icon name="close" size="s" />
            </Quiet>
          </span>
        ) : null}
        <span className={a.grow} />
        {address ? <AddressField small onShow={setWatch} /> : null}
        {money ? <div className={a.deskOnly}>{money}</div> : null}
      </div>

      {!address ? (
        <Welcome onShow={setWatch} onConnect={connect} />
      ) : data.read === 'reading' ? (
        <Bones label={w.reading} busy />
      ) : data.read === 'failed' ? (
        <Panel pad="l" edge label={w.unread}>
          <div className={a.blank}>
            <p className={a.blankLine}>{w.unread}</p>
            <Quiet disabled={data.rereading} onClick={data.reread}>
              {w.again}
            </Quiet>
          </div>
        </Panel>
      ) : !held ? (
        <Beside side={panel && !narrow ? <div id={ACT_ID}>{panel}</div> : null} label={m.actions}>
          <Panel tone={act === null ? 'hi' : 'base'} pad="l" gap={16} edge label={w.total} className={a.emptyPanel}>
            <p className={a.blankLine}>{own ? m.emptyLine : w.emptyLine}</p>
            {own ? (
              <div className={a.money}>
                {act === null ? (
                  <Action size="m" full={false} disabled={busy} onClick={topUp}>
                    <Glyph name="plus" />
                    {m.topUp}
                  </Action>
                ) : (
                  <Quiet disabled={busy} onClick={topUp}>
                    <Glyph name="plus" />
                    {m.topUp}
                  </Quiet>
                )}
                {deposit ? (
                  <Quiet onClick={() => open({ kind: 'receive' })}>
                    <Glyph name="receive" />
                    {m.receive}
                  </Quiet>
                ) : null}
              </div>
            ) : owner === null ? (
              <Action size="m" full={false} onClick={connect}>
                {w.connect}
              </Action>
            ) : null}
          </Panel>
        </Beside>
      ) : (
        <>
          <TotalPanel data={data} />
          <ActionBar
            offers={offers}
            primary={barPrimary}
            own={own}
            busy={busy}
            tail={
              owner === null ? (
                <Action size="m" full={false} onClick={connect}>
                  {w.connect}
                </Action>
              ) : undefined
            }
          />
          {money ? <div className={a.phoneOnly}>{money}</div> : null}
          <Beside side={side} label={panel ? m.actions : m.recent}>
            <Groups data={data} own={own} narrow={narrow} door={door} risk={risk} cleanRead={cleanRead} agents={agents} onTrade={trade} onCollect={(id) => exit('collect', id)} onExit={(id) => exit('exit', id)} onClean={() => open({ kind: 'clean' })} />
          </Beside>
          {own ? <ThumbBar offers={offers} primary={barPrimary} busy={busy} /> : owner === null ? <ThumbBar offers={offers} primary={null} busy={busy} connect={connect} /> : null}
        </>
      )}

      {narrow && panel ? (
        <ActSheet label={act?.kind === 'trade' ? act.coin.symbol : act?.kind === 'clean' ? c.title : act?.kind === 'exit' ? w.exitTitle : m.actions} onClose={closeAct}>
          {panel}
        </ActSheet>
      ) : null}
    </>
  );
}

/** The screen's column with the side column beside it — the frame's own split — or alone, where there is nothing to stand beside it. */
function Beside({ side, label, children }: { side: ReactNode; label: string; children: ReactNode }) {
  if (!side) return <>{children}</>;
  return (
    <Split id="portfolio" label={label} phone="stack" side={side}>
      {children}
    </Split>
  );
}

/**
 * «Top up», «Send», «Receive» — the wallet's own money. Quiet beside the three actions; «Top up» is the amber one only
 * when nothing else on the screen is. Each opens only where its way is open; with no deposit from another network,
 * «Top up» is the wallet's own address.
 */
function MoneyActions({ amber, deposit, sends, busy, onOpen, onTopUp }: { amber: boolean; deposit: boolean; sends: boolean; busy: boolean; onOpen: (act: Act) => void; onTopUp: () => void }) {
  const w = useWords(PORTFOLIO);
  const label = (
    <>
      <Glyph name="plus" />
      {w.topUp}
    </>
  );
  return (
    <div className={a.money} role="group" aria-label={w.actions}>
      {amber ? (
        <Action size="m" full={false} disabled={busy} onClick={onTopUp}>
          {label}
        </Action>
      ) : (
        <Quiet disabled={busy} onClick={onTopUp}>
          {label}
        </Quiet>
      )}
      {sends ? (
        <Quiet disabled={busy} onClick={() => onOpen({ kind: 'send' })}>
          <Glyph name="send" />
          {w.send}
        </Quiet>
      ) : null}
      {deposit ? (
        <Quiet disabled={busy} onClick={() => onOpen({ kind: 'receive' })}>
          <Glyph name="receive" />
          {w.receive}
        </Quiet>
      ) : null}
    </div>
  );
}
