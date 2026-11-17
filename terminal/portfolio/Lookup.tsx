'use client';

import { useState, type FormEvent } from 'react';
import { useWords } from '@/city/lib/i18n/dict';
import { Action, Kick, Panel, Quiet, Search, Title, cx } from '@/terminal/ui';
import { addressOf } from './all-view';
import { ALL } from './all-words';
import { CLEAN } from './clean-words';
import { Glyph } from './glyphs';
import a from './all.module.css';

/**
 * «Paste a wallet address»: any wallet on Solana, read only — the address is all the engine's read needs. A link with
 * an address in it is read too; what is not an address is said so in one line, and nothing is asked of the engine.
 */
export function AddressField({ onShow, small = false }: { onShow: (address: string) => void; small?: boolean }) {
  const w = useWords(ALL);
  const [typed, setTyped] = useState('');
  const [bad, setBad] = useState(false);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    const address = addressOf(typed);
    if (!address) {
      setBad(typed.trim().length > 0);
      return;
    }
    setBad(false);
    setTyped('');
    onShow(address);
  };
  // The kit's own field (`Search`): Enter in it sends the form, as «Show» does.
  return (
    <form className={cx(a.lookup, small && a.lookupSmall)} data-bad={bad ? '' : undefined} onSubmit={submit} noValidate>
      <div className={a.lookupRow}>
        <Search
          value={typed}
          placeholder={w.addressField}
          onChange={(text) => {
            setTyped(text);
            if (bad) setBad(false);
          }}
        />
        <Quiet type="submit">{w.show}</Quiet>
      </div>
      {bad ? (
        <p className={a.lookupBad} role="alert">
          {w.badAddress}
        </p>
      ) : null}
    </form>
  );
}

/**
 * No wallet yet: the address field and, beside it, the wallet's own door — the screen's one amber action. Under it the
 * screen stands in its own form with nothing invented in it: the total, the three actions, the groups, each a bone.
 */
export function Welcome({ onShow, onConnect }: { onShow: (address: string) => void; onConnect: () => void }) {
  const w = useWords(ALL);
  return (
    <>
      <Panel tone="hi" pad="l" edge label={w.lookTitle} className={a.hero}>
        <div className={a.heroRow}>
          <Title as="h2" className={a.heroLine}>
            {w.lookLine}
          </Title>
          <AddressField onShow={onShow} />
          <span className={a.or}>{w.or}</span>
          <Action size="m" full={false} className={a.heroAct} onClick={onConnect}>
            {w.connect}
          </Action>
        </div>
      </Panel>
      <Bones label={w.preview} />
    </>
  );
}

const GHOST_GROUPS = ['pools', 'staking', 'lendingGroup', 'coins', 'dust'] as const;
const GHOST_PARTS = ['pools', 'staking', 'lendingGroup', 'coins'] as const;

/**
 * The screen's own form before its figures: while a wallet is read (`busy`), and for a person with no wallet yet — what
 * they will see. Names only; every figure's place is a bone.
 */
export function Bones({ label, busy = false }: { label: string; busy?: boolean }) {
  const w = useWords(ALL);
  const c = useWords(CLEAN);
  return (
    <div className={a.groups} aria-label={label} aria-busy={busy || undefined} role="group">
      <Panel pad="l" gap={16} edge className={a.total}>
        <div className={a.totalMain}>
          <Kick>{w.total}</Kick>
          <span className={cx(a.bone, a.boneBig)} aria-hidden="true" />
        </div>
        <div className={a.bar} aria-hidden="true">
          <i data-part="none" style={{ flexGrow: 1 }} />
        </div>
        <ul className={a.parts}>
          {GHOST_PARTS.map((id) => (
            <li key={id} className={a.part}>
              <i className={a.dot} data-part={id === 'lendingGroup' ? 'lending' : id} aria-hidden="true" />
              {w[id]}
            </li>
          ))}
        </ul>
      </Panel>
      <Panel pad="none" edge className={a.actions}>
        {(
          [
            ['collect', w.collectTitle],
            ['exit', w.exitTitle],
            ['sweep', c.title],
          ] as const
        ).map(([glyph, name]) => (
          <div key={glyph} className={a.action}>
            <span className={a.actionBadge}>
              <Glyph name={glyph} />
            </span>
            <span className={a.actionWords}>
              <b>{name}</b>
            </span>
          </div>
        ))}
      </Panel>
      {GHOST_GROUPS.map((id) => (
        <Panel key={id} pad="none" edge className={a.group}>
          <div className={a.groupHead}>
            <h2 className={a.groupName}>{w[id]}</h2>
          </div>
          <div className={a.groupBody} aria-hidden="true">
            {[0, 1].map((n) => (
              <div key={n} className={a.boneRow}>
                <span className={a.boneDisc} />
                <span className={cx(a.bone, a.boneFill)} style={{ maxWidth: n ? 180 : 240 }} />
                <span className={a.grow} />
                <span className={a.bone} style={{ width: 72 }} />
              </div>
            ))}
          </div>
        </Panel>
      ))}
    </div>
  );
}
