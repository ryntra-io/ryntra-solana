'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { digits, useWords } from '@/city/lib/i18n/dict';
import { useLang } from '@/city/lib/i18n/lang';
import { useWallet } from '@/city/lib/trade/wallet';
import { useTabInAddress } from '@/terminal/shell/address';
import { useNarrow } from '@/terminal/shell/useNarrow';
import { ActionBody, Chip, Icon, Info, Page, PageHead, Panel, Quiet, Tabs, Title, cx } from '@/terminal/ui';
import { AlertForm, AlertList } from './Alerts';
import { useAlerts } from './alerts-store';
import { useFollows, type ListNote } from './follows';
import { AddWallet, RowBones, Trades, agoText, symbolOf } from './parts';
import { useListReadState, useWalletsRead } from './wallet-reads';
import { feedOf, FOLLOW_LIMIT, shortAddress, walletHref, type Follow, type WalletRead } from './watch-view';
import { ALERT_WORDS, WATCH_WORDS } from './words';
import v from './watch.module.css';

const TABS = ['wallets', 'alerts'] as const;
type WatchTab = (typeof TABS)[number];

/** A phone shows the newest trades of the feed; a desk, more. */
const PHONE_ROWS = 20;

type W = (typeof WATCH_WORDS)['en'];

function noteWords(note: ListNote, w: W, limit: string): string | null {
  if (note === 'declined') return w.declined;
  if (note === 'failed') return w.failed;
  if (note === 'full') return w.full(limit);
  if (note === 'bad') return w.badAddress;
  if (note === 'noCreator') return w.noCreator;
  return null;
}

/** One watched wallet in the list: its name, its last trade, and one tap off the list. */
function WalletRow({ follow, read, now }: { follow: Follow; read: WalletRead | null; now: number }) {
  const w = useWords(WATCH_WORDS);
  const lang = useLang();
  const name = follow.name ?? shortAddress(follow.address);
  const last = read?.trades[0] ?? null;
  return (
    <li className={v.walletRow}>
      <span className={v.walletMain}>
        <Link href={walletHref(follow.address)} className={v.walletName} aria-label={w.openOne(name)}>
          {name}
        </Link>
        <span className={v.walletSub}>
          {follow.name ? <span>{shortAddress(follow.address)}</span> : null}
          {last ? (
            <span>
              <span data-side={last.side} className={v.side}>
                {w.lastTrade(last.side === 'buy' ? w.bought : w.sold, symbolOf(last))}
              </span>{' '}
              · {agoText(last.at, now, w, lang)}
            </span>
          ) : read ? (
            <span>{w.quiet}</span>
          ) : null}
        </span>
      </span>
      <Quiet size="s" className={v.iconButton} aria-label={w.removeOne(name)} onClick={() => void useFollows.getState().remove(follow.address, lang)}>
        <Icon name="close" size="s" />
      </Quiet>
    </li>
  );
}

/**
 * «Watch»: the wallets a person watches and what they buy and sell — each trade with «Buy», which opens the coin's own
 * ticket — and the coins' alerts, «tell me when the price or the cap crosses X». The list lives in this browser without
 * a wallet and with the wallet once it proves itself; the alerts are the person's, behind that proof. Nothing here
 * signs a transaction, sends or trades: «Buy» is the coin page's form.
 */
export function WatchScreen() {
  const w = useWords(WATCH_WORDS);
  const a = useWords(ALERT_WORDS);
  const lang = useLang();
  const phone = useNarrow();
  const [tab, setTab] = useState<WatchTab>('wallets');
  useTabInAddress(tab, setTab, TABS, 'wallets');

  const connection = useWallet((st) => st.connection);
  const owner = connection?.address ?? null;
  const list = useFollows((st) => st.list);
  const mode = useFollows((st) => st.mode);
  const listStatus = useFollows((st) => st.status);
  const note = useFollows((st) => st.note);
  const hydrated = useFollows((st) => st.read);
  const alertsStatus = useAlerts((st) => st.status);
  const alertsView = useAlerts((st) => st.view);
  const alertsMessage = useAlerts((st) => st.message);
  const [adding, setAdding] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => useFollows.getState().hydrate(), []);
  // The list and the alerts follow the connected wallet; a wallet whose proof is here is read at once, none is asked.
  useEffect(() => {
    void useFollows.getState().follow(owner, lang);
    if (owner) void useAlerts.getState().read(owner, lang);
    else useAlerts.getState().reset();
    // The language changes no list.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [owner]);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 15_000);
    return () => window.clearInterval(timer);
  }, []);

  const addresses = useMemo(() => list.map((row) => row.address), [list]);
  const reads = useWalletsRead(tab === 'wallets' ? addresses : [], 60_000);
  const readState = useListReadState(addresses);
  const feed = useMemo(() => feedOf(list, reads), [list, reads]);
  const limit = digits(String(FOLLOW_LIMIT), lang);
  const noteText = noteWords(note, w, limit);

  const add = async (address: string) => {
    setAdding(true);
    await useFollows.getState().add(address, null, lang, w.creatorOf);
    setAdding(false);
  };
  const keep = () => {
    if (connection) void useFollows.getState().keep(connection, lang);
  };
  const proveAlerts = () => {
    if (connection) void useAlerts.getState().prove(connection, lang);
  };
  const removeAlert = (id: string) => {
    if (connection) void useAlerts.getState().remove(connection, lang, id);
  };

  const alertsCount = alertsView?.rows.length ?? 0;
  const tabs = (
    <Tabs
      bare
      label={w.tabs}
      value={tab}
      onChange={setTab}
      items={[
        { id: 'wallets', label: w.wallets, ...(list.length > 0 ? { count: digits(String(list.length), lang) } : {}) },
        { id: 'alerts', label: w.alerts, ...(alertsCount > 0 ? { count: digits(String(alertsCount), lang) } : {}) },
      ]}
    />
  );

  const empty = hydrated && list.length === 0 && listStatus !== 'reading';
  const rows = phone ? feed.slice(0, PHONE_ROWS) : feed;

  const listPanel = (
    <Panel tone="hi" pad="l" gap={16} edge className={v.listPanel}>
      <div className={v.panelTop}>
        <Title as="h2" className={v.panelTitle}>
          {w.yours}
        </Title>
        <span className={v.grow} />
        <span className={v.dim}>{`${digits(String(list.length), lang)}/${limit}`}</span>
      </div>
      <AddWallet onAdd={(address) => void add(address)} busy={adding} note={noteText} />
      <ul className={v.walletRows} aria-label={w.yours}>
        {list.map((follow) => (
          <WalletRow key={follow.address} follow={follow} read={reads.get(follow.address) ?? null} now={now} />
        ))}
      </ul>
      <div className={v.panelFoot}>
        <Chip dot tone={mode === 'server' ? 'ok' : 'plain'}>
          {mode === 'server' ? w.withWallet : w.inBrowser}
        </Chip>
        <span className={v.grow} />
        {mode === 'local' && connection && (listStatus === 'proof' || listStatus === 'proving') ? (
          <Quiet size="s" onClick={keep} disabled={listStatus === 'proving'}>
            {w.keep}
          </Quiet>
        ) : null}
        <Info label={w.howList}>{w.howListText}</Info>
      </div>
    </Panel>
  );

  return (
    <Page data-watch-screen={tab} data-state={tab === 'wallets' ? (empty ? 'empty' : feed.length > 0 ? 'live' : 'reading') : alertsStatus}>
      <PageHead title={w.title} tabs={tabs} />
      {tab === 'wallets' ? (
        empty ? (
          // Nothing watched yet: one card — the name and its «i», one line, one field, one press. A card, not a panel from edge
          // to edge: on a phone it keeps the page's gutter and its frame.
          <ActionBody>
            <Panel tone="hi" pad="l">
              <div className={v.emptyBody}>
                <div className={v.emptyLead}>
                  <span className={v.emptySign} aria-hidden="true">
                    <Icon name="wallet" size="l" />
                  </span>
                  <div className={v.emptyWords}>
                    <div className={v.emptyName}>
                      <Title as="h2" className={v.panelTitle}>
                        {w.emptyTitle}
                      </Title>
                      <Info label={w.howList}>{w.howListText}</Info>
                    </div>
                    <p className={v.line}>{w.emptyLine}</p>
                  </div>
                </div>
                <AddWallet onAdd={(address) => void add(address)} busy={adding} note={noteText} />
              </div>
            </Panel>
          </ActionBody>
        ) : (
          <ActionBody className={v.feedBody} side={listPanel} sideLabel={w.yours}>
            <Panel pad="none" edge className={v.feedPanel}>
              <div className={v.panelHead}>
                <Title as="h2" className={v.panelTitle}>
                  {w.feed}
                </Title>
                <span className={v.grow} />
                {readState.failed > 0 && !readState.reading ? <span className={v.dim}>{w.busy}</span> : null}
              </div>
              {rows.length > 0 ? (
                <Trades rows={rows} now={now} lang={lang} phone={phone} label={w.feed} />
              ) : readState.answered < addresses.length || listStatus === 'reading' ? (
                <div className={v.pad}>
                  <RowBones label={w.feedReading} />
                </div>
              ) : (
                <p className={cx(v.line, v.pad)}>{w.feedEmpty}</p>
              )}
            </Panel>
          </ActionBody>
        )
      ) : (
        <ActionBody
          side={
            <Panel pad="l" gap={16} edge className={v.alertsPanel}>
              <Title as="h2" className={v.panelTitle}>
                {a.yours}
              </Title>
              {!owner ? (
                <p className={v.line}>{a.connectLine}</p>
              ) : alertsStatus === 'proof' || alertsStatus === 'proving' ? (
                <div className={v.proof}>
                  <p className={v.line}>{alertsMessage ?? a.proofLine}</p>
                  <Quiet onClick={proveAlerts} disabled={alertsStatus === 'proving'}>
                    {a.prove}
                  </Quiet>
                </div>
              ) : !alertsView && alertsStatus === 'failed' ? (
                <div className={v.failRow}>
                  <span className={v.line}>{a.unread}</span>
                  <Quiet size="s" onClick={() => owner && void useAlerts.getState().read(owner, lang, true)}>
                    {a.again}
                  </Quiet>
                </div>
              ) : !alertsView ? (
                <RowBones n={3} label={a.yours} />
              ) : (
                <AlertList onRemove={removeAlert} />
              )}
            </Panel>
          }
          sideLabel={a.yours}
        >
          <Panel tone="hi" pad="l" gap={16} edge className={v.formPanel}>
            <Title as="h2" className={v.panelTitle}>
              {a.newAlert}
            </Title>
            <AlertForm />
          </Panel>
        </ActionBody>
      )}
    </Page>
  );
}
