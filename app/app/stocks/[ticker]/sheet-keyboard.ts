"use client";

import { useEffect, type RefObject } from "react";

/**
 * A purchase's or a sale's sheet stands above a phone's keyboard.
 *
 * A phone's browser lays a fixed sheet out on the whole screen and raises its
 * keyboard over it: the sum stays in sight, and the one action — «Купити за
 * $1» — goes under the keys, so a person spends a press closing the keyboard
 * before the press that buys. While the sheet is open this reads what the
 * keyboard covers from the visual viewport and hands it to the sheet's CSS
 * (`--sheet-keyboard`, `--sheet-visible` on the dialog): the sheet rises by
 * that much and keeps within what is seen. On a desk nothing is covered and
 * nothing moves.
 */
export function useSheetAboveKeyboard(dialog: RefObject<HTMLDialogElement | null>, open: boolean) {
  useEffect(() => {
    const element = dialog.current;
    const view = typeof window === "undefined" ? null : window.visualViewport;
    if (!open || !element || !view) return undefined;
    let frame = 0;
    const place = () => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => {
        /* The layout viewport's height below the part the person sees: the keyboard, where one is up. */
        const covered = Math.max(0, Math.round(window.innerHeight - view.height - view.offsetTop));
        element.style.setProperty("--sheet-keyboard", `${covered}px`);
        element.style.setProperty("--sheet-visible", `${Math.round(view.height)}px`);
        /* A keyboard, not a browser bar folding away: the sheet tightens its spacing so all of it fits above the keys. */
        element.toggleAttribute("data-keyboard", covered > KEYBOARD_MIN_PX);
      });
    };
    place();
    view.addEventListener("resize", place);
    view.addEventListener("scroll", place);
    return () => {
      window.cancelAnimationFrame(frame);
      view.removeEventListener("resize", place);
      view.removeEventListener("scroll", place);
      element.style.removeProperty("--sheet-keyboard");
      element.style.removeProperty("--sheet-visible");
      element.removeAttribute("data-keyboard");
    };
  }, [dialog, open]);
}

/** Less than this is a browser's own bar folding away, never a keyboard (a phone's number keys are ≈ 250–350 px). */
const KEYBOARD_MIN_PX = 120;

/**
 * On a desk the sum is ready as the sheet opens: the ticket's own field, focused and chosen whole, so the first key
 * replaces the sum it opened on. On a phone the keyboard rises only on the person's own tap, never by itself.
 */
export function useSumReadyOnDesk(dialog: RefObject<HTMLDialogElement | null>, open: boolean) {
  useEffect(() => {
    if (!open || typeof window === "undefined") return undefined;
    if (!window.matchMedia("(hover: hover) and (pointer: fine)").matches) return undefined;
    const frame = window.requestAnimationFrame(() => {
      const element = dialog.current;
      if (!element?.open) return;
      const input = element.querySelector<HTMLInputElement>('[data-ticket-field="amount"]');
      if (!input || input.disabled || input.readOnly) return;
      input.focus({ preventScroll: true });
      input.select();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [dialog, open]);
}
