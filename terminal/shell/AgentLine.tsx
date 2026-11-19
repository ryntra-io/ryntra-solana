'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { isCommandKey, typingIn } from '@/city/lib/command/keys';
import { funnelSay } from '@/city/lib/crew/funnel-say';
import { COMMAND_MAX } from '@/city/lib/command/parse';
import { useWords } from '@/city/lib/i18n/dict';
import { useLang } from '@/city/lib/i18n/lang';
import { Icon } from '@/terminal/ui';
import { askLabel } from './ask-label';
import { useAsk } from './ask';
import { clearClarify, useAskNote } from './ask-note';
import { closePanel } from './frame';
import { useAskRows, useSay } from './say';
import { useNarrow, useTiny } from './useNarrow';
import { SHELL } from './words';
import s from './shell.module.css';

/**
 * «Tell your agent what to do» — in the header of every screen. Ctrl K (⌘K on a Mac) from anywhere but another field
 * puts the keyboard here. As the person types, the rows under the line say what the agent will do — the city's own
 * reading of the sentence, each row a shelf that is on; Enter or a tap opens that shelf with the sentence handed over.
 * The line opens and fills; it never signs.
 */
export function AgentLine() {
  const w = useWords(SHELL);
  const lang = useLang();
  const narrow = useNarrow();
  const tiny = useTiny();
  const [text, setText] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [mac, setMac] = useState(false);
  const field = useRef<HTMLInputElement>(null);
  const list = useId();
  const rows = useAskRows(text);
  const say = useSay();
  // The agent reading a sentence through the model, or its «Уточни: …» for the sentence kept in the line.
  const reading = useAsk((st) => st.reading);
  const clarify = useAsk((st) => st.clarify);
  const note = useAskNote();
  const shown = open && rows.length > 0 && !note;
  const at = Math.min(active, Math.max(0, rows.length - 1));

  useEffect(() => setMac(/Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent)), []);
  useEffect(() => setActive(0), [text]);

  // «Уточни: …»: the sentence comes back to the line, the keyboard with it, so the person says it again in place.
  useEffect(() => {
    if (!clarify) return;
    setText(clarify.said);
    setOpen(true);
    field.current?.focus();
  }, [clarify]);

  // A screen's own «Say it to your agent»: the sentence's start stands in the line, the keyboard with it, and
  // the person finishes it here — the same line, the same reading.
  const begun = useAsk((st) => st.begun);
  useEffect(() => {
    if (!begun) return;
    useAsk.setState({ begun: null });
    clearClarify();
    setText(begun.said);
    setOpen(true);
    const input = field.current;
    if (!input) return;
    input.focus();
    input.setSelectionRange(begun.said.length, begun.said.length);
  }, [begun]);

  // Ctrl K or ⌘K: into the line from anywhere but another field; pressed in the line, out of it.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!isCommandKey(event) || event.repeat) return;
      // The home page's own field stands in for the header's line there (shell.module.css): pressed in it, out of it.
      const own = field.current?.offsetParent ? null : document.querySelector<HTMLInputElement>("[data-terminal='hero'] input");
      if (own && document.activeElement === own) {
        event.preventDefault();
        own.blur();
        return;
      }
      if (typingIn(event.target)) return;
      event.preventDefault();
      if (document.activeElement === field.current) {
        field.current?.blur();
        return;
      }
      closePanel();
      if (own) {
        own.focus();
        return;
      }
      field.current?.focus();
      setOpen(true);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);

  const go = (index: number) => {
    // No row the line's own rules can open is still a sentence: the model may read it (`useSay`).
    if (!say(text, rows[index])) return;
    funnelSay('agent_said');
    setText('');
    setOpen(false);
    field.current?.blur();
  };

  return (
    <div className={s.say} data-city-command="">
      <label className={s.sayBox}>
        <Icon name="agents" />
        <input
          ref={field}
          className={s.sayInput}
          type="text"
          role="combobox"
          aria-label={w.say}
          aria-expanded={shown}
          aria-controls={list}
          aria-autocomplete="list"
          aria-activedescendant={shown ? `${list}-${at}` : undefined}
          placeholder={narrow ? (tiny ? w.sayTiny : w.sayShort) : w.say}
          value={text}
          maxLength={COMMAND_MAX}
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          enterKeyHint="go"
          onFocus={() => {
            setOpen(true);
            // The first screen's one action, and the line where a sentence is said.
            funnelSay('agent_hint');
            funnelSay('agent_line');
          }}
          onBlur={() => setOpen(false)}
          onChange={(event) => {
            setText(event.target.value);
            setOpen(true);
            clearClarify();
          }}
          onKeyDown={(event) => {
            if (event.key === 'ArrowDown' && rows.length) {
              event.preventDefault();
              setActive((at + 1) % rows.length);
            } else if (event.key === 'ArrowUp' && rows.length) {
              event.preventDefault();
              setActive((at - 1 + rows.length) % rows.length);
            } else if (event.key === 'Enter') {
              event.preventDefault();
              go(at);
            } else if (event.key === 'Escape') {
              event.preventDefault();
              event.stopPropagation();
              if (text) setText('');
              else field.current?.blur();
            }
          }}
        />
        <span className={s.key} aria-hidden="true">
          {w.key(mac)}
        </span>
      </label>
      <div className={s.rows} role="status" aria-live="polite" hidden={!(open || reading) || !note}>
        {note ? (
          <div className={`${s.row} ${s.note}`}>
            <Icon name="agents" />
            <span>{note}</span>
          </div>
        ) : null}
      </div>
      <div id={list} role="listbox" aria-label={w.rows} className={s.rows} hidden={!shown}>
        {rows.map((row, index) => (
          <div
            key={row.key}
            id={`${list}-${index}`}
            role="option"
            aria-selected={index === at}
            className={s.row}
            onMouseDown={(event) => event.preventDefault()}
            onMouseEnter={() => setActive(index)}
            onClick={() => go(index)}
          >
            <Icon name={row.target.shelf} />
            <span>{askLabel(row.command, lang)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
