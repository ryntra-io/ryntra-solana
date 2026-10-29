"use client";

import { useEffect } from "react";

/**
 * While a person types on a phone, the field they type in stays in sight.
 *
 * A phone's keyboard rises over the page and takes a third of the screen with
 * it. The browser scrolls the field it just gave the focus to into the layout
 * viewport — which still counts the rows the keyboard now covers — so a field
 * near the bottom lands behind the keys, and on a cabinet page it lands behind
 * the bottom bar as well: the sum of a swap is typed blind. Two things answer
 * that here, and the stylesheet does the rest.
 *
 * The frame says that someone is typing (`data-typing` on the document, read by
 * `frame.css`): the bottom bar steps aside for as long as the focus is in a
 * field and comes back when it leaves, so the bar never lies over what is being
 * typed. The one row of the bar is not navigation a person needs mid-word, and
 * the menu stays a press away in the header.
 *
 * And the field is scrolled into the band the person actually sees — the visual
 * viewport, which is the only thing that knows where the keyboard's top edge is
 * — with a breath above and below it. Where no keyboard rises, the band is the
 * whole screen, nothing is covered and nothing moves.
 */

/** The breath left between a field and the edge of what is seen. */
export const FIELD_PAD_PX = 16;

/** Less than this is a browser's own bar folding away, never a keyboard (a phone's number keys are ≈ 250–350 px). */
export const KEYBOARD_MIN_PX = 120;

/** Below a desk the core has no rail and pins the product's bottom bar; above it there is nothing to step aside. */
export const PHONE_QUERY = "(max-width: 1023px)";

/** The input types a keyboard rises for; a checkbox, a button, a slider or a colour well raise none. */
const TYPED_INPUTS = new Set(["text", "search", "email", "tel", "url", "password", "number", "date", "datetime-local", "month", "time", "week"]);

/** Whether the focus landing on this element raises a phone's keyboard. */
export function raisesKeyboard(element: Element | null | undefined): boolean {
  if (!element) return false;
  const tag = element.tagName.toLowerCase();
  if (tag === "textarea") {
    const area = element as HTMLTextAreaElement;
    return !area.disabled && !area.readOnly;
  }
  if (tag === "input") {
    const input = element as HTMLInputElement;
    if (input.disabled || input.readOnly) return false;
    return TYPED_INPUTS.has((input.getAttribute("type") ?? "text").toLowerCase());
  }
  return (element as HTMLElement).isContentEditable === true;
}

/**
 * How much of the layout viewport the keyboard covers, from the visual viewport's own numbers: the layout's height less
 * the part that is seen and less how far that part has been pushed down.
 */
export function keyboardInset({ innerHeight, viewHeight, offsetTop }: { innerHeight: number; viewHeight: number; offsetTop: number }): number {
  return Math.max(0, Math.round(innerHeight - viewHeight - offsetTop));
}

/**
 * How far to scroll so a field stands inside the band that is seen, with `pad` above and below it. A positive answer
 * scrolls the page down (the field rises), a negative one up, and `0` means it is already in sight.
 *
 * A field taller than the band is shown from its top: that is where its label and the first of what is typed stand.
 */
export function scrollForField({ fieldTop, fieldBottom, visibleTop, visibleBottom, pad = FIELD_PAD_PX }: { fieldTop: number; fieldBottom: number; visibleTop: number; visibleBottom: number; pad?: number }): number {
  const band = visibleBottom - visibleTop;
  if (fieldBottom - fieldTop + pad * 2 > band) return Math.round(fieldTop - pad - visibleTop);
  if (fieldBottom + pad > visibleBottom) return Math.round(fieldBottom + pad - visibleBottom);
  if (fieldTop - pad < visibleTop) return Math.round(fieldTop - pad - visibleTop);
  return 0;
}

/** The attribute the frame reads while the focus is in a field. */
export const TYPING_ATTRIBUTE = "data-typing";

/**
 * Hung on the frame once, for every cabinet page: the bar steps aside while a field has the focus, and the field is
 * kept inside the band that is seen as the keyboard rises, folds away or the page is scrolled under it.
 */
export function useTypingOnPhone(): void {
  useEffect(() => {
    const narrow = window.matchMedia(PHONE_QUERY);
    const root = document.documentElement;
    let field: HTMLElement | null = null;
    let frame = 0;
    /* The focus moving from one field to the next leaves and arrives in that order: the bar comes back only once the
       focus has truly left every field, never for the blink between two of them. */
    let leaving = 0;

    const place = () => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => {
        const element = field;
        const view = window.visualViewport;
        if (!element?.isConnected || !view) return;
        const box = element.getBoundingClientRect();
        const delta = scrollForField({
          fieldTop: box.top,
          fieldBottom: box.bottom,
          /* The visual viewport in the layout viewport's own coordinates, which is what a rectangle is measured in. */
          visibleTop: view.offsetTop,
          visibleBottom: view.offsetTop + view.height,
        });
        if (delta !== 0) window.scrollBy({ top: delta, behavior: "auto" });
      });
    };

    const stop = () => {
      window.clearTimeout(leaving);
      window.cancelAnimationFrame(frame);
      field = null;
      root.removeAttribute(TYPING_ATTRIBUTE);
      window.visualViewport?.removeEventListener("resize", place);
      window.visualViewport?.removeEventListener("scroll", place);
    };

    const onFocusIn = (event: FocusEvent) => {
      window.clearTimeout(leaving);
      const target = event.target as Element | null;
      if (!narrow.matches || !raisesKeyboard(target)) {
        if (field) stop();
        return;
      }
      const first = !field;
      field = target as HTMLElement;
      root.setAttribute(TYPING_ATTRIBUTE, "true");
      if (first) {
        window.visualViewport?.addEventListener("resize", place);
        window.visualViewport?.addEventListener("scroll", place);
      }
      place();
    };
    const onFocusOut = () => {
      window.clearTimeout(leaving);
      leaving = window.setTimeout(stop, 0);
    };

    /* A phone turned into a desk — or a window pulled wide — gives the bar its place back. */
    const onWidth = () => {
      if (!narrow.matches && field) stop();
    };

    document.addEventListener("focusin", onFocusIn);
    document.addEventListener("focusout", onFocusOut);
    narrow.addEventListener("change", onWidth);
    return () => {
      document.removeEventListener("focusin", onFocusIn);
      document.removeEventListener("focusout", onFocusOut);
      narrow.removeEventListener("change", onWidth);
      stop();
    };
  }, []);
}
