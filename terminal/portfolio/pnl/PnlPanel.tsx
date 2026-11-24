'use client';

import { useCallback, useId, useState } from 'react';
import { dateText, digits, useWords } from '@/city/lib/i18n/dict';
import { useLang } from '@/city/lib/i18n/lang';
import type { Lang } from '@/city/lib/i18n/langs';
import { proveWallet } from '@/city/lib/trade/proof';
import { useWallet } from '@/city/lib/trade/wallet';
import type { PnlCoin, PnlPeriodDays, PortfolioPnl } from '@/lib/portfolio/pnl';
import { ExplainBox, ExplainButton } from '@/terminal/coin/parts';
import { coinHref, shelfHref } from '@/terminal/shell/shelves';
import { useNarrow } from '@/terminal/shell/useNarrow';
import { Cell, CoinCell, Figure, Icon, Kick, ListRow, Panel, Quiet, QuietLink, Table, TableHead, TableRow, Tabs, Tile, cx } from '@/terminal/ui';
import { logosFor } from '../logos';
import { calendarOf, COINS_SHOWN, pctText, pnlShown, solPrice, solText, toneOf, usdAbout, type Calendar, type PnlShown } from './pnl-view';
import { postUrl, shareResult, type ShareCard } from './share';
import { usePnl, type PnlRead } from './usePnl';
import { PNL } from './words';
import p from './pnl.module.css';

/** Where «Share» stands: nothing asked, a card on its way, the card, or one line of why there is none. */
export type ShareState =
  | Readonly<{ status: 'idle' }>
  | Readonly<{ status: 'making' }>
  | Readonly<{ status: 'card'; card: ShareCard }>
  | Readonly<{ status: 'none'; days: PnlPeriodDays }>
  | Readonly<{ status: 'failed' }>;

const DAY_MS = 86_400_000;

/**
 * «Result» on the Portfolio: the wallet's own result after fees for 7 · 30 · 90 days — locked in and unsold
 * apart — the days in the plus and in the minus, each coin's entry and result, and «Share» on the person's own wallet.
 * Every figure is the read of `GET /api/portfolio/pnl` (`lib/portfolio/pnl.ts`, the honest standard); what it does not
 * know is said in one line, how it is counted waits behind «i». A wallet that is only looked at shows its result and
 * nothing to share.
 */
export function PnlPanel({ owner, own }: { owner: string; own: boolean }) {
  const lang = useLang();
  const { read, rereading, reread } = usePnl(owner, own);
  const connection = useWallet((st) => st.connection);
  const [share, setShare] = useState<Readonly<{ owner: string; state: ShareState }> | null>(null);
  const shared = share && share.owner === owner ? share.state : { status: 'idle' as const };

  const onShare = useCallback(
    async (days: PnlPeriodDays) => {
      if (!connection || connection.address !== owner) return;
      setShare({ owner, state: { status: 'making' } });
      const outcome = await shareResult(
        { owner, fromMs: Date.now() - days * DAY_MS, lang },
        {
          prove: async () => {
            const proof = await proveWallet(connection);
            return proof.ok ? { ok: true } : { ok: false, state: proof.state };
          },
          fetch: (url, init) => fetch(url, init),
        },
      );
      if (outcome.ok) setShare({ owner, state: { status: 'card', card: outcome.card } });
      else if (outcome.code === 'DECLINED') setShare({ owner, state: { status: 'idle' } });
      else if (outcome.code === 'NO_SALE') setShare({ owner, state: { status: 'none', days } });
      else setShare({ owner, state: { status: 'failed' } });
    },
    [connection, owner, lang],
  );

  const mayShare = own && connection?.address === owner;
  return <PnlBlock read={read} own={own} rereading={rereading} onReread={reread} share={mayShare ? shared : null} onShare={mayShare ? (days) => void onShare(days) : undefined} onCloseCard={() => setShare({ owner, state: { status: 'idle' } })} />;
}

/**
 * The block itself, from what is read: the kit's stand draws it from fixtures. `share` null — nothing to share here (a
 * wallet only looked at).
 */
export function PnlBlock({
  read,
  own,
  rereading = false,
  onReread,
  share,
  onShare,
  onCloseCard,
  start = 30,
}: {
  read: PnlRead | null;
  own: boolean;
  rereading?: boolean;
  onReread?: () => void;
  share: ShareState | null;
  onShare?: (days: PnlPeriodDays) => void;
  onCloseCard?: () => void;
  start?: PnlPeriodDays;
}) {
  const w = useWords(PNL);
  const lang = useLang();
  const narrow = useNarrow();
  const [days, setDays] = useState<PnlPeriodDays>(start);
  const [all, setAll] = useState(false);
  const [how, setHow] = useState(false);
  const howId = useId();
  const howButton = <ExplainButton label={w.howLabel} open={how} controls={howId} onToggle={() => setHow((was) => !was)} />;

  if (!read || read.status === 'reading') return <Bones label={w.reading} />;
  if (read.status === 'failed') {
    return (
      <Panel pad="l" gap={16} edge label={w.title}>
        <Kick>{w.kick}</Kick>
        <p className={p.line}>
          <span className={p.fail}>{w.unread}</span>
          <Quiet size="s" disabled={rereading} onClick={onReread}>
            {w.again}
          </Quiet>
        </p>
      </Panel>
    );
  }

  const pnl = read.pnl;
  const since = (at: number) => dateText(at * 1000, { day: 'numeric', month: 'short' }, lang);
  const shown = pnlShown(pnl, days);
  if (shown.kind === 'quiet') {
    // Nothing counted yet: one quiet line of why, the rest behind «i» — no figure, no calendar, no table (QA 20.11).
    return (
      <Panel pad="m" gap={12} edge label={w.title} className={p.panel}>
        <div className={p.quiet}>
          <span className={p.kickRow}>
            <Kick>{w.kick}</Kick>
            {howButton}
          </span>
          <span className={p.quietWhy}>{quietLine(shown.state, own, days, w, lang, since)}</span>
          {own && (shown.state.kind === 'nothing' || shown.state.kind === 'empty') ? (
            <QuietLink size="s" href={shelfHref('swap', 'live')}>
              {w.trade}
            </QuietLink>
          ) : null}
        </div>
        {how ? <How id={howId} pnl={pnl} note={quietNote(shown.state, w, lang, since)} /> : null}
      </Panel>
    );
  }

  const period = pnl.periods[shown.days];
  const label = (id: PnlPeriodDays) => (id === 7 ? w.d7 : id === 30 ? w.d30 : w.d90);
  const tabs = shown.periods.map((id) => ({ id: String(id) as `${PnlPeriodDays}`, label: label(id) }));
  const list = shown.coins;
  const coins = all ? list : list.slice(0, COINS_SHOWN);
  const about = usdAbout(period.result, pnl.solUsd, lang);

  return (
    <Panel pad="l" gap={20} edge label={w.title} className={p.panel}>
      <div className={p.head}>
        <span className={p.kickRow}>
          <Kick>{w.kick}</Kick>
          {howButton}
        </span>
        <span className={p.grow} />
        {tabs.length > 1 ? (
          <Tabs bare items={tabs} value={String(shown.days) as `${PnlPeriodDays}`} onChange={(id) => setDays(Number(id) as PnlPeriodDays)} label={w.periods} className={p.tabs} />
        ) : (
          <span className={p.periodOne}>{label(shown.days)}</span>
        )}
        {share && onShare ? (
          <Quiet size="s" disabled={share.status === 'making'} aria-busy={share.status === 'making' || undefined} onClick={() => onShare(shown.days)}>
            <Icon name="share" size="s" />
            {share.status === 'making' ? w.making : w.share}
          </Quiet>
        ) : null}
      </div>
      {how ? <How id={howId} pnl={pnl} /> : null}

      {share?.status === 'card' ? <CardBox card={share.card} onClose={onCloseCard} /> : null}
      {share?.status === 'none' || share?.status === 'failed' ? <p className={p.line}>{share.status === 'none' ? w.noSale(digits(String(share.days), lang)) : w.cardFailed}</p> : null}

      <div className={p.body} data-one={shown.calendar ? undefined : ''}>
        <div className={p.main}>
          <span className={p.figs}>
            <Figure value={solText(period.result, lang, true)} unit="SOL" size="xl" tone={toneOf(period.result)} />
            {period.pct !== null ? <Figure value={pctText(period.pct, lang)} size="s" tone={toneOf(period.pct)} /> : null}
            {about ? <span className={p.about}>{w.about(about)}</span> : null}
          </span>
          <div className={p.facts}>
            <Tile label={w.lockedIn} value={solText(period.realized, lang, true)} tone={toneOf(period.realized)} />
            <Tile label={w.unsold} value={solText(period.unrealized, lang, true)} tone={toneOf(period.unrealized)} />
            <Tile label={w.fees} value={solText(period.fees, lang)} />
          </div>
        </div>
        {shown.calendar ? <Days calendar={calendarOf(pnl.days, shown.days)} lang={lang} /> : null}
      </div>

      {list.length ? (
        <div className={p.coins}>
          <Kick>{pnl.coverage.since !== null ? w.coinsSince(since(pnl.coverage.since)) : w.coins}</Kick>
          {narrow ? (
            <div className={p.list}>
              {coins.map((coin) => (
                <ListRow
                  key={coin.mint}
                  {...logoOf(coin)}
                  symbol={coin.symbol ?? coin.mint.slice(0, 4)}
                  name={coinNote(coin, w, lang)}
                  value={solText(coin.result, lang, true)}
                  change={coin.pct !== null ? pctText(coin.pct, lang) : undefined}
                  tone={toneOf(coin.result)}
                  href={coinHref(coin.mint, 'live')}
                />
              ))}
            </div>
          ) : (
            <Table columns="minmax(184px, 1.7fr) repeat(5, minmax(96px, 1fr))" minWidth={720} label={w.coins}>
              <TableHead>
                <Cell head>{w.coin}</Cell>
                <Cell head end>
                  {w.entry}
                </Cell>
                <Cell head end>
                  {w.now}
                </Cell>
                <Cell head end>
                  {w.lockedIn}
                </Cell>
                <Cell head end>
                  {w.unsold}
                </Cell>
                <Cell head end>
                  {w.result}
                </Cell>
              </TableHead>
              {coins.map((coin) => (
                <TableRow key={coin.mint}>
                  <CoinCell {...logoOf(coin)} symbol={coin.symbol ?? coin.mint.slice(0, 4)} name={coinNote(coin, w, lang, true)} href={coinHref(coin.mint, 'live')} />
                  <Cell end>{solPrice(coin.entry, lang)}</Cell>
                  <Cell end tone="dim">
                    {coin.held > 0 ? solPrice(coin.now, lang) : w.sold}
                  </Cell>
                  <Cell end tone={toneOf(coin.realized)}>
                    {solText(coin.realized, lang, true)}
                  </Cell>
                  <Cell end tone={toneOf(coin.unrealized)}>
                    {coin.held > 0 ? solText(coin.unrealized, lang, true) : '—'}
                  </Cell>
                  <Cell end tone={toneOf(coin.result)}>
                    <span className={p.result}>
                      <b>{solText(coin.result, lang, true)}</b>
                      {coin.pct !== null ? <span>{pctText(coin.pct, lang)}</span> : null}
                    </span>
                  </Cell>
                </TableRow>
              ))}
            </Table>
          )}
          {list.length > COINS_SHOWN ? (
            <Quiet size="s" className={p.more} aria-expanded={all} onClick={() => setAll((was) => !was)}>
              {all ? w.fewer : w.allCoins(digits(String(list.length), lang))}
            </Quiet>
          ) : null}
        </div>
      ) : null}
    </Panel>
  );
}

/**
 * A coin's logo by the Portfolio's own queue (`../logos.ts`, as its coins draw it): the picture the read named first,
 * then SOL's and USDC's own, the engine's logo route and the catalogue's — the ticker's letter only when none loads.
 */
function logoOf(coin: PnlCoin): Readonly<{ icon: string | null; also: readonly string[] }> {
  const queue = [...new Set([...(coin.icon ? [coin.icon] : []), ...logosFor(coin.mint)])];
  return { icon: queue[0] ?? null, also: queue.slice(1) };
}

/** The quiet line's one sentence: why no result is counted yet — what did happen. */
function quietLine(state: Extract<PnlShown, { kind: 'quiet' }>['state'], own: boolean, days: PnlPeriodDays, w: (typeof PNL)['en'], lang: Lang, since: (at: number) => string): string {
  switch (state.kind) {
    case 'nothing':
      return own ? w.emptyOwn : w.emptyOther;
    case 'empty':
      return w.noTrades(digits(String(days), lang));
    case 'skipped':
      return w.skipped;
    case 'older':
      return state.known !== null ? w.olderKnown(since(state.since), solText(state.known, lang, true)) : w.older(since(state.since));
    case 'partial':
      return state.known !== null ? w.partialKnown(digits(`${Math.round(state.pct)}%`, lang), solText(state.known, lang, true)) : w.partial(digits(`${Math.round(state.pct)}%`, lang));
    default:
      return w.skipped;
  }
}

/** Behind «i» of the quiet line: why its figure is no result yet (the line keeps only a name and the figure). */
function quietNote(state: Extract<PnlShown, { kind: 'quiet' }>['state'], w: (typeof PNL)['en'], lang: Lang, since: (at: number) => string): string | null {
  if (state.kind === 'older') return w.howOlder(since(state.since));
  if (state.kind === 'partial') return w.howPartial(digits(`${Math.round(state.pct)}%`, lang));
  return null;
}

/** Under a coin's name: what it is — or, when part of it came or left without a trade, that. */
function coinNote(coin: PnlCoin, w: (typeof PNL)['en'], lang: Lang, desk = false): string {
  if (coin.arrived) return w.arrived;
  if (coin.sent) return w.sent;
  if (desk) return coin.name ?? coin.symbol ?? '';
  return coin.entry !== null ? w.entryLine(solPrice(coin.entry, lang)) : (coin.name ?? '');
}

/** «i»: how the result is counted, and — for this wallet — what the read does not reach. */
function How({ id, pnl, note = null }: { id: string; pnl: PortfolioPnl; note?: string | null }) {
  const w = useWords(PNL);
  const lang = useLang();
  const { coverage } = pnl;
  return (
    <ExplainBox id={id}>
      <span className={p.how}>
        {note ? <span>{note}</span> : null}
        <span>{w.how1}</span>
        <span>{w.how2}</span>
        <span>{w.how3}</span>
        {coverage.since !== null ? <span>{w.howSince(dateText(coverage.since * 1000, { day: 'numeric', month: 'long', year: 'numeric' }, lang))}</span> : null}
        <span>{w.howTransfers}</span>
        {coverage.untraded > 0 ? <span>{w.howUntraded(coverage.untraded)}</span> : null}
        {coverage.approx ? <span>{w.howApprox}</span> : null}
        {coverage.feesEstimated ? <span>{w.howEstimated}</span> : null}
      </span>
    </ExplainBox>
  );
}

/** The period's days: weeks in columns, Monday on top; mint in the plus, flare in the minus, the rest quiet. */
function Days({ calendar, lang }: { calendar: Calendar; lang: Lang }) {
  const w = useWords(PNL);
  const date = (from: number) => dateText(from * 1000, { day: 'numeric', month: 'short', timeZone: 'UTC' }, lang);
  const title = (cell: Calendar['cells'][number]) =>
    cell.verdict === 'UNREAD'
      ? w.dayUnread(date(cell.from))
      : cell.verdict === 'EMPTY'
        ? w.dayEmpty(date(cell.from))
        : cell.result === null
          ? w.dayUnknown(date(cell.from))
          : w.dayResult(date(cell.from), solText(cell.result, lang, true));
  return (
    <div className={p.days}>
      <Kick>{w.days}</Kick>
      <div className={p.grid} data-strip={calendar.strip || undefined} role="img" aria-label={w.calendar(digits(String(calendar.plus), lang), digits(String(calendar.minus), lang))}>
        {calendar.cells.map((cell) => (
          <i key={cell.day} className={p.cell} data-v={cell.verdict} data-l={cell.level || undefined} style={{ gridColumn: cell.col + 1, gridRow: cell.row + 1 }} title={title(cell)} />
        ))}
      </div>
      <span className={p.legend}>
        <span>
          <i className={p.cell} data-v="PLUS" data-l="2" aria-hidden="true" />
          {w.plusDays(digits(String(calendar.plus), lang))}
        </span>
        <span>
          <i className={p.cell} data-v="MINUS" data-l="2" aria-hidden="true" />
          {w.minusDays(digits(String(calendar.minus), lang))}
        </span>
        {calendar.unknown ? (
          <span>
            <i className={p.cell} data-v="UNKNOWN" aria-hidden="true" />
            {w.unknownDays(digits(String(calendar.unknown), lang))}
          </span>
        ) : null}
      </span>
    </div>
  );
}

/** The card of the best sale, as the generator drew it: post it on X, copy its link, or close it. */
function CardBox({ card, onClose }: { card: ShareCard; onClose?: () => void }) {
  const w = useWords(PNL);
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(card.page);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };
  return (
    <div className={p.card}>
      {/* The generator's own picture, drawn once on its page: next/image has no loader for it. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img className={p.cardImage} src={card.image} alt={card.alt} width={1200} height={630} />
      <div className={p.cardSide}>
        <Kick>{w.cardOf(card.symbol)}</Kick>
        <div className={p.cardActs}>
          <Quiet size="s" onClick={() => window.open(postUrl(card), '_blank', 'noopener,noreferrer')}>
            {w.postX}
          </Quiet>
          <Quiet size="s" onClick={() => void copy()}>
            {copied ? w.copied : w.copy}
          </Quiet>
          <Quiet size="s" aria-label={w.closeCard} onClick={onClose}>
            <Icon name="close" size="s" />
          </Quiet>
        </div>
      </div>
    </div>
  );
}

/**
 * The block's frame while it is read: the quiet line's own height — most wallets have no counted result yet (QA 20.11),
 * so the read lands where the frame stood and the panels under it do not jump.
 */
function Bones({ label }: { label: string }) {
  const w = useWords(PNL);
  return (
    <Panel pad="m" gap={12} edge label={label} className={p.panel}>
      <div aria-busy="true" className={p.quiet}>
        <Kick>{w.kick}</Kick>
        <span className={cx(p.bone, p.boneLine)} aria-hidden="true" />
      </div>
    </Panel>
  );
}
