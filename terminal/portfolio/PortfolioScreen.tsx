'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useId, useMemo, useRef, useState, type RefObject } from 'react';
import { digits, useWords } from '@/city/lib/i18n/dict';
import { useLang } from '@/city/lib/i18n/lang';
import { flowLive } from '@/city/lib/money/flag';
import { useMoney } from '@/city/lib/money/open';
import { useMoneyStore } from '@/city/lib/money/store';
import { useTrade, type CoinRef } from '@/city/lib/trade/store';
import { useWallet } from '@/city/lib/trade/wallet';
import { ticketFree } from '@/terminal/coin/ticket-rules';
import { forwardOf, moneyHref } from '@/terminal/money/money-view';
import { sumText } from '@/terminal/earn/rows';
import { partOf, useAddressTail } from '@/terminal/shell/address';
import { openPanel } from '@/terminal/shell/frame';
import { useAskHere } from '@/terminal/shell/useAskHere';
import { NARROW, useNarrow } from '@/terminal/shell/useNarrow';
import { connectWallet } from '@/terminal/shell/Wallet';
import { SHELF_WORDS } from '@/terminal/shell/words';
import { Recent } from '@/terminal/swap/Recent';
import { turnMoney as showMoney } from '@/terminal/swap/state';
import { ExplainBox, ExplainButton } from '@/terminal/coin/parts';
import { Action, ActionBody, Chip, Icon, Kick, Page, PageHead, Panel, Quiet, QuietLink } from '@/terminal/ui';
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

/** What a panel leaves behind as it goes: a clean and an exit forget their result. */
function settle(act: Act | null): void {
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

  // A link that carries an address opens on it; the address on screen stays in the link, so it can be shared — and
  // reloaded: the menu's «Positions» and «History» lead within the page by addresses that carry no wallet
  // (`/portfolio#history`), and the wallet looked at is written back into them (QA 19.11, B-19).
  const tail = useAddressTail();
  const linked = useRef(false);
  const lastWatch = useRef(watch);
  useEffect(() => {
    const url = new URL(window.location.href);
    const asked = addressOf(url.searchParams.get('owner') ?? '');
    const moved = lastWatch.current !== watch;
    lastWatch.current = watch;
    if (!linked.current) {
      linked.current = true;
      if (asked && asked !== usePortfolioScreen.getState().watch) {
        setWatch(asked);
        return;
      }
    } else if (!moved && asked && asked !== watch) {
      // The address was led to another wallet while the screen stood: the link wins.
      setWatch(asked);
      return;
    }
    if ((url.searchParams.get('owner') ?? null) === watch) return;
    if (watch) url.searchParams.set('owner', watch);
    else url.searchParams.delete('owner');
    window.history.replaceState(window.history.state, '', url);
  }, [watch, tail]);
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
    if (now?.kind === 'clean' && next.kind !== 'clean') settleClean();
    setAct(next);
    // A desk shows the panel beside the groups: it is brought into view.
    if (!window.matchMedia(NARROW).matches) requestAnimationFrame(() => document.getElementById(ACT_ID)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }));
  }, []);
  const router = useRouter();
  // With no deposit from another network, «Top up» is the wallet's own address — the «Receive» of «Money».
  const topUp = useCallback(() => (deposit ? open({ kind: 'topUp' }) : router.push(moneyHref('receive', sends))), [open, deposit, router, sends]);
  const trade = useCallback((coin: CoinAsk, side: 'buy' | 'sell') => open({ kind: 'trade', coin: { id: coin.mint, symbol: coin.symbol, name: coin.name, icon: coin.icon }, side }), [open]);
  const connect = useCallback(() => {
    // A phone's wallet lives in the frame's own sheet.
    if (window.matchMedia(NARROW).matches) openPanel('sheet');
    connectWallet();
  }, []);
  useMoneyForward(act, sends);
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
  const money = own && held ? <MoneyActions amber={act === null && primary === 'topUp'} sends={sends} busy={busy} onTopUp={topUp} /> : null;
  // The side column holds only the panel the person opened (QA 19.11: the private balance and «Recent» kept a column of
  // their own, and the tables beside them were cramped). The lists take the page's whole width; under them the history,
  // and the private balance at the foot — on a phone too. Both come with the wallet's read, never before it: the menu's
  // «History» (`#history`) finds its place once the page above it stands (`usePlaceOnArrival`).
  const side = panel && !narrow ? <div id={ACT_ID}>{panel}</div> : null;
  const foot = (
    <>
      <History own={own} address={address} place={recent} />
      {own ? <PrivatePanel /> : null}
    </>
  );

  // One page for every section: the name and the wallet shown at the head, another wallet's address and the
  // money's own actions on the right; then the total, the three actions and the groups in the action column, and in the
  // side column the panel the person opened — or the private balance and the recent activity.
  const whose = watch ? (
    <span className={a.whose}>
      <span className={a.whoseAddress} translate="no" title={watch}>
        {shortAddress(watch)}
      </span>
      <Chip>{w.viewOnly}</Chip>
      <Quiet size="s" aria-label={w.closeWatch} onClick={() => setWatch(null)}>
        <Icon name="close" size="s" />
      </Quiet>
    </span>
  ) : null;
  const deskMark =
    address || money ? (
      <>
        {address ? <AddressField small onShow={setWatch} /> : null}
        {money}
      </>
    ) : null;

  return (
    <Page>
      <div ref={top}>
        <PageHead title={names.portfolio} tabs={whose ?? (own && owner ? <WalletChip address={owner} /> : null)} mark={deskMark} />
      </div>
      {/* A phone: the page's head shows no mark — the other wallet's address stands right under it. */}
      {address ? (
        <div className={a.phoneOnly}>
          <AddressField small onShow={setWatch} />
        </div>
      ) : null}

      {!address ? (
        <ActionBody>
          <Welcome onShow={setWatch} onConnect={connect} />
        </ActionBody>
      ) : data.read === 'reading' ? (
        <ActionBody>
          <Bones label={w.reading} busy />
        </ActionBody>
      ) : data.read === 'failed' ? (
        <ActionBody>
          <Panel pad="l" edge label={w.unread}>
            <div className={a.blank}>
              <p className={a.blankLine}>{w.unread}</p>
              <Quiet disabled={data.rereading} onClick={data.reread}>
                {w.again}
              </Quiet>
            </div>
          </Panel>
        </ActionBody>
      ) : !held ? (
        <ActionBody side={side} sideLabel={panel ? m.actions : m.recent}>
          <Panel tone={act === null ? 'hi' : 'base'} pad="l" gap={16} edge label={w.total}>
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
                <QuietLink href={moneyHref('receive', sends)}>
                  <Glyph name="receive" />
                  {m.receive}
                </QuietLink>
              </div>
            ) : owner === null ? (
              <Action size="m" full={false} onClick={connect}>
                {w.connect}
              </Action>
            ) : null}
          </Panel>
          {foot}
        </ActionBody>
      ) : (
        <>
          <ActionBody side={side} sideLabel={panel ? m.actions : m.recent}>
            <TotalPanel data={data} />
            {/* A phone: the wallet's own money right under its total, as a wallet app keeps it. */}
            {money ? <div className={a.phoneOnly}>{<MoneyActions amber={act === null && primary === 'topUp'} sends={sends} busy={busy} onTopUp={topUp} phone />}</div> : null}
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
            <Groups data={data} own={own} narrow={narrow} door={door} risk={risk} cleanRead={cleanRead} agents={agents} onTrade={trade} onCollect={(id) => exit('collect', id)} onExit={(id) => exit('exit', id)} onClean={() => open({ kind: 'clean' })} />
            {foot}
          </ActionBody>
          {own ? <ThumbBar offers={offers} primary={barPrimary} busy={busy} /> : owner === null ? <ThumbBar offers={offers} primary={null} busy={busy} connect={connect} /> : null}
        </>
      )}

      {narrow && panel ? (
        <ActSheet label={act?.kind === 'trade' ? act.coin.symbol : act?.kind === 'clean' ? c.title : act?.kind === 'exit' ? w.exitTitle : m.actions} onClose={closeAct}>
          {panel}
        </ActSheet>
      ) : null}
    </Page>
  );
}

/**
 * «Send» and «Receive» are «Money»'s now: an address that still asks the Portfolio for their panel — the old
 * menu's `?act=send`, the agent's «send …», the Swap's old tab — leads on to the same tab of «Money» in one step, the
 * address replaced, so «Back» never returns to a screen that only passed it on. What a sentence wrote into the
 * transfer stays written: it is the money logic's own state.
 */
function useMoneyForward(act: Act | null, sends: boolean): void {
  const router = useRouter();
  const asked = partOf(useAddressTail(), 'act');
  const kind = act?.kind ?? null;
  useEffect(() => {
    const to = forwardOf(asked, sends) ?? forwardOf(kind, sends);
    if (!to) return;
    if (kind === 'send' || kind === 'receive') setAct(null);
    router.replace(to);
  }, [asked, kind, sends, router]);
}

/**
 * «Top up», «Send», «Receive» — the wallet's own money. Quiet beside the three actions; «Top up» is the amber one only
 * when nothing else on the screen is. «Send» and «Receive» lead to «Money»; «Send» only where money may move.
 */
function MoneyActions({ amber, sends, busy, onTopUp, phone = false }: { amber: boolean; sends: boolean; busy: boolean; onTopUp: () => void; phone?: boolean }) {
  const w = useWords(PORTFOLIO);
  if (phone) {
    return (
      <div className={a.moneyRow} role="group" aria-label={w.actions}>
        <button type="button" className={a.moneyKey} data-amber={amber ? '' : undefined} disabled={busy} onClick={onTopUp}>
          <span className={a.moneyMark}>
            <Glyph name="plus" />
          </span>
          {w.topUp}
        </button>
        {sends ? (
          <Link href={moneyHref('send', sends)} className={a.moneyKey}>
            <span className={a.moneyMark}>
              <Glyph name="send" />
            </span>
            {w.send}
          </Link>
        ) : null}
        <Link href={moneyHref('receive', sends)} className={a.moneyKey}>
          <span className={a.moneyMark}>
            <Glyph name="receive" />
          </span>
          {w.receive}
        </Link>
      </div>
    );
  }
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
        <QuietLink href={moneyHref('send', sends)}>
          <Glyph name="send" />
          {w.send}
        </QuietLink>
      ) : null}
      <QuietLink href={moneyHref('receive', sends)}>
        <Glyph name="receive" />
        {w.receive}
      </QuietLink>
    </div>
  );
}

/**
 * The connected wallet at the page's head on a phone, where the frame's own head has no room for it: its address, and a
 * tap opens the wallet's sheet.
 */
function WalletChip({ address }: { address: string }) {
  const w = useWords(PORTFOLIO);
  return (
    <button type="button" className={a.walletChip} aria-label={w.wallet} onClick={() => openPanel('sheet')}>
      <i className={a.walletDot} aria-hidden="true" />
      <span translate="no">{shortAddress(address)}</span>
    </button>
  );
}

/**
 * «History» — where the menu's «History» leads (`#history`): the wallet's swaps, transfers and bridges made in Ryntra,
 * newest first, the engine's own ledger as «Recent» reads it. Another wallet's history from the chain is not read yet:
 * it says so in one line, and how it works waits behind «i».
 */
function History({ own, address, place }: { own: boolean; address: string | null; place: RefObject<HTMLDivElement | null> }) {
  const w = useWords(PORTFOLIO);
  const [how, setHow] = useState(false);
  const howId = useId();
  return (
    <div ref={place} id="history" className={a.history}>
      {own ? (
        <Recent title={w.history} edge />
      ) : (
        <Panel pad="none" edge label={w.history}>
          <div className={a.historyHead}>
            <Kick>{w.history}</Kick>
            <span className={a.grow} />
            <ExplainButton label={w.historyInfo} open={how} controls={howId} onToggle={() => setHow((was) => !was)} />
          </div>
          {how ? (
            <div className={a.groupNote}>
              <ExplainBox id={howId}>{w.historyText}</ExplainBox>
            </div>
          ) : null}
          <p className={a.historyLine}>{address ? w.historyOther : w.historyConnect}</p>
        </Panel>
      )}
    </div>
  );
}
