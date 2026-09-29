"use client";

import { useEffect } from "react";

import "./motion.css";

/**
 * The motion layer for the public site.
 *
 * Four behaviours, one component, event-driven animation frames:
 *
 *   1. Directional reveals — blocks enter from the side they belong on, in a
 *      stagger, on an expo-out curve. Transform and opacity only, so nothing
 *      reflows and no scrollbar ever appears mid-animation.
 *   2. Magnetic controls — a button leans a few pixels toward the pointer and
 *      springs back. It is the cheapest way to make a surface feel authored.
 *   3. A pointer ring that trails the cursor and locks on to whatever is
 *      interactive under it. The native cursor is left visible: a site that
 *      hides it has swapped a working control for a decoration.
 *   4. A circuit rail down the left edge that fills with scroll position. It is
 *      the Decision Circuit motif doing something useful — the reader's own
 *      progress through the argument.
 *
 * Everything here is progressive enhancement. The markup ships fully visible
 * and the hidden start state is switched on (`html.rxm`) only once the observer
 * is genuinely running, so a blocked or failed script leaves a readable page
 * rather than a blank one. `prefers-reduced-motion` skips the whole module, and
 * the pointer work never starts on a touch device.
 */

const EASE_LERP = 0.16;

export function SiteMotion() {
  useEffect(() => {
    const root = document.documentElement;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
    if (reduced.matches) return;

    const cleanups: Array<() => void> = [];

    /* ---------------------------------------------------------- reveals -- */

    const revealables = Array.from(
      document.querySelectorAll<HTMLElement>("[data-rx-reveal]"),
    );

    if (revealables.length && typeof IntersectionObserver !== "undefined") {
      try {
        const observer = new IntersectionObserver(
          (entries) => {
            for (const entry of entries) {
              if (!entry.isIntersecting) continue;
              const el = entry.target as HTMLElement;
              el.dataset.rxIn = "true";
              observer.unobserve(el);
            }
          },
          { rootMargin: "0px 0px -8% 0px", threshold: 0.12 },
        );

        for (const el of revealables) {
          /* Stagger is assigned from the element's position among its siblings
             rather than from a hand-written index, so adding a card to a group
             cannot silently break the rhythm. */
          const group = el.dataset.rxGroup;
          if (group) {
            const siblings = Array.from(
              el.parentElement?.querySelectorAll<HTMLElement>(`[data-rx-group="${group}"]`) ?? [],
            );
            el.style.setProperty("--rx-delay", `${siblings.indexOf(el) * 70}ms`);
          }
          observer.observe(el);
        }

        root.classList.add("rxm");

        /*
         * The failsafe, and it is not theoretical.
         *
         * Adding `rxm` hides every revealable, and only the observer brings
         * them back. Anything that stops the observer from ever delivering —
         * a background tab that is never composited, an aggressive throttle, a
         * browser quirk — leaves the entire page below the hero blank, with no
         * error anywhere to explain it. So a timer reveals everything
         * unconditionally shortly after mount. Where the observer works it has
         * already run and this is a no-op; where it does not, the visitor gets
         * the page instead of a void.
         */
        const failsafe = window.setTimeout(() => {
          for (const el of revealables) el.dataset.rxIn = "true";
        }, 2200);

        cleanups.push(() => {
          window.clearTimeout(failsafe);
          observer.disconnect();
          root.classList.remove("rxm");
        });
      } catch {
        root.classList.remove("rxm");
      }
    }

    /* ---------------------------------------------------- circuit spine -- */

    /* The pulse has to travel the real height of the stage list, not a guessed
       one, or it stops halfway down on a short panel and runs off a tall one. */
    const spine = document.querySelector<HTMLElement>(".rx-flow-list");
    if (spine) {
      const measure = () => spine.style.setProperty("--rx-spine", `${spine.offsetHeight}px`);
      measure();
      const resize = new ResizeObserver(measure);
      resize.observe(spine);
      cleanups.push(() => resize.disconnect());
    }

    /* ------------------------------------------------- pointer and rail -- */

    /*
     * Pointer capability is read live rather than latched at mount. The effect
     * runs once, so a latched value is wrong for the whole session if the first
     * measurement was taken under device emulation or a docked tablet — which
     * is exactly how the ring silently failed to exist on a desktop that had
     * been resized. Existence is now a CSS decision; only the work is gated.
     */
    const finePointerQuery = window.matchMedia("(hover: hover) and (pointer: fine)");
    const finePointer = () => finePointerQuery.matches;

    const ring = document.createElement("div");
    const rail = document.createElement("div");
    rail.className = "rx-rail-progress";
    rail.setAttribute("aria-hidden", "true");
    document.body.appendChild(rail);
    cleanups.push(() => rail.remove());

    let ringX = -100;
    let ringY = -100;
    let targetX = -100;
    let targetY = -100;
    let ringFrame = 0;
    let railFrame = 0;
    let scrollable = 0;

    const renderRing = () => {
      ringX += (targetX - ringX) * EASE_LERP;
      ringY += (targetY - ringY) * EASE_LERP;
      ring.style.transform = `translate3d(${ringX}px, ${ringY}px, 0) translate(-50%, -50%)`;

      if (Math.abs(targetX - ringX) > 0.1 || Math.abs(targetY - ringY) > 0.1) {
        ringFrame = window.requestAnimationFrame(renderRing);
      } else {
        ringFrame = 0;
      }
    };

    const scheduleRing = () => {
      if (!finePointer() || ringFrame) return;
      ringFrame = window.requestAnimationFrame(renderRing);
    };

    const renderRail = () => {
      const progress = scrollable > 0 ? Math.min(1, window.scrollY / scrollable) : 0;
      rail.style.transform = `scaleY(${progress})`;
      railFrame = 0;
    };

    const scheduleRail = () => {
      if (railFrame) return;
      railFrame = window.requestAnimationFrame(renderRail);
    };

    const measureRail = () => {
      scrollable = Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
      scheduleRail();
    };

    {
      ring.className = "rx-cursor";
      ring.setAttribute("aria-hidden", "true");
      /* The label lives inside the ring rather than beside it, so there is one
         thing following the pointer instead of two racing each other. */
      const label = document.createElement("span");
      label.className = "rx-cursor-label";
      ring.appendChild(label);
      document.body.appendChild(ring);
      cleanups.push(() => ring.remove());

      const onMove = (event: PointerEvent) => {
        targetX = event.clientX;
        targetY = event.clientY;
        scheduleRing();

        const target = event.target as HTMLElement | null;
        const interactive = target?.closest("a, button, [role='tab'], summary, input, select");

        /*
         * Contextual text, and only where it says something the element does
         * not. A surface declares its own verb with `data-rx-cursor`; a plain
         * button gets the ring and no label, because "BUTTON" over a button is
         * noise. The nearest declaration wins, so a link inside a labelled
         * panel can still say OPEN.
         */
        const declared = target?.closest<HTMLElement>("[data-rx-cursor]");
        const verb = declared?.dataset.rxCursor ?? "";
        label.textContent = verb;
        ring.dataset.labelled = verb ? "true" : "false";
        ring.dataset.locked = interactive ? "true" : "false";
      };

      const onLeave = () => {
        targetX = -100;
        targetY = -100;
        scheduleRing();
      };

      window.addEventListener("pointermove", onMove, { passive: true });
      document.addEventListener("pointerleave", onLeave);
      cleanups.push(() => {
        window.removeEventListener("pointermove", onMove);
        document.removeEventListener("pointerleave", onLeave);
      });
    }

    window.addEventListener("scroll", scheduleRail, { passive: true });
    window.addEventListener("resize", measureRail);
    const railResize = new ResizeObserver(measureRail);
    railResize.observe(document.documentElement);
    measureRail();
    cleanups.push(() => {
      window.removeEventListener("scroll", scheduleRail);
      window.removeEventListener("resize", measureRail);
      railResize.disconnect();
      if (ringFrame) window.cancelAnimationFrame(ringFrame);
      if (railFrame) window.cancelAnimationFrame(railFrame);
    });

    /* --------------------------------------------------------- magnets -- */

    {
      const magnets = Array.from(document.querySelectorAll<HTMLElement>(".rx-btn"));
      const listeners: Array<() => void> = [];

      for (const magnet of magnets) {
        const onEnterMove = (event: PointerEvent) => {
          if (!finePointer()) return;
          const box = magnet.getBoundingClientRect();
          const dx = (event.clientX - (box.left + box.width / 2)) / box.width;
          const dy = (event.clientY - (box.top + box.height / 2)) / box.height;
          magnet.style.transform = `translate(${dx * 7}px, ${dy * 5}px)`;
        };
        const onOut = () => {
          magnet.style.transform = "";
        };
        magnet.addEventListener("pointermove", onEnterMove);
        magnet.addEventListener("pointerleave", onOut);
        listeners.push(() => {
          magnet.removeEventListener("pointermove", onEnterMove);
          magnet.removeEventListener("pointerleave", onOut);
          magnet.style.transform = "";
        });
      }
      cleanups.push(() => listeners.forEach((off) => off()));
    }

    return () => cleanups.forEach((off) => off());
  }, []);

  return null;
}
