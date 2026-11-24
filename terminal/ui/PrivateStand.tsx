'use client';

import { useMemo } from 'react';

import { useWords } from '@/city/lib/i18n/dict';
import type { BandAction } from '@/lib/privacy/exposure';
import { Action } from './buttons';
import { ActionBody, Page, PageHead } from './Page';
import { Panel } from './Panel';
import { Kick } from './Type';
import { PrivacyBand, PrivacyCount, type CountState } from './PrivacyBand';
import { PrivacyToggle } from './PrivacyToggle';
import { PRIVATE_KIT_STAND } from './words';
import p from './private.module.css';

const ACTIONS: readonly BandAction[] = ['hide', 'return', 'send', 'payout', 'invoice', 'swap', 'routeSwap'];
const nothing = () => undefined;

/**
 * The private kit's stand for the eyes (`/terminal/kit/private`, a stand with the private mode open): the
 * toggle in the page's head as a screen will mount it, the toggle off, on and remembered; the band before each of the seven
 * actions and before a public send; the band in an action panel above the amber button, its viewers open; the ring's
 * counter reading, read, unread and live. Nothing here signs or sends.
 */
export function PrivateStand() {
  const w = useWords(PRIVATE_KIT_STAND);
  const read = useMemo<CountState>(() => ({ state: 'read', count: { network: 'devnet', lamports: '12480000000', balances: 37, readAt: new Date().toISOString() } }), []);
  return (
    <Page data-private-stand="">
      <PageHead title={w.page} mode={<PrivacyToggle scope="kit-stand" />} />
      <ActionBody
        side={
          <Panel tone="hi" gap={14} label={w.send}>
            <Kick>{w.send}</Kick>
            <PrivacyBand action="send" expanded count={read} />
            <Action>{w.action}</Action>
          </Panel>
        }
      >
        <Panel gap={12} label={w.toggle}>
          <Kick>{w.toggle}</Kick>
          <div className={p.standRow}>
            <span className={p.standItem}>
              <span className={p.standName}>{w.off}</span>
              <PrivacyToggle scope="kit-off" on={false} onChange={nothing} />
            </span>
            <span className={p.standItem}>
              <span className={p.standName}>{w.on}</span>
              <PrivacyToggle scope="kit-on" on onChange={nothing} />
            </span>
            <span className={p.standItem}>
              <span className={p.standName}>{w.live}</span>
              <PrivacyToggle scope="kit-live" />
            </span>
          </div>
        </Panel>
        {ACTIONS.map((action) => (
          <Panel key={action} gap={12} label={w[action]}>
            <Kick>{w[action]}</Kick>
            <PrivacyBand action={action} count={read} />
          </Panel>
        ))}
        <Panel gap={12} label={w.publicSend}>
          <Kick>{w.publicSend}</Kick>
          <PrivacyBand action="send" mode="open" />
        </Panel>
        <Panel gap={12} label={w.count}>
          <Kick>{w.count}</Kick>
          <div className={p.standCounts}>
            <span className={p.standCount} data-count="reading">
              <span className={p.standName}>{w.countReading}</span>
              <PrivacyCount given={{ state: 'reading' }} />
            </span>
            <span className={p.standCount} data-count="read">
              <span className={p.standName}>{w.countRead}</span>
              <PrivacyCount given={read} />
            </span>
            <span className={p.standCount} data-count="none">
              <span className={p.standName}>{w.countEmpty}</span>
              <PrivacyCount given={{ state: 'read', count: null }} />
            </span>
            <span className={p.standCount} data-count="live">
              <span className={p.standName}>{w.countLive}</span>
              <PrivacyCount />
            </span>
          </div>
        </Panel>
      </ActionBody>
    </Page>
  );
}
