"use client";

import "dockview-react/dist/styles/dockview.css";
import "@ryntra/core/tokens.css";
import "@ryntra/core/ui.css";
import "@ryntra/core/terminal.css";

import { LinkSimple } from "@phosphor-icons/react";
import { Terminal, type TerminalPanel } from "@ryntra/core/terminal";
import { ShellContext, indexedDbLayoutStore, parseLayout, type LayoutStore, type PageLayout, type ShellBridge, type WorkspaceHandle } from "@ryntra/core/ui";
import { useCallback, useContext, useEffect, useMemo, useRef, useState, type MutableRefObject, type ReactNode } from "react";

import { useFitHeight } from "@/app/components/chart/use-fit-height";
import type { WorkspaceLocale } from "@/app/shell/locale";
import { MARKET_PANELS, chooseKept, cleanMarketLayout, decodeSharedLayout, encodeSharedLayout, isCleanStandard, type MarketPanelId } from "@/lib/predictions/market-layout";
import { LAYOUT_SLOTS, layoutPage, sideChosenAt } from "@/lib/predictions/preferences";

import styles from "../predictions.module.css";
import { usePredictPrefs } from "../prefs-context";
import { wordsFor, type PredictionWord } from "../words";

const TITLE: Readonly<Record<MarketPanelId, PredictionWord>> = {
  chart: "panelChart",
  ticket: "panelTicket",
  ryntra: "panelRyntra",
  book: "panelBook",
  outcomes: "panelOutcomes",
  rules: "panelRules",
  map: "panelMap",
  prices: "panelPrices",
  news: "panelNews",
};

const SPECS = MARKET_PANELS.map((panel) => ({ id: panel.id, span: panel.span, ...(panel.kind ? { kind: panel.kind } : {}) }));

/** What the page may ask of the workspace: a panel brought into view (shown, in front of its tabs, scrolled to) or put away. */
export type WorkspaceControls = Readonly<{ show: (id: MarketPanelId) => void; hide: (id: MarketPanelId) => void }>;

/** The tab of a panel in a group of tabs, brought to the front the way a press on it does. */
function frontTab(root: HTMLElement | null, title: string) {
  const tab = [...(root?.querySelectorAll<HTMLElement>(".dv-tab") ?? [])].find((element) => element.getAttribute("aria-label") === title || element.textContent?.trim() === title);
  if (!tab || tab.classList.contains("dv-active-tab")) return;
  tab.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0, isPrimary: true }));
}

/**
 * The market page as the core's terminal. It opens in the core's «Стандарт» —
 * the chart, with the outcome's probability over it, and the ticket beside it
 * on the side the person chose — and «Повернути стандарт» under the terminal
 * leads back there in one act. Every other panel — Ryntra, the markets, the
 * rules, the related markets, the order book, the venues' prices, the news —
 * comes back from the core's «Додати панель»; «Налаштувати» moves and closes
 * panels, and there a layout can be copied as a link. On a phone the panels
 * stand one under another, the ticket first.
 *
 * A layout the page opened in before «Стандарт» and the person never arranged
 * moves to «Стандарт» once; one they arranged stays theirs.
 *
 * Nothing the person has typed or opened lives in a panel: the terminal may
 * rebuild its panels whenever a layout is put in place, so the page keeps the
 * ticket, the Review and the conversation with Ryntra.
 */
export function MarketWorkspace({
  locale,
  theme,
  content,
  onShown,
  controls,
}: {
  locale: WorkspaceLocale;
  theme: "dark" | "light";
  content: Readonly<Record<MarketPanelId, ReactNode>>;
  /** Which panels are on screen now (not put away), for what only a shown panel needs. */
  onShown?: (ids: ReadonlySet<string>) => void;
  /** Filled with what the page may ask of the workspace. */
  controls?: MutableRefObject<WorkspaceControls | null>;
}) {
  const word = wordsFor(locale);
  const { prefs, layoutStore, layoutKey } = usePredictPrefs();
  // The layout the person last had on screen: a slot they arranged before «Стандарт» stays theirs.
  const page = layoutPage(prefs.slot);
  const side = prefs.side;
  const pageRef = useRef(page);
  pageRef.current = page;
  const sideRef = useRef({ side, at: sideChosenAt(prefs) });
  sideRef.current = { side, at: sideChosenAt(prefs) };
  const root = useRef<HTMLDivElement>(null);
  /* The terminal and the core's row under it take what the first screen leaves under the question. */
  useFitHeight(root, { target: "[data-market-terminal]", variable: "--market-terminal-h", min: 560, max: 2400, margin: 16 });

  /* The workspace tells the frame (the «Налаштувати» panel) through this page, which keeps the handle for its own acts. */
  const outer = useContext(ShellContext);
  const [handle, setHandle] = useState<WorkspaceHandle | null>(null);
  const bridge = useMemo<ShellBridge>(
    () => ({
      attach: (inner) => {
        setHandle(inner);
        outer?.attach(inner);
      },
      focus: (exit, preset) => outer?.focus(exit, preset),
    }),
    [outer],
  );
  const handleRef = useRef(handle);
  handleRef.current = handle;
  /** A panel shown or put away here, until the workspace's next word says so: two presses before it answers do not undo each other. */
  const asked = useRef(new Map<string, boolean>());
  useEffect(() => {
    asked.current.clear();
  }, [handle]);

  /** The layout as last written here, or read and drawn; nothing kept — the page is in «Стандарт». */
  const latest = useRef<PageLayout | null>(null);
  /** Bumped to make the terminal read the layout again (a layout from a link put in place). */
  const [generation, setGeneration] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);
  const [manualLink, setManualLink] = useState<string | null>(null);
  const [shared, setShared] = useState<PageLayout | null>(null);

  // The browser's own copy alone without a wallet; with one, the browser's and the account's together.
  const base = useMemo<LayoutStore>(() => layoutStore ?? indexedDbLayoutStore(), [layoutStore]);
  const store = useMemo<LayoutStore>(
    () => ({
      read: async (at) => {
        // Read together, so a slow account holds the page back once: the other layouts of before count only when this one holds nothing of the person's.
        const [own, ...others] = await Promise.all([at, ...LAYOUT_SLOTS.map(layoutPage).filter((other) => other !== at)].map((page) => base.read(page)));
        const layout = chooseKept(own ?? null, others, sideRef.current.side, sideRef.current.at);
        // The terminal draws the later of what it has and what is read: so does the link.
        if (at === pageRef.current && layout && (!latest.current || layout.updatedAt >= latest.current.updatedAt)) latest.current = layout;
        return layout;
      },
      write: async (at, layout) => {
        if (at === pageRef.current) latest.current = layout;
        await base.write(at, layout);
      },
    }),
    [base],
  );

  const standard = useCallback((now: number) => cleanMarketLayout(side, now), [side]);

  // A layout in the address: offered, never put in place by itself.
  useEffect(() => {
    const code = new URLSearchParams(window.location.search).get("layout");
    if (!code) return;
    const parsed = parseLayout(decodeSharedLayout(code));
    if (parsed) setShared(parsed);
    else setNotice(word("layoutBroken"));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- read once, when the page opens
  }, []);

  const forgetLink = () => {
    const url = new URL(window.location.href);
    url.searchParams.delete("layout");
    window.history.replaceState(window.history.state, "", url.toString());
  };

  const openShared = async (layout: PageLayout) => {
    // «Стандарт» from a link is this page's own, on this person's side.
    if (isCleanStandard(layout)) {
      handleRef.current?.reset();
      return;
    }
    // Kept as the person's latest change, then read again by the terminal: the later change wins.
    await store.write(pageRef.current, { ...layout, updatedAt: Date.now(), rev: 1 });
    setGeneration((n) => n + 1);
  };

  const share = async () => {
    // «Стандарт» goes without its arrangement: whoever opens it gets their own side.
    const { dock: _dock, ...plain } = cleanMarketLayout(side);
    const layout = latest.current && !isCleanStandard(latest.current) ? latest.current : plain;
    const url = new URL(window.location.href);
    url.searchParams.set("layout", encodeSharedLayout(layout as unknown as Record<string, unknown>));
    try {
      await navigator.clipboard.writeText(url.toString());
      setManualLink(null);
      setNotice(word("layoutShared"));
    } catch {
      // No clipboard here: the link is shown to copy by hand, never put into this page's own address.
      setManualLink(url.toString());
      setNotice(word("layoutShareFailed"));
    }
  };

  useEffect(() => {
    if (!notice) return undefined;
    const timer = setTimeout(() => setNotice(null), manualLink ? 30_000 : 4_000);
    return () => clearTimeout(timer);
  }, [notice, manualLink]);

  // Read afresh each render, so the page always calls the workspace as it stands now.
  useEffect(() => {
    if (!controls) return undefined;
    controls.current = {
      show: (id) => {
        const now = handleRef.current;
        const hidden = asked.current.has(id) ? !asked.current.get(id) : now?.blocks.find((block) => block.id === id)?.hidden;
        if (now && hidden) {
          asked.current.set(id, true);
          now.toggle(id);
        }
        // The terminal draws the panel a frame or two later: then in front of its tabs and scrolled to, so an answer asked for is seen.
        let frames = 0;
        const settle = () => {
          frontTab(root.current, word(TITLE[id]));
          const panel = root.current?.querySelector<HTMLElement>(`[data-panel="${id}"]`);
          frames += 1;
          if (panel && panel.getBoundingClientRect().height > 0) {
            if (typeof panel.scrollIntoView === "function") panel.scrollIntoView({ block: "nearest" });
            return;
          }
          if (frames < 30) requestAnimationFrame(settle);
        };
        requestAnimationFrame(settle);
      },
      hide: (id) => {
        const now = handleRef.current;
        const hidden = asked.current.has(id) ? !asked.current.get(id) : now?.blocks.find((block) => block.id === id)?.hidden;
        if (now && hidden === false) {
          asked.current.set(id, false);
          now.toggle(id);
        }
      },
    };
    return () => {
      controls.current = null;
    };
  });

  // What is on screen, for the page: a live order book only while the book is shown.
  const shownKey = handle ? handle.blocks.filter((block) => !block.hidden).map((block) => block.id).join(" ") : null;
  useEffect(() => {
    if (shownKey !== null) onShown?.(new Set(shownKey.split(" ").filter(Boolean)));
  }, [shownKey, onShown]);

  const panels: TerminalPanel[] = SPECS.map((spec) => ({
    ...spec,
    title: word(TITLE[spec.id]),
    children: (
      <div className={styles.panelBody} data-panel={spec.id} tabIndex={-1}>
        {content[spec.id]}
      </div>
    ),
  }));

  return (
    // The shared workspace draws in the core's themes: Graphite for dark, Porcelain for light.
    <div className={styles.workspace} data-theme={theme === "light" ? "porcelain" : "graphite"} ref={root}>
      {shared ? (
        <div className={styles.workOffer} role="region" aria-label={word("layoutFromLink")}>
          <p>
            <b>{word("layoutFromLink")}</b> · {word("layoutOffer")}
          </p>
          <div className={styles.workActions}>
            <button
              type="button"
              className="rw-btn"
              onClick={() => {
                void openShared(shared);
                setShared(null);
                forgetLink();
              }}
            >
              {word("layoutOpen")}
            </button>
            <button
              type="button"
              className="rw-btn"
              onClick={() => {
                setShared(null);
                forgetLink();
              }}
            >
              {word("layoutKeep")}
            </button>
          </div>
        </div>
      ) : null}

      <ShellContext.Provider value={bridge}>
        <div className={styles.terminal} data-market-terminal="">
          {/* Another side chosen: the terminal reads its layout again — «Стандарт» on the new side; nothing is written for it. */}
          <Terminal
            key={`${page}:${side}`}
            page={page}
            panels={panels}
            store={store}
            storeKey={`${layoutKey ?? "browser"}#${generation}`}
            standard={standard}
            legacyPreset={null}
            lang={locale === "uk" ? "uk" : "en"}
          />
        </div>
      </ShellContext.Provider>

      {/* In «Налаштувати», beside the core's row: the layout on screen as a link for someone else. */}
      {handle?.arranging ? (
        <div className={styles.workActions}>
          <button type="button" className={styles.workButton} onClick={() => void share()}>
            <LinkSimple size={16} aria-hidden="true" />
            <span>{word("layoutShare")}</span>
          </button>
        </div>
      ) : null}

      {/* Always in the page, so a screen reader hears each new word in it. */}
      <div className={styles.workStatus} role="status" aria-live="polite">
        {notice ? <p className={styles.workNotice}>{notice}</p> : null}
        {notice && manualLink ? <input className={styles.manualLink} readOnly value={manualLink} aria-label={word("layoutShare")} onFocus={(event) => event.currentTarget.select()} /> : null}
      </div>
    </div>
  );
}
