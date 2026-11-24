'use client';

import Link from 'next/link';
import { useWords } from '@/city/lib/i18n/dict';
import { useLang } from '@/city/lib/i18n/lang';
import { CoinSearch, LostDoors } from '@/terminal/shell/lost/Lost';
import { LOST_WORDS } from '@/terminal/shell/lost/words';
import { shelfHref } from '@/terminal/shell/shelves';
import { ActionBody, Page, PageHead, Panel, Quiet } from '@/terminal/ui';
import ui from '@/terminal/ui/ui.module.css';
import { COIN } from './words';
import u from './coin.module.css';

/** What a coin's address came to before its screen: still asked, read as no coin, or not read at all. */
export type CoinLook = 'looking' | 'none' | 'failed';

/**
 * A coin's screen with no coin to draw (flaw 64: a real coin, its source silent, read «Coin not found»). Three
 * honest states on the template's action page: the address still asked (the head and a frame of the same height);
 * the engine answered and names no coin there — «not found», a coin search and the way back; the engine did not
 * answer — «couldn't read», a quiet «Try again» that asks again, and the same ways on. The sections stand beside as
 * quiet doors, as on the page that is not one.
 */
export function CoinLost({ look, onRetry }: { look: CoinLook; onRetry: () => void }) {
  const w = useWords(COIN);
  const lw = useWords(LOST_WORDS);
  const lang = useLang();
  if (look === 'looking') {
    return (
      <Page>
        <PageHead title={w.looking} />
        <ActionBody>
          <Panel pad="l">
            <div className={u.lostWait} aria-busy="true" role="status" aria-label={w.looking} />
          </Panel>
        </ActionBody>
      </Page>
    );
  }
  const failed = look === 'failed';
  return (
    <Page data-coin-lost={look}>
      <PageHead title={failed ? w.unread : w.notFound} />
      <ActionBody side={<LostDoors />} sideLabel={lw.sections}>
        <Panel tone="hi" pad="l">
          <div className={u.lost} role={failed ? 'alert' : 'status'}>
            <p className={u.lostLine}>{failed ? w.unreadLine : w.notFoundLine}</p>
            {failed ? (
              <Quiet onClick={onRetry} data-coin="retry-coin">
                {w.again}
              </Quiet>
            ) : (
              <CoinSearch lang={lang} />
            )}
            <Link href={shelfHref('market', 'live')} className={ui.act} prefetch={false}>
              {w.toMarket}
            </Link>
          </div>
        </Panel>
      </ActionBody>
    </Page>
  );
}
