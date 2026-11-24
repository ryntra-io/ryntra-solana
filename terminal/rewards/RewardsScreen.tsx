'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { useWords } from '@/city/lib/i18n/dict';
import { useLang } from '@/city/lib/i18n/lang';
import { solPrice } from '@/city/lib/scouts/view';
import { useWallet } from '@/city/lib/trade/wallet';
import { useTabInAddress } from '@/terminal/shell/address';
import { openPanel } from '@/terminal/shell/frame';
import { shelfHref } from '@/terminal/shell/shelves';
import { useMarket } from '@/terminal/shell/useMarket';
import { NARROW, useNarrow } from '@/terminal/shell/useNarrow';
import { connectWallet } from '@/terminal/shell/Wallet';
import { MENU_WORDS } from '@/terminal/shell/words';
import { Action, ActionBody, Figure, Info, Kick, Page, PageHead, Panel, Quiet, Tabs, Tile } from '@/terminal/ui';
import { Ask, EarnPanel, Failed, LatestPanel, RankPanel, Reading, SharesPanel, Top } from './parts';
import { PARTNERS_CADENCE, PARTNERS_OFFER, PARTNERS_OPEN, PARTNERS_PAGE } from './partners';
import { useRewardsRead } from './store';
import {
  along,
  countShown,
  latest,
  linkShown,
  rulesLadder,
  rulesShares,
  screenOf,
  shareShown,
  sharesOf,
  solShown,
  tabsShown,
  usdShown,
  type RewardsRead,
  type RewardsScreen as Screen,
  type RewardsTab,
} from './view';
import { REWARDS } from './words';
import r from './rewards.module.css';

const TABS = tabsShown(PARTNERS_OPEN);

/**
 * «Rewards»: the menu's last group as one page with its tabs — «Points» (points,
 * level, place, rank and cashback) and «Invite a friend» (the link to copy and share, who came and what they brought in
 * SOL); «For partners» only while the partner programme is open. Everything is the Growth line's engine, read once for
 * the wallet behind its one signature (`./store.ts`); before a wallet, one line of what earns and «Connect wallet», and
 * the rules beside it. Nothing here pays, binds or changes a rule.
 */
export function RewardsScreen() {
  const w = useWords(REWARDS);
  const menu = useWords(MENU_WORDS);
  const lang = useLang();
  const phone = useNarrow();
  const router = useRouter();
  const [tab, setTab] = useState<RewardsTab>('points');
  // The menu leads to a tab: `/rewards?tab=invite`; every turn of the tabs is written back.
  useTabInAddress(tab, setTab, TABS, 'points');

  const connection = useWallet((st) => st.connection);
  const owner = connection?.address ?? null;
  const status = useRewardsRead((st) => st.status);
  const view = useRewardsRead((st) => st.view);
  const message = useRewardsRead((st) => st.message);
  const solUsd = solPrice(useMarket().towers);
  const [now, setNow] = useState(() => Date.now());

  // Another wallet, or none: the last one's figures go; a wallet whose proof is here is read at once.
  useEffect(() => {
    const store = useRewardsRead.getState();
    if (!owner) {
      store.reset();
      return;
    }
    if (store.owner !== owner) store.reset();
    void store.read(owner, lang);
    setNow(Date.now());
    // The language changes no figure: the read is the wallet's.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [owner]);

  const screen = screenOf(owner, status, view);
  const connect = useCallback(() => {
    // A phone's wallet lives in the frame's own sheet.
    if (window.matchMedia(NARROW).matches) openPanel('sheet');
    connectWallet();
  }, []);
  const prove = useCallback(() => {
    if (connection) void useRewardsRead.getState().prove(connection, lang);
  }, [connection, lang]);
  const again = useCallback(() => {
    if (owner) void useRewardsRead.getState().read(owner, lang, true);
  }, [owner, lang]);

  const friends = view && screen === 'ready' ? view.friends.friends : 0;
  const tabs = (
    <Tabs
      bare
      label={w.views}
      value={tab}
      onChange={setTab}
      items={TABS.map((id) => ({
        id,
        label: menu[id],
        ...(id === 'invite' && friends > 0 ? { count: countShown(friends, lang) } : {}),
      }))}
    />
  );

  return (
    <Page data-rewards-screen="" data-tab={tab} data-state={screen}>
      <PageHead title={menu.rewards} tabs={tabs} />
      {tab === 'points' ? (
        <ActionBody
          side={
            <>
              <RankPanel rank={screen === 'ready' ? (view?.rank ?? null) : null} ladder={screen === 'ready' && view?.rank ? view.rank.ladder : rulesLadder()} />
              <EarnPanel />
            </>
          }
        >
          <PointsMain screen={screen} view={view} solUsd={solUsd} busy={status === 'proving'} message={message} onConnect={connect} onProve={prove} onAgain={again} onTrade={() => router.push(shelfHref('swap', 'live'))} />
          {/* «Activity» stands in every state, «—» until the figures come: the main column ends on the side column's line
              before a wallet as after it (the eyes' pass of 20.11, flaw 131: a 720×340 hole under «Your points» on 1920). */}
          <ActivityPanel figures={screen === 'ready' && view?.points ? { trades: view.points.trades, days: view.points.activeDays, friends: view.friends.friends } : null} />
        </ActionBody>
      ) : tab === 'invite' ? (
        <ActionBody
          side={
            <>
              <SharesPanel shares={screen === 'ready' && view ? sharesOf(view.friends) : rulesShares()} />
              {screen === 'ready' && view ? <LatestPanel rows={latest(view.friends.rows, ['REFERRAL_L1', 'REFERRAL_L2', 'CLAIM'])} solUsd={solUsd} now={now} /> : null}
            </>
          }
        >
          <InviteMain screen={screen} view={view} solUsd={solUsd} busy={status === 'proving'} message={message} phone={phone} onConnect={connect} onProve={prove} onAgain={again} />
        </ActionBody>
      ) : (
        <ActionBody side={<PayoutsPanel />}>
          <PartnersMain onJoin={() => router.push(PARTNERS_PAGE)} />
        </ActionBody>
      )}
    </Page>
  );
}

type MainProps = Readonly<{
  screen: Screen;
  view: RewardsRead | null;
  solUsd: number | null;
  busy: boolean;
  message: string | null;
  onConnect: () => void;
  onProve: () => void;
  onAgain: () => void;
}>;

/**
 * «Points»: the total, the level's span, the place, the cashback and the volume, and the one action — trade. Before a
 * wallet, and before its one signature, the same panel with «—» where the figures will stand (the eyes' pass of 20.11,
 * flaw 99: «Your points» with no figure at all), one line of what it will hold, and the one action — connect, or sign:
 * the panel keeps its height when the figures come.
 */
function PointsMain({ screen, view, solUsd, busy, message, onConnect, onProve, onAgain, onTrade }: MainProps & { onTrade: () => void }) {
  const w = useWords(REWARDS);
  const lang = useLang();
  if (screen === 'failed' || (screen === 'ready' && !view)) return <Failed label={w.yourPoints} onAgain={onAgain} />;
  if (screen === 'reading') return <Reading label={w.yourPoints} />;

  const ready = screen === 'ready' && view ? view : null;
  const points = ready?.points ?? null;
  const cashbackSol = ready ? solShown(ready.friends.cashback, solUsd, lang) : null;
  const next = points?.nextAt ?? null;
  // Before the figures: the one press asks for a wallet, or for the one signature that shows them.
  const ask = screen === 'connect' ? { line: w.pointsPitch, label: w.connect, act: onConnect } : screen === 'prove' ? { line: w.proveLine, label: w.showPoints, act: onProve } : null;
  return (
    <Panel tone="hi" pad="l" gap={24} label={w.yourPoints}>
      <Top label={w.yourPoints}>
        <Info label={w.howPoints}>{w.pointsRules}</Info>
      </Top>
      <div className={r.hero}>
        <Figure size="xl" value={points ? countShown(points.total, lang) : '—'} />
      </div>
      {points ? (
        <div className={r.span}>
          <div className={r.spanEnds}>
            <span>{w.level(countShown(points.level, lang))}</span>
            <span>{next === null ? w.topLevel : w.toLevel(countShown(next - points.total, lang), countShown(points.level + 1, lang))}</span>
          </div>
          <div className={r.track} role="presentation">
            <span className={r.fill} style={{ transform: `scaleX(${along(points.total, points.levelFrom, next)})` }} />
          </div>
        </div>
      ) : ask ? (
        <p className={r.pitch}>{ask.line}</p>
      ) : null}
      <div className={r.tiles}>
        <Tile label={points?.ranked ? w.place(countShown(points.ranked, lang)) : w.placeAlone} value={points?.place ? `#${countShown(points.place, lang)}` : '—'} />
        <Tile label={w.cashback} value={ready ? (cashbackSol ?? usdShown(ready.friends.cashback, lang)) : '—'} unit={cashbackSol ? 'SOL' : undefined} />
        <Tile label={w.volume} value={points?.volume !== null && points?.volume !== undefined ? usdShown(points.volume.toFixed(2), lang) : '—'} />
      </div>
      {ask && message ? <p className={r.bad}>{message}</p> : null}
      <Action busy={ask ? busy : false} disabled={ask ? busy : false} onClick={ask ? ask.act : onTrade}>
        {ask ? ask.label : w.trade}
      </Action>
    </Panel>
  );
}

type Activity = Readonly<{ trades: number; days: number; friends: number }>;

/** What the points came from: the trades, the days traded, the friends who came — «—» until the figures are read. */
function ActivityPanel({ figures }: { figures: Activity | null }) {
  const w = useWords(REWARDS);
  const lang = useLang();
  const shown = (value: number | undefined) => (value === undefined ? '—' : countShown(value, lang));
  return (
    <Panel gap={16} label={w.activity}>
      <Top label={w.activity} />
      <div className={r.tiles}>
        <Tile label={w.trades} value={shown(figures?.trades)} />
        <Tile label={w.activeDays} value={shown(figures?.days)} />
        <Tile label={w.came} value={shown(figures?.friends)} />
      </div>
    </Panel>
  );
}

/** «Invite a friend»: who came and what they brought in SOL, the link, and the one action — copy it; share beside it. */
function InviteMain({ screen, view, solUsd, busy, message, phone, onConnect, onProve, onAgain }: MainProps & { phone: boolean }) {
  const w = useWords(REWARDS);
  const menu = useWords(MENU_WORDS);
  const lang = useLang();
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1_600);
    return () => clearTimeout(timer);
  }, [copied]);

  if (screen === 'connect') return <Ask label={menu.invite} line={w.invitePitch} action={w.connect} onAct={onConnect} />;
  if (screen === 'prove') return <Ask label={menu.invite} line={w.proveLink} action={w.showLink} busy={busy} message={message} onAct={onProve} />;
  if (screen === 'failed' || (screen === 'ready' && !view)) return <Failed label={menu.invite} onAgain={onAgain} />;
  if (screen === 'reading' || !view) return <Reading label={menu.invite} />;

  const f = view.friends;
  const link = f.link;
  const earnedSol = solShown(f.fromFriends, solUsd, lang);
  const copy = async () => {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
    } catch {
      // The browser keeps its clipboard shut: the link stays on screen to select.
    }
  };
  const share = async () => {
    if (!link) return;
    try {
      // A phone's own share sheet; a desk posts to X with the link.
      if (phone && typeof navigator.share === 'function') return await navigator.share({ text: w.post, url: link });
      window.open(`https://x.com/intent/post?text=${encodeURIComponent(w.post)}&url=${encodeURIComponent(link)}`, '_blank', 'noopener,noreferrer');
    } catch {
      // The sheet closed: nothing to say.
    }
  };
  return (
    <Panel tone="hi" pad="l" gap={24} label={menu.invite}>
      <div className={r.pair}>
        <div className={r.fact}>
          <Kick>{w.came}</Kick>
          <Figure size={phone ? 'l' : 'xl'} value={countShown(f.friends, lang)} />
          <span className={r.sub}>{f.friendsOfFriends > 0 ? w.throughThem(countShown(f.friendsOfFriends, lang)) : ' '}</span>
        </div>
        <div className={r.fact}>
          <Kick>{w.earned}</Kick>
          <Figure size={phone ? 'l' : 'xl'} value={earnedSol ?? usdShown(f.fromFriends, lang)} unit={earnedSol ? 'SOL' : undefined} />
          <span className={r.sub}>{earnedSol ? usdShown(f.fromFriends, lang) : ' '}</span>
        </div>
      </div>
      <div className={r.fact}>
        <Kick>{w.yourLink}</Kick>
        <div className={r.link} data-rewards-link="">
          <span className={r.linkText}>{link ? linkShown(link) : '—'}</span>
        </div>
      </div>
      <div className={r.acts}>
        <Action disabled={!link} onClick={() => void copy()} aria-live="polite">
          {copied ? w.copied : w.copy}
        </Action>
        <Quiet disabled={!link} onClick={() => void share()}>
          {w.share}
        </Quiet>
      </div>
    </Panel>
  );
}

/** «For partners», while the programme is open: the partner's share of Ryntra's fee, the friend's discount, one way in. */
function PartnersMain({ onJoin }: { onJoin: () => void }) {
  const w = useWords(REWARDS);
  const phone = useNarrow();
  const menu = useWords(MENU_WORDS);
  const lang = useLang();
  const offer = PARTNERS_OFFER;
  if (!offer) return null;
  return (
    <Panel tone="hi" pad="l" gap={24} label={menu.partners}>
      <Top label={w.partnerShare} />
      <div className={r.pair}>
        <div className={r.fact}>
          <Kick>{w.partnerFirst(offer.firstDays)}</Kick>
          <Figure size={phone ? 'l' : 'xl'} value={shareShown(offer.firstPercent, lang)} />
        </div>
        <div className={r.fact}>
          <Kick>{offer.lifetime ? w.partnerAfter : w.partnerAfterDays}</Kick>
          <Figure size={phone ? 'l' : 'xl'} value={shareShown(offer.afterPercent, lang)} />
        </div>
      </div>
      <div className={r.tiles}>
        <Tile label={w.partnerDiscount} value={shareShown(offer.discountPercent, lang)} />
      </div>
      <Action onClick={onJoin}>{w.partnerJoin}</Action>
    </Panel>
  );
}

/** How a partner is paid: from how much, in what, how often — the same terms the partner page prints. */
function PayoutsPanel() {
  const w = useWords(REWARDS);
  const lang = useLang();
  const offer = PARTNERS_OFFER;
  if (!offer) return null;
  const rows = [
    { key: 'from', name: w.payoutFrom, value: usdShown(offer.minimumUsd.toFixed(2), lang) },
    { key: 'in', name: w.payoutIn, value: offer.asset },
    ...(PARTNERS_CADENCE ? [{ key: 'when', name: w.payoutWhen, value: PARTNERS_CADENCE === 'weekly' ? w.weekly : w.monthly }] : []),
  ];
  return (
    <Panel gap={12} label={w.payouts}>
      <Top label={w.payouts} />
      <div className={r.rows}>
        {rows.map((row) => (
          <div key={row.key} className={r.row}>
            <span className={r.rowName}>{row.name}</span>
            <span className={r.rowValue}>{row.value}</span>
          </div>
        ))}
      </div>
    </Panel>
  );
}
