'use client';

import { useId, useState } from 'react';
import { num, useWords } from '@/city/lib/i18n/dict';
import { useLang } from '@/city/lib/i18n/lang';
import { pct, span, usd } from '@/city/lib/launch/format';
import { ExplainBox, ExplainButton } from '@/terminal/coin/parts';
import { Icon, Kick, Quiet, cx } from '@/terminal/ui';
import type { LaunchModel } from '../useLaunchModel';
import l from '../launch.module.css';
import { changeRows, setName, sniperText, type Figures } from './sets-view';
import { useSets, type SetsModel } from './useSets';
import { SET_WORDS } from './words';
import c from './sets.module.css';

const FIGURES: Figures = { usd, pct, span };

/**
 * «Start from a set» on the Launch form: one row — its name, the set the form stands on, and «i». Opened, the
 * ready sets this form can launch, the most used first: a tap fills the form in one go. Under the row, what the chosen set
 * changes from the launch the form opens with. At the end of the list, the person may keep the form's settings as a set
 * of their own — their wallet signs a message, no money moves. Shown on the curve only; nothing here launches.
 */
export function StartFromSet({ m }: { m: LaunchModel }) {
  const s = useSets(m);
  const w = useWords(SET_WORDS);
  const lang = useLang();
  const ids = { list: useId(), how: useId() };
  const [open, setOpen] = useState(false);
  const [info, setInfo] = useState(false);
  if (m.format !== 'curve' || s.offered.length === 0) return null;
  const applied = s.applied;
  const changes = applied ? changeRows(applied.terms, s.base, FIGURES) : [];
  const label = { start: w.start, graduation: w.graduation, sniper: w.sniper, creator: w.creatorShare } as const;

  return (
    <div className={c.sets} data-launch-sets={applied ? applied.id : ''}>
      <div className={c.row}>
        <span className={c.name}>{w.fromSet}</span>
        <span className={c.grow} />
        <Quiet size="s" className={c.pick} aria-expanded={open} aria-controls={open ? ids.list : undefined} disabled={s.still} onClick={() => setOpen((was) => !was)} data-launch-sets-pick="">
          <span className={c.pickName}>{applied ? setName(applied, lang) : w.choose}</span>
          <Icon name="chevron" size="s" className={cx(c.chevron, open && c.chevronOpen)} />
        </Quiet>
        <ExplainButton label={w.setInfo} open={info} controls={ids.how} onToggle={() => setInfo((was) => !was)} />
      </div>

      {applied ? (
        <p className={c.changes} data-launch-sets-changes={changes.length}>
          {changes.length === 0 ? (
            <span className={c.same}>{w.same}</span>
          ) : (
            changes.map((row) => (
              <span key={row.field} className={c.change}>
                <span>{label[row.field]}</span>
                <b>{w.change(row.from, row.to)}</b>
              </span>
            ))
          )}
        </p>
      ) : null}

      {info ? <ExplainBox id={ids.how}>{w.setHow}</ExplainBox> : null}

      {open ? (
        <div id={ids.list} className={c.list}>
          <div role="listbox" aria-label={w.sets} className={c.options}>
            {s.offered.map((set) => {
              const chosen = applied?.id === set.id;
              return (
                <button
                  key={set.id}
                  type="button"
                  role="option"
                  aria-selected={chosen}
                  className={c.option}
                  disabled={s.still}
                  onClick={() => {
                    s.apply(set);
                    setOpen(false);
                  }}
                  data-launch-set={set.id}
                >
                  <span className={c.optionWords}>
                    <span className={c.optionHead}>
                      <b>{setName(set, lang)}</b>
                      <span className={c.by}>{set.author ? w.creator : w.ryntra}</span>
                      <span className={c.grow} />
                      {set.uses > 0 ? <span className={c.uses}>{w.launches(set.uses, num(set.uses))}</span> : null}
                    </span>
                    <span className={c.optionLine}>
                      <span>{w.sniper}</span>
                      <b>{sniperText(set.terms, FIGURES)}</b>
                    </span>
                  </span>
                  <span className={c.check} aria-hidden="true">
                    {chosen ? <Icon name="check" size="s" /> : null}
                  </span>
                </button>
              );
            })}
          </div>
          {s.canSave ? <SaveSet m={m} s={s} /> : null}
        </div>
      ) : null}
    </div>
  );
}

/**
 * The form's settings kept as the person's own set: a name, then «Sign and save» — the wallet signs a message, no money
 * moves. Without a wallet, one line says so; the screen's one action stays the launch.
 */
function SaveSet({ m, s }: { m: LaunchModel; s: SetsModel }) {
  const w = useWords(SET_WORDS);
  const id = useId();
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState('');
  const save = s.save;
  if (!m.connection) return <p className={c.note}>{w.connectFirst}</p>;
  if (!naming) {
    return (
      <Quiet
        size="s"
        full
        disabled={s.still}
        onClick={() => {
          s.resetSave();
          setNaming(true);
        }}
        data-launch-sets-save=""
      >
        {save.step === 'saved' ? w.saved : w.save}
      </Quiet>
    );
  }
  const busy = save.step === 'signing';
  return (
    <form
      className={c.save}
      onSubmit={(event) => {
        event.preventDefault();
        void s.saveAs(name).then((after) => {
          // A kept set closes the naming; a refusal keeps the name to change.
          if (after.step === 'saved') setNaming(false);
        });
      }}
      data-launch-sets-naming=""
    >
      <label className={l.field} htmlFor={id}>
        <Kick>{w.setName}</Kick>
        <input
          id={id}
          className={l.text}
          value={name}
          maxLength={32}
          placeholder={w.namePlaceholder}
          autoComplete="off"
          spellCheck={false}
          disabled={busy}
          onChange={(event) => {
            setName(event.target.value);
            if (save.step === 'refused') s.resetSave();
          }}
          data-launch-sets-name=""
        />
      </label>
      <div className={c.saveRow}>
        <Quiet size="s" type="submit" disabled={busy || !name.trim()} aria-busy={busy || undefined}>
          {busy ? w.signing : w.signSave}
        </Quiet>
        <Quiet size="s" disabled={busy} onClick={() => setNaming(false)}>
          {w.cancel}
        </Quiet>
      </div>
      <p className={cx(c.note, save.step === 'refused' && c.refused)} role="status" data-launch-sets-said={save.step}>
        {save.step === 'refused' ? w[save.reason] : w.signLine}
      </p>
    </form>
  );
}
