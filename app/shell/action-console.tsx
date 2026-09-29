"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { X } from "@phosphor-icons/react";

/**
 * The Action Console.
 *
 * The frozen UX System's answer to a question every workspace had answered
 * differently: **where does an action happen?** One hub answered "on a page called
 * Send". Solana answered "on a page that also owns the wallet". Agent Control
 * answered "on a page that connects its own signer". Three answers, and all
 * three put a verb in a navigation rail — which is how a rail becomes a menu of
 * things to do rather than a map of where you are.
 *
 * The canonical answer is a drawer: you are on a surface, you trigger an
 * action, it opens beside what you were looking at, you review the exact thing,
 * you authorize it, and the receipt lands. You never left the page that gave
 * you the reason.
 *
 * Two boundaries this component holds and does not cross.
 *
 * **It owns the container, never the lifecycle.** What renders inside is the
 * workspace's own console, unchanged — the same component the legacy route
 * mounts. Nothing here builds a transaction, evaluates a policy, prompts a
 * wallet or writes a receipt, and nothing here may start to. A shell migration
 * that alters an execution path has failed however it looks.
 *
 * **The legacy route stays alive.** Every action that becomes a drawer keeps
 * its route as a deep link, so a bookmark, a receipt permalink or a link
 * someone was sent still resolves. Moving an action and deleting its URL are
 * two changes, and only one of them is safe to get wrong.
 */

export type ActionDefinition = Readonly<{
  /** Panel title. The action, named as the person would name it. */
  title: string;
  /** One line under the title, when the action needs it. Never a paragraph. */
  lead?: string;
  /**
   * The environment this action runs in.
   *
   * Rendered prominently, because the frozen system requires the environment to
   * be explicit at the moment of authorization rather than inferred from the
   * workspace's chrome three controls away.
   */
  environment?: string;
  /** The route this action also lives at, kept as a deep link. */
  deepLink?: string;
  content: ReactNode;
}>;

type ActionConsoleValue = Readonly<{
  open: (id: string) => void;
  close: () => void;
  openId: string | null;
  /** Which actions this workspace offers at all. */
  available: readonly string[];
  /** The open action, resolved. Read by the drawer, not by surfaces. */
  current: ActionDefinition | null;
}>;

const ActionConsoleContext = createContext<ActionConsoleValue | null>(null);

/**
 * Trigger an action from anywhere inside the workspace.
 *
 * Returns `null` outside a provider rather than throwing: a surface shared
 * between a workspace with actions and one without should render, not crash.
 * Callers check before offering the control, which is the same rule the
 * connection contract applies to capabilities — an action that cannot happen is
 * not offered.
 */
export function useActionConsole(): ActionConsoleValue | null {
  return useContext(ActionConsoleContext);
}

export function ActionConsoleProvider({
  actions,
  children,
}: {
  actions?: Readonly<Record<string, ActionDefinition>>;
  children: ReactNode;
}) {
  const [openId, setOpenId] = useState<string | null>(null);

  const open = useCallback((id: string) => setOpenId(id), []);
  const close = useCallback(() => setOpenId(null), []);

  /* Escape closes it. A drawer over a form the person is mid-way through is the
     one place a stray click outside must NOT close it — losing a half-entered
     transfer to a misplaced click is worse than one extra keystroke — so there
     is deliberately no outside-click dismissal here, unlike the menus. */
  useEffect(() => {
    if (!openId) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpenId(null);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [openId]);

  const value = useMemo<ActionConsoleValue>(
    () => ({
      open,
      close,
      openId,
      available: actions ? Object.keys(actions) : [],
      current: (openId && actions ? actions[openId] : null) ?? null,
    }),
    [actions, close, open, openId],
  );

  return (
    <ActionConsoleContext.Provider value={value}>
      {children}
    </ActionConsoleContext.Provider>
  );
}

/**
 * Where the drawer is drawn.
 *
 * Separate from the provider, and rendered **inside** the shell's root element
 * rather than beside it. That is not tidiness: the drawer's geometry reads
 * `--rs-top`, and that custom property is declared on `.rs`. A sibling of `.rs`
 * does not inherit it, so `inset-block: var(--rs-top) 0` named an undefined
 * property, became invalid at computed-value time, and the whole declaration
 * was dropped — leaving a `position: fixed` element with `top: auto`, which
 * lays out where it would have flowed. Measured: the panel opened 1,150px down
 * the page, off the bottom of a 700px viewport.
 *
 * The same failure mode is recorded in `app/design/tokens.css`, where a
 * `var()` naming a property defined further down the tree silently dropped the
 * homepage's entire display typeface. A fallback value here would have hidden
 * it again; putting the element where the variable exists fixes it once.
 */
export function ActionConsoleDrawer({
  strings = DEFAULT_STRINGS,
}: {
  strings?: ActionConsoleStrings;
}) {
  const console_ = useContext(ActionConsoleContext);
  const current = console_?.current ?? null;
  const close = console_?.close;

  return (
    <>
      {current ? (
        <aside
          className="rs-action"
          role="dialog"
          aria-modal="false"
          aria-label={current.title}
        >
          <header className="rs-action-head">
            <div className="rs-action-heading">
              <h2 className="rs-action-title">{current.title}</h2>
              {current.environment ? (
                <span className="rs-action-env">{current.environment}</span>
              ) : null}
            </div>
            <button
              type="button"
              className="rs-action-close"
              onClick={close}
              aria-label={strings.close}
            >
              <X size={16} weight="bold" aria-hidden />
            </button>
          </header>

          {current.lead ? (
            <p className="rs-action-lead">{current.lead}</p>
          ) : null}

          <div className="rs-action-body">{current.content}</div>

          {current.deepLink ? (
            <footer className="rs-action-foot">
              <a href={current.deepLink}>{strings.openFull}</a>
            </footer>
          ) : null}
        </aside>
      ) : null}
    </>
  );
}

export type ActionConsoleStrings = Readonly<{
  close: string;
  openFull: string;
}>;

const DEFAULT_STRINGS: ActionConsoleStrings = {
  close: "Close action",
  openFull: "Open as a full page",
};
