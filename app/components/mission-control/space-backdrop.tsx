"use client";

import { useEffect, useRef } from "react";

/* The sky of the scene above, carried on: the same night (#04070B at the seam), the same white-blue stars, slower. */
const SKY_TOP = "#04070B";
const SKY_BOTTOM = "#080D13";
const STAR_COLORS = ["#F5F7FA", "#D6E6FF", "#9FD4FF", "#F5F7FA", "#FFC7A1"];
const MAX_PIXEL_RATIO = 1.75;
/* The stars twinkle at about 24 frames a second: the eye cannot tell, the battery can. */
const FRAME_MS = 42;
/* Far stars drift a fifth of the scroll: depth without motion sickness. */
const PARALLAX = 0.2;

type Star = { x: number; y: number; r: number; color: string; phase: number; speed: number };

/**
 * The space under Mission Control's scene (MC-0): one viewport-sized canvas, sticky behind the home page's sections, so
 * the page reads as one sky from the scene to the end; and the arrival of each `[data-reveal]` block as it comes into
 * view, starting the SMIL animations marked `data-begin-on-reveal` (with `data-delay` seconds). Draws only while the
 * sections are on screen; with reduced motion the stars stand still and every block is simply there.
 */
export function SpaceBackdrop({ className }: { className?: string }) {
  const canvas = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const element = canvas.current;
    const host = element?.parentElement;
    const context = element?.getContext("2d");
    if (!element || !host || !context) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let stars: Star[] = [];
    let width = 0;
    let height = 0;
    let frame = 0;
    let last = -Infinity;
    let visible = false;

    const seed = (count: number) => {
      let a = 20261025;
      const random = () => {
        a = (a + 0x6d2b79f5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      };
      return Array.from({ length: count }, () => ({
        x: random(),
        y: random(),
        r: random() < 0.92 ? 0.4 + random() * 0.8 : 1.2 + random() * 0.9,
        color: STAR_COLORS[Math.floor(random() * STAR_COLORS.length)],
        phase: random() * Math.PI * 2,
        speed: 0.4 + random() * 1.2,
      }));
    };

    const resize = () => {
      const ratio = Math.min(window.devicePixelRatio || 1, MAX_PIXEL_RATIO);
      width = element.clientWidth;
      height = element.clientHeight;
      element.width = Math.round(width * ratio);
      element.height = Math.round(height * ratio);
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      /* About one star per 3 600 px², as in the scene's far field. */
      stars = seed(Math.min(700, Math.round((width * height) / 3600)));
    };

    const draw = (time: number) => {
      const sky = context.createLinearGradient(0, 0, 0, height);
      sky.addColorStop(0, SKY_TOP);
      sky.addColorStop(1, SKY_BOTTOM);
      context.fillStyle = sky;
      context.fillRect(0, 0, width, height);
      /* How far the sections have scrolled past the top: the field drifts with a fifth of it, wrapping round. */
      const scrolled = Math.max(0, -host.getBoundingClientRect().top) * PARALLAX;
      for (const star of stars) {
        const y = (((star.y * height - scrolled) % height) + height) % height;
        const twinkle = reduced ? 0.75 : 0.55 + 0.45 * Math.sin(star.phase + (time / 1000) * star.speed);
        context.globalAlpha = twinkle * (star.r > 1.2 ? 0.95 : 0.6);
        context.fillStyle = star.color;
        context.beginPath();
        context.arc(star.x * width, y, star.r, 0, Math.PI * 2);
        context.fill();
      }
      context.globalAlpha = 1;
    };

    const loop = (time: number) => {
      if (time - last >= FRAME_MS) {
        last = time;
        draw(time);
      }
      if (visible && !reduced) frame = requestAnimationFrame(loop);
    };

    const onScroll = () => {
      if (reduced && visible) draw(0);
    };

    resize();
    draw(0);
    const sizes = new ResizeObserver(() => {
      resize();
      draw(performance.now());
    });
    sizes.observe(element);
    const sight = new IntersectionObserver((entries) => {
      visible = entries.some((entry) => entry.isIntersecting);
      cancelAnimationFrame(frame);
      if (visible && !reduced) frame = requestAnimationFrame(loop);
    });
    sight.observe(host);
    window.addEventListener("scroll", onScroll, { passive: true });

    /* Each block arrives once, as it comes into view — never with reduced motion. */
    const arrive = (block: Element) => {
      block.setAttribute("data-shown", "");
      if (reduced) return;
      for (const animation of block.querySelectorAll<SVGAnimationElement>("[data-begin-on-reveal]")) {
        animation.beginElementAt(Number(animation.getAttribute("data-delay") ?? 0));
      }
    };
    const blocks = Array.from(host.querySelectorAll("[data-reveal]"));
    const reveal = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          arrive(entry.target);
          reveal.unobserve(entry.target);
        }
      },
      { rootMargin: "0px 0px -12% 0px" },
    );
    for (const block of blocks) {
      if (reduced) arrive(block);
      else reveal.observe(block);
    }

    return () => {
      cancelAnimationFrame(frame);
      sizes.disconnect();
      sight.disconnect();
      reveal.disconnect();
      window.removeEventListener("scroll", onScroll);
    };
  }, []);

  return <canvas ref={canvas} className={className} aria-hidden="true" />;
}
