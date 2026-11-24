'use client';

/* eslint-disable @next/next/no-img-element -- the card is the server's own picture of the trade, drawn once and kept. */
import { useRouter } from 'next/navigation';
import { dateText, useWords } from '@/city/lib/i18n/dict';
import { useLang } from '@/city/lib/i18n/lang';
import { xText } from '@/lib/agent-drive/events';
import { coinName, heldText, solPlain } from '@/lib/agent-drive/figures';
import { Action, ActionBody, Kick, Page, PageHead, Panel, Quiet, Tile } from '@/terminal/ui';
import { shareCard } from './DriveWeek';
import { DRIVE } from './words';
import d from './drive.module.css';

const WHEN: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' };

export type XCard = Readonly<{
  id: string;
  coin: Readonly<{ mint: string; symbol: string | null }>;
  entryRaw: string;
  exitRaw: string;
  x: number | null;
  openedAt: number | null;
  closedAt: number;
}>;

/**
 * A closed trade's own page — what a post on X links to, and X shows the card's picture: the card itself, the trade's
 * three facts beside it, «Share on X» for the one who closed it, and one action for whoever came from the post — «Try
 * your own agent». Every figure is the kept card's; nothing on it is promised.
 */
export function XScreen({ card }: { card: XCard }) {
  const w = useWords(DRIVE);
  const lang = useLang();
  const router = useRouter();
  const coin = coinName(card.coin, lang);
  const x = card.x === null ? `${solPlain(card.exitRaw, lang)} SOL` : xText(card.x, lang);
  const held = card.openedAt === null ? null : heldText(card.closedAt - card.openedAt, lang);
  const tone = BigInt(card.exitRaw) > BigInt(card.entryRaw) ? 'up' : BigInt(card.exitRaw) < BigInt(card.entryRaw) ? 'down' : undefined;
  const facts = (
    <Panel gap={12} label={w.closedTrade}>
      <Kick>{dateText(card.closedAt, WHEN, lang)}</Kick>
      <div className={d.factCol}>
        <Tile label={w.entry} value={solPlain(card.entryRaw, lang)} unit="SOL" />
        <Tile label={w.exit} value={solPlain(card.exitRaw, lang)} unit="SOL" tone={tone} />
        {held ? <Tile label={w.held} value={held} /> : null}
      </div>
      <Quiet full onClick={() => shareCard(card.id, lang)} data-drive-share={card.id}>
        {w.share}
      </Quiet>
    </Panel>
  );
  return (
    <Page data-drive-card={card.id}>
      <PageHead title={w.xTitle} />
      <ActionBody side={facts} sideLabel={w.closedTrade}>
        <Panel tone="hi" pad="l" gap={16} label={w.xTitle}>
          <img className={d.card} src={`/api/v1/agent-drive/card/${card.id}?l=${lang}`} alt={w.cardAlt(coin, x)} width={1200} height={675} />
          <Action onClick={() => router.push('/')} data-drive-try="">
            {w.tryOwn}
          </Action>
        </Panel>
      </ActionBody>
    </Page>
  );
}
