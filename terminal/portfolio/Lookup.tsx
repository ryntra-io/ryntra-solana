'use client';

import { useState, type FormEvent } from 'react';
import { useWords } from '@/city/lib/i18n/dict';
import { Action, Kick, Panel, Quiet, Search, Title, cx } from '@/terminal/ui';
import { addressOf } from './all-view';
import { ALL } from './all-words';
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

const PARTS = ['pools', 'staking', 'lendingGroup', 'coins', 'agents'] as const;

/**
 * No wallet yet: one panel and one way in (QA 19.11: forty bones that never filled and three tiles that looked like
 * buttons). The screen's promise in one line, what it gathers as a quiet legend — the colours the total will draw — and
 * «Connect wallet», the screen's one amber action; beside it, quieter, any wallet by its address, read only.
 */
export function Welcome({ onShow, onConnect }: { onShow: (address: string) => void; onConnect: () => void }) {
  const w = useWords(ALL);
  return (
    <Panel tone="hi" pad="l" gap={24} edge label={w.lookTitle} className={a.hero}>
      <div className={a.heroTop}>
        <span className={a.heroBadge} aria-hidden="true">
          <Glyph name="wallet" />
        </span>
        <Title as="h2" className={a.heroLine}>
          {w.lookLine}
        </Title>
      </div>
      <ul className={a.parts} aria-label={w.preview}>
        {PARTS.map((id) => (
          <li key={id} className={a.part}>
            <i className={a.dot} data-part={id === 'lendingGroup' ? 'lending' : id} aria-hidden="true" />
            {w[id]}
          </li>
        ))}
      </ul>
      <div className={a.heroRow}>
        <Action size="m" full={false} className={a.heroAct} onClick={onConnect}>
          {w.connect}
        </Action>
        <span className={a.or}>{w.or}</span>
        <AddressField onShow={onShow} />
      </div>
    </Panel>
  );
}

/**
 * The screen's own form while a wallet is read (`busy`): the total and the groups, every figure's place a bone that
 * glides. Nothing in it looks pressable — the actions come with their figures.
 */
export function Bones({ label, busy = false }: { label: string; busy?: boolean }) {
  const w = useWords(ALL);
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
      </Panel>
      {[0, 1].map((group) => (
        <Panel key={group} pad="none" edge className={a.group}>
          <div className={a.groupBody} aria-hidden="true">
            {[0, 1, 2].map((n) => (
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
