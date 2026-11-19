'use client';

import { useWords } from '@/city/lib/i18n/dict';
import { grouped } from '@/city/lib/money/recipient';
import { BRIDGE_PATH } from '@/terminal/shell/shelves';
import { Action, Chip, Icon, Kick, QuietLink } from '@/terminal/ui';
import { Qr, useCopy } from './parts';
import { MONEY_WORDS } from './words';
import m from './money.module.css';

/**
 * «Receive»: the wallet's own Solana address, whole and as a QR, and one copy — the screen's one amber press. From
 * another network the money comes over the bridge (`/bridge`, Relay), a quiet door where the bridge is open. Nothing
 * here signs, asks the engine or moves anything. Without a wallet the tab is «Money»'s own blank (`NoWallet.tsx`).
 *
 * The address reads in its groups of four, four groups a line, and a line never breaks inside a group: a
 * person checks it against what they paste by those groups.
 */
/** The grouped address as its lines: four groups of four a line, one space between them. */
function lines(groupedAddress: string): string[] {
  const groups = groupedAddress.split(' ');
  const out: string[] = [];
  for (let at = 0; at < groups.length; at += 4) out.push(groups.slice(at, at + 4).join(' '));
  return out;
}

export function Receive({ owner, bridge }: { owner: string; bridge: boolean }) {
  const w = useWords(MONEY_WORDS);
  const [copied, copy] = useCopy();
  return (
    <>
      <div className={m.receive}>
        <Qr value={owner} label={w.addressQr} />
        <div className={m.receiveWords}>
          <Kick>{w.yourAddress}</Kick>
          <p className={m.address} translate="no">
            {lines(grouped(owner)).map((line) => (
              <span key={line}>{line}</span>
            ))}
          </p>
          <div className={m.chips}>
            <Chip dot>{w.solanaOnly}</Chip>
          </div>
          <p className={m.line}>{w.receiveLine}</p>
        </div>
      </div>
      <div className={m.grow} />
      {bridge ? (
        <QuietLink href={BRIDGE_PATH} className={m.door}>
          {w.fromNetwork}
          <Icon name="arrow" size="s" />
        </QuietLink>
      ) : null}
      <Action onClick={() => copy(owner)}>{copied === owner ? w.copied : w.copyAddress}</Action>
    </>
  );
}
