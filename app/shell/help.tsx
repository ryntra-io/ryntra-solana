"use client";

import { Question, X } from "@phosphor-icons/react";
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

import { HELP_WORDS, helpTopic, type HelpTopicId } from "./help-topics";
import type { WorkspaceLocale } from "./locale";
import styles from "./help.module.css";

/**
 * The product's one help control.
 *
 * A small `?` beside a label. Hover or focus shows one line; a press opens
 * the topic — what it is, a simple example, the one limitation — in a
 * popover anchored to the control, or as a bottom sheet on a phone where a
 * popover would open off-screen. Escape, a press outside, a scroll or a
 * resize closes it. Both layers are portalled to the body so a table that
 * scrolls sideways or a card that clips never cuts them.
 *
 * What never moves in here: a material risk. The planned risk's model note
 * and the invalidation's "a rule, not an order" stand on the surface in one
 * short line; the help adds the example and the reason.
 */

const PANEL_WIDTH = 344;
const GAP = 8;
const EDGE = 12;
const SHEET_BREAKPOINT = 640;

type Place = Readonly<{ top: number; left: number; width: number }>;

function isSheet(): boolean {
  return typeof window !== "undefined" && window.innerWidth <= SHEET_BREAKPOINT;
}

function placeBelowOrAbove(anchor: DOMRect, width: number, height: number): Place {
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;
  const boxWidth = Math.min(width, viewportWidth - EDGE * 2);
  const left = Math.min(Math.max(anchor.left + anchor.width / 2 - boxWidth / 2, EDGE), viewportWidth - boxWidth - EDGE);
  const below = anchor.bottom + GAP;
  const fitsBelow = below + height <= viewportHeight - EDGE;
  const top = fitsBelow ? below : Math.max(anchor.top - GAP - height, EDGE);
  return { top, left, width: boxWidth };
}

/* `fee` — the token's fee as the chain states it, formatted by the page, for
   a topic that names one (`help-topics.ts`, `{fee}`); without it the topic
   names no rate. */
export function Help({ topic, locale, label, fee }: { topic: HelpTopicId; locale: WorkspaceLocale; label?: string; fee?: string | null }) {
  const text = helpTopic(topic, locale, { fee });
  const words = HELP_WORDS;
  const id = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const tip = useRef<HTMLSpanElement>(null);
  const [open, setOpen] = useState(false);
  const [hover, setHover] = useState(false);
  const [place, setPlace] = useState<Place | null>(null);
  const [tipPlace, setTipPlace] = useState<Place | null>(null);
  const [sheet, setSheet] = useState(false);

  const close = useCallback(() => {
    setOpen(false);
    setPlace(null);
  }, []);

  /* The popover: measured once it exists, then placed below the control, or
     above when the bottom of the viewport is nearer than its height. */
  useLayoutEffect(() => {
    if (!open || !trigger.current || !panel.current) return;
    if (isSheet()) {
      setSheet(true);
      return;
    }
    setSheet(false);
    const anchor = trigger.current.getBoundingClientRect();
    const height = panel.current.offsetHeight;
    setPlace(placeBelowOrAbove(anchor, PANEL_WIDTH, height));
  }, [open]);

  useLayoutEffect(() => {
    if (!hover || open || !trigger.current || !tip.current || isSheet()) {
      setTipPlace(null);
      return;
    }
    const anchor = trigger.current.getBoundingClientRect();
    const box = tip.current.getBoundingClientRect();
    setTipPlace(placeBelowOrAbove(anchor, box.width, box.height));
  }, [hover, open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        close();
        trigger.current?.focus();
      }
    };
    const onPointer = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (!target) return;
      if (panel.current?.contains(target) || trigger.current?.contains(target)) return;
      close();
    };
    const onScroll = () => close();
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPointer, true);
    window.addEventListener("resize", onScroll);
    /* Any scrolling ancestor detaches an anchored panel; a sheet stays. */
    if (!isSheet()) document.addEventListener("scroll", onScroll, true);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPointer, true);
      window.removeEventListener("resize", onScroll);
      document.removeEventListener("scroll", onScroll, true);
    };
  }, [open, close]);

  const title = label ?? text.title;
  const panelId = `${id}-panel`;
  const tipId = `${id}-tip`;
  const showTip = hover && !open;

  return (
    <span className={styles.root}>
      <button
        ref={trigger}
        type="button"
        className={styles.trigger}
        aria-label={`${words.open[locale]} ${title}`}
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        aria-describedby={showTip ? tipId : undefined}
        onClick={() => {
          setHover(false);
          setOpen((current) => !current);
        }}
        onPointerEnter={(event) => {
          if (event.pointerType === "mouse") setHover(true);
        }}
        onPointerLeave={() => setHover(false)}
        onFocus={() => setHover(true)}
        onBlur={() => setHover(false)}
      >
        <Question size={12} weight="bold" aria-hidden="true" />
      </button>
      {showTip
        ? createPortal(
            <span ref={tip} id={tipId} role="tooltip" className={styles.tip} data-placed={tipPlace ? "true" : "false"} style={tipPlace ? { top: tipPlace.top, left: tipPlace.left, maxWidth: tipPlace.width } : undefined}>
              {text.short}
            </span>,
            document.body,
          )
        : null}
      {open
        ? createPortal(
            <>
              {sheet ? <span className={styles.scrim} aria-hidden="true" onClick={close} /> : null}
              <div
                ref={panel}
                id={panelId}
                role="dialog"
                aria-modal={sheet ? "true" : undefined}
                aria-labelledby={`${id}-title`}
                className={styles.panel}
                data-sheet={sheet ? "true" : "false"}
                data-placed={place || sheet ? "true" : "false"}
                style={!sheet && place ? { top: place.top, left: place.left, width: place.width } : undefined}
              >
                <div className={styles.panelHead}>
                  <h3 id={`${id}-title`} className={styles.panelTitle}>
                    {text.title}
                  </h3>
                  <button type="button" className={styles.close} aria-label={words.close[locale]} onClick={close}>
                    <X size={14} weight="bold" aria-hidden="true" />
                  </button>
                </div>
                <p className={styles.what}>{text.what}</p>
                <Block title={words.example[locale]}>
                  <ul className={styles.example}>
                    {text.example.map((line) => (
                      <li key={line}>{line}</li>
                    ))}
                  </ul>
                </Block>
                <Block title={words.important[locale]} tone="important">
                  <p className={styles.important}>{text.important}</p>
                </Block>
              </div>
            </>,
            document.body,
          )
        : null}
    </span>
  );
}

function Block({ title, tone, children }: { title: string; tone?: "important"; children: ReactNode }) {
  return (
    <div className={styles.block} data-tone={tone}>
      <span className={styles.blockTitle}>{title}</span>
      {children}
    </div>
  );
}

/** A label with its `?` — the row every fact and column header uses. */
export function HelpLabel({ children, topic, locale, className }: { children: ReactNode; topic: HelpTopicId; locale: WorkspaceLocale; className?: string }) {
  return (
    <span className={`${styles.label}${className ? ` ${className}` : ""}`}>
      <span>{children}</span>
      <Help topic={topic} locale={locale} />
    </span>
  );
}
