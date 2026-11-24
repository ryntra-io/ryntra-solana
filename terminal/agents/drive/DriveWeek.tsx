'use client';

import { useEffect, useState } from 'react';
import { dateText, useWords } from '@/city/lib/i18n/dict';
import { useLang } from '@/city/lib/i18n/lang';
import { useWallet } from '@/city/lib/trade/wallet';
import { xText } from '@/lib/agent-drive/events';
import { coinName, solPlain, solSigned } from '@/lib/agent-drive/figures';
import { DRIVE_OPEN } from '@/lib/agent-drive/flag';
import { useNarrow } from '@/terminal/shell/useNarrow';
import { Cell, CoinLogo, Icon, Info, Kick, ListRow, Panel, Quiet, Table, TableRow, Tile, Title } from '@/terminal/ui';
import { DriveSettings } from './DriveSettings';
import { readWeekOf, type CardItem, type WeekView } from './read';
import { DRIVE } from './words';
import d from './drive.module.css';

const WHEN: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' };
const CLOSED_COLUMNS = 'minmax(150px, 1.4fr) minmax(80px, auto) minmax(150px, 1.4fr) minmax(110px, 1fr) minmax(44px, auto)';

/** «Share on X» of a closed trade: X's composer with the trade's own words and its card — one tap, she posts it herself. */
export function shareCard(id: string, lang: 'en' | 'uk'): void {
  window.open(`/api/v1/agent-drive/card/${id}/post?l=${lang}`, '_blank', 'noopener,noreferrer');
}

function Closed({ card, narrow }: { card: CardItem; narrow: boolean }) {
  const w = useWords(DRIVE);
  const lang = useLang();
  const coin = coinName(card.coin, lang);
  const tone = BigInt(card.exitRaw) > BigInt(card.entryRaw) ? 'up' : BigInt(card.exitRaw) < BigInt(card.entryRaw) ? 'down' : undefined;
  const share = card.up ? (
    <Quiet size="s" aria-label={w.shareOn(coin)} onClick={() => shareCard(card.id, lang)} data-drive-share={card.id}>
      <Icon name="share" size="s" />
    </Quiet>
  ) : null;
  // A phone's row: the coin and its way, the day and the «×» on the right, «Share» beside it.
  if (narrow) {
    return (
      <div className={d.phoneRow}>
        <ListRow icon={`/api/icon/${card.coin.mint}`} symbol={coin} name={`${solPlain(card.entryRaw, lang)} → ${solPlain(card.exitRaw, lang)} SOL`} value={dateText(card.closedAt, WHEN, lang)} change={card.x === null ? '—' : xText(card.x, lang)} tone={tone} />
        {share}
      </div>
    );
  }
  return (
    <TableRow>
      <Cell className={d.coin}>
        <CoinLogo src={`/api/icon/${card.coin.mint}`} symbol={coin} size="s" />
        <span>{coin}</span>
      </Cell>
      <Cell tone={tone}>{card.x === null ? '—' : xText(card.x, lang)}</Cell>
      <Cell>{`${solPlain(card.entryRaw, lang)} → ${solPlain(card.exitRaw, lang)} SOL`}</Cell>
      <Cell tone="dim">{dateText(card.closedAt, WHEN, lang)}</Cell>
      <Cell end>{share}</Cell>
    </TableRow>
  );
}

/**
 * «This week» under the person's bots: what her agents did over the last seven days — trades, the SOL spent, the result
 * after every fee as their own book counts it — and the trades that closed, each with its «×» and «Share on X» when it
 * came back with more. «Notifications» opens what she hears and where. Nothing without a wallet, or where the drive is
 * not open; a wallet whose agents have not traded this week sees the line and the settings.
 */
export function DriveWeek() {
  const w = useWords(DRIVE);
  const lang = useLang();
  const owner = useWallet((st) => st.connection?.address ?? null);
  const [read, setRead] = useState<Readonly<{ owner: string; value: WeekView }> | null>(null);
  const [open, setOpen] = useState(false);
  const narrow = useNarrow();

  useEffect(() => {
    if (!DRIVE_OPEN || !owner) return;
    let live = true;
    const load = () => void readWeekOf(owner, lang).then((value) => live && value && setRead({ owner, value }));
    load();
    const timer = setInterval(() => document.visibilityState === 'visible' && load(), 60_000);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [owner, lang]);

  if (!DRIVE_OPEN || !owner || read?.owner !== owner) return null;
  const { week, cards } = read.value;
  const result = week?.resultRaw ?? null;
  return (
    <div data-drive-week="">
      <Panel pad="none" label={w.week}>
        <div className={d.head}>
          <Title as="h2" className={d.title}>
            {w.week}
          </Title>
          <Info label={w.week}>{w.weekInfo}</Info>
          <span className={d.grow} />
          <Quiet size="s" aria-expanded={open} onClick={() => setOpen((was) => !was)} data-drive-notify="">
            <Icon name="bell" size="s" />
            {w.notify}
          </Quiet>
        </div>
        {week ? (
          <div className={d.tiles}>
            <Tile label={w.trades} value={week.trades} />
            <Tile label={w.spent} value={solPlain(week.spentRaw, lang)} unit="SOL" />
            <Tile label={w.result} value={result === null ? '—' : solSigned(result, lang).replace(/ SOL$/u, '')} unit={result === null ? undefined : 'SOL'} tone={result === null ? undefined : BigInt(result) > 0n ? 'up' : BigInt(result) < 0n ? 'down' : undefined} />
          </div>
        ) : (
          <p className={d.line}>{w.noMove}</p>
        )}
        {cards.length ? (
          <div className={d.closed}>
            <div className={d.pad}>
              <Kick>{w.closed}</Kick>
            </div>
            {narrow ? (
              cards.map((card) => <Closed key={card.id} card={card} narrow />)
            ) : (
              <Table columns={CLOSED_COLUMNS} minWidth={560} label={w.closed}>
                {cards.map((card) => (
                  <Closed key={card.id} card={card} narrow={false} />
                ))}
              </Table>
            )}
          </div>
        ) : null}
        {open ? <DriveSettings owner={owner} /> : null}
      </Panel>
    </div>
  );
}
