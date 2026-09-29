"use client";

import { useEffect, useRef, useState } from "react";
import { CaretLeft, CaretRight } from "@phosphor-icons/react";

/**
 * The deck rail chrome: arrows, a position readout, and drag-to-scroll.
 *
 * The cards themselves arrive server-rendered as children — this component
 * adds only the handling. Three inputs, one contract:
 *
 *   - arrows page the rail by its visible width and disable at the ends;
 *   - a mouse can grab the rail and pull it, the way the founder reached for
 *     it on first contact ("воно не витягується"); snap is suspended while
 *     dragging so the rail follows the hand, and restored on release;
 *   - touch and keyboard keep the native scroll they already had.
 */
export function DeckRail({ label, children }: { label: string; children: React.ReactNode }) {
  const railRef = useRef<HTMLDivElement>(null);
  const [atStart, setAtStart] = useState(true);
  const [atEnd, setAtEnd] = useState(false);

  useEffect(() => {
    const rail = railRef.current;
    if (!rail) return;

    const measure = () => {
      setAtStart(rail.scrollLeft <= 4);
      setAtEnd(rail.scrollLeft >= rail.scrollWidth - rail.clientWidth - 4);
    };
    measure();
    rail.addEventListener("scroll", measure, { passive: true });
    const resize = new ResizeObserver(measure);
    resize.observe(rail);

    /* Drag-to-scroll for a mouse. Pointer capture keeps the drag alive when
       the cursor leaves the rail, and a small threshold keeps a click on a
       card link from turning into a one-pixel drag. */
    let dragging = false;
    let moved = false;
    let startX = 0;
    let startScroll = 0;

    const onDown = (event: PointerEvent) => {
      if (event.pointerType !== "mouse" || event.button !== 0) return;
      dragging = true;
      moved = false;
      startX = event.clientX;
      startScroll = rail.scrollLeft;
    };
    const onMove = (event: PointerEvent) => {
      if (!dragging) return;
      const dx = event.clientX - startX;
      if (!moved && Math.abs(dx) > 6) {
        moved = true;
        rail.dataset.dragging = "true";
        rail.setPointerCapture(event.pointerId);
      }
      if (moved) rail.scrollLeft = startScroll - dx;
    };
    const onUp = (event: PointerEvent) => {
      if (!dragging) return;
      dragging = false;
      if (moved && rail.hasPointerCapture(event.pointerId)) rail.releasePointerCapture(event.pointerId);
      delete rail.dataset.dragging;
    };
    const onClick = (event: MouseEvent) => {
      // A pull is not a click: swallow the click a finished drag would fire.
      if (moved) {
        event.preventDefault();
        event.stopPropagation();
        moved = false;
      }
    };

    rail.addEventListener("pointerdown", onDown);
    rail.addEventListener("pointermove", onMove);
    rail.addEventListener("pointerup", onUp);
    rail.addEventListener("pointercancel", onUp);
    rail.addEventListener("click", onClick, true);

    return () => {
      rail.removeEventListener("scroll", measure);
      resize.disconnect();
      rail.removeEventListener("pointerdown", onDown);
      rail.removeEventListener("pointermove", onMove);
      rail.removeEventListener("pointerup", onUp);
      rail.removeEventListener("pointercancel", onUp);
      rail.removeEventListener("click", onClick, true);
    };
  }, []);

  const page = (direction: 1 | -1) => {
    const rail = railRef.current;
    if (!rail) return;
    rail.scrollBy({ left: direction * Math.max(280, rail.clientWidth * 0.85), behavior: "smooth" });
  };

  return (
    <div className="rx-deckrail">
      <div className="rx-deck" ref={railRef} tabIndex={0} role="group" aria-label={label}>
        <div className="rx-deck-track">{children}</div>
      </div>
      <div className="rx-deck-nav">
        <button
          type="button"
          className="rx-deck-btn"
          aria-label="Scroll the surfaces back"
          disabled={atStart}
          onClick={() => page(-1)}
        >
          <CaretLeft size={16} weight="bold" aria-hidden />
        </button>
        <button
          type="button"
          className="rx-deck-btn"
          aria-label="Scroll the surfaces forward"
          disabled={atEnd}
          onClick={() => page(1)}
        >
          <CaretRight size={16} weight="bold" aria-hidden />
        </button>
        <span className="rx-deck-hint">Drag, scroll or use the arrows</span>
      </div>
    </div>
  );
}
