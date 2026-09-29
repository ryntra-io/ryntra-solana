"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { MagnifyingGlass } from "@phosphor-icons/react";

import { commandsFor, searchCommands, type CommandEntry } from "@/lib/home/palette/commands";
import styles from "./command-palette.module.css";

/**
 * The command palette — ⌘K, and nothing else.
 *
 * A palette is the most natural place in an application to put a verb one
 * keystroke from anywhere, with none of the context that made the verb safe.
 * This one navigates and only navigates: `lib/home/palette/commands.ts` holds a
 * frozen index of routes, a test refuses any entry carrying an action verb, and
 * this component has no code path that does anything but `router.push`.
 *
 * Three keyboard details that are the difference between a palette somebody
 * uses and one they open once:
 *
 *   **Focus returns.** Whatever was focused when the palette opened is focused
 *   again when it closes without navigating. A palette that drops you at the
 *   top of the document has cost you your place.
 *
 *   **The active row follows the arrows, not the mouse.** Hovering does not
 *   move the selection, because a reader arrowing down while the cursor happens
 *   to rest over the list would otherwise fight it.
 *
 *   **The list is a listbox, the input owns the focus.** Arrow keys never leave
 *   the field, so typing and moving are the same gesture; `aria-activedescendant`
 *   is what tells a screen reader which row is current.
 */
export function CommandPalette({ hasSession }: { hasSession: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const restoreRef = useRef<HTMLElement | null>(null);
  const listRef = useRef<HTMLUListElement | null>(null);

  const index = useMemo(() => commandsFor({ hasSession }), [hasSession]);
  const results = useMemo(() => searchCommands(index, query), [index, query]);

  const close = useCallback(() => {
    setOpen(false);
    setQuery("");
    setActive(0);
    const restore = restoreRef.current;
    restoreRef.current = null;
    if (restore && document.contains(restore)) restore.focus();
  }, []);

  const go = useCallback((command: CommandEntry) => {
    setOpen(false);
    setQuery("");
    setActive(0);
    restoreRef.current = null;
    router.push(command.href);
  }, [router]);

  /* One global shortcut, and the standard one on both platforms. It is
     deliberately not bound while a text field elsewhere has focus with a
     modifier-free key: ⌘K / Ctrl+K cannot collide with typing. */
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setOpen((current) => {
          if (!current) restoreRef.current = document.activeElement as HTMLElement | null;
          return !current;
        });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const row = listRef.current?.querySelector<HTMLElement>('[data-active="true"]');
    row?.scrollIntoView({ block: "nearest" });
  }, [open, active, results]);

  const onFieldKey = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      close();
      return;
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActive((current) => (results.length === 0 ? 0 : (current + 1) % results.length));
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      setActive((current) => (results.length === 0 ? 0 : (current - 1 + results.length) % results.length));
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      const command = results[active];
      if (command) go(command);
    }
  };

  return (
    <>
      <button
        type="button"
        className={styles.trigger}
        onClick={() => {
          restoreRef.current = document.activeElement as HTMLElement | null;
          setOpen(true);
        }}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label="Search and go"
      >
        <MagnifyingGlass size={14} weight="bold" aria-hidden />
        <span className={styles.triggerLabel}>Go to</span>
        <span className={styles.triggerHint} aria-hidden>⌘K</span>
      </button>

      {!open ? null : (
        <div
          className={styles.scrim}
          role="presentation"
          onMouseDown={(event) => { if (event.target === event.currentTarget) close(); }}
        >
          <div className={styles.dialog} role="dialog" aria-modal="true" aria-label="Go to">
            <div className={styles.field}>
              <MagnifyingGlass size={16} weight="bold" aria-hidden />
              <input
                ref={inputRef}
                className={styles.input}
                type="text"
                value={query}
                placeholder="Go to a surface"
                autoComplete="off"
                spellCheck={false}
                role="combobox"
                aria-expanded="true"
                aria-controls="command-palette-list"
                aria-activedescendant={results[active] ? "command-" + results[active].id : undefined}
                onChange={(event) => { setQuery(event.target.value); setActive(0); }}
                onKeyDown={onFieldKey}
              />
            </div>

            {results.length === 0 ? (
              <p className={styles.empty}>Nothing here matches that. The palette lists surfaces, never actions.</p>
            ) : (
              <ul className={styles.list} id="command-palette-list" role="listbox" ref={listRef}>
                {results.map((command, position) => (
                  <li key={command.id} role="presentation">
                    {/* Group headings only while the list is unfiltered.
                        Ranked results are in rank order, and a heading over a
                        ranked list implies a grouping the order does not have. */}
                    {query.trim() === "" && command.group !== results[position - 1]?.group ? (
                      <p className={styles.group}>{command.group}</p>
                    ) : null}
                    <button
                      type="button"
                      id={"command-" + command.id}
                      className={styles.item}
                      role="option"
                      aria-selected={position === active}
                      data-active={position === active ? "true" : "false"}
                      onClick={() => go(command)}
                    >
                      <span>{command.label}</span>
                      <span className={styles.itemPath}>{command.href}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}

            <div className={styles.foot}>
              <span><kbd>↑</kbd><kbd>↓</kbd> move</span>
              <span><kbd>↵</kbd> open</span>
              <span><kbd>esc</kbd> close</span>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
