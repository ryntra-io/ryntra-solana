import Image from "next/image";
import Link from "next/link";
import { ArrowRight } from "@phosphor-icons/react/dist/ssr";
import type { PublicLocale } from "@/lib/site/locale";
import { HOMEPAGE_COPY } from "@/lib/site/homepage-copy";
import heroArt from "./hero-art.png";
import styles from "./hero-render.module.css";

/**
 * PARKED — the finished render as the hero, unmounted on 2026-09-14.
 *
 * That day the hero was rebuilt in code (`hero.tsx`): the same composition
 * — the words, the Spot workspace in a tilted device, the two cards, the
 * rail and the strip — with the atmosphere painted by the page instead of
 * the render's landscape, so that the top of the site and the blocks below
 * it are one fabric, the type is crisp at every width and the figures are
 * the page's own one story. This file keeps the render
 * version as it was, with `hero-art.png`, so it can be mounted again by
 * pointing `homepage.tsx` at `Hero` from here.
 *
 * What it was. The hero — the finished render, mounted as the hero itself.
 *
 * On the evening of 2026-09-13 the drawn hero (`hero-drawn.tsx`, parked) was
 * replaced with a finished render of the same composition: the headline, the
 * Spot workspace with NVDAx open, the Portfolio and Rewards cards, the Solana
 * rail and the strip of four — to stand large as the hero, and to be live
 * where its *Open App* leads into the cabinet.
 *
 * So the picture is the hero from 1024 px up, as large as the first screen
 * allows without leaving it, and one thing on it is live: the *Open App*
 * button, which is a real link laid over the button's place in the render
 * (measured on the file — left 9.27 %, top 50.05 %, 14.53 × 7.12 % — with a
 * little room around it). Everything the picture says is also in the
 * document: the `h1`, the sub-line and the lead stay in the markup for the
 * reader who cannot see it and for the search engine, visually hidden on the
 * wide layout and shown above the picture below 1024 px, where the render's
 * type would be too small to read.
 *
 * The figures in the render are the render's own — illustrative, and the alt
 * says so. Nothing in it is a live quote.
 *
 * The landing is one continuous ground (`landing.module.css` paints it on
 * `main`, in the render's own bottom tone), so this section has no ground,
 * no light and no line of its own at its foot: the render's last rows are
 * that ground, and the next section begins in the same dark. As the reader
 * scrolls, the picture recedes — scales toward its foot and dims — and the
 * next section rises over it; a scroll-driven animation in CSS, with no
 * effect where the browser has none and none under reduced motion.
 */

/* Where the button sits in the render, as fractions of its box. */
const OPEN_APP_AREA = { left: "8.8%", top: "49.2%", width: "15.5%", height: "8.8%" } as const;

export function Hero({ locale }: { locale: PublicLocale }) {
  const c = HOMEPAGE_COPY[locale];
  const h = c.hero;

  return (
    <section className={styles.hero} aria-labelledby="homepage-title">
      <div className={styles.copy}>
        <h1 id="homepage-title" className={styles.h1}>
          {c.titleLines.map((line, index) => (
            <span key={line} className={index === 1 ? styles.h1Accent : undefined}>{line}</span>
          ))}
        </h1>
        <p className={styles.sub}>{h.sub}</p>
        <p className={styles.lead}>{h.lead}</p>
        <div className={styles.actions}>
          <Link className={styles.primary} href="/app/swap" prefetch={false}>
            {h.open}
            <ArrowRight size={18} weight="bold" aria-hidden />
          </Link>
        </div>
      </div>

      <div className={styles.art}>
        <div className={styles.artMotion}>
          <Image
            src={heroArt}
            alt={h.imageAlt}
            priority
            quality={88}
            sizes="(min-width: 1024px) min(100vw, 1920px), 100vw"
            className={styles.image}
          />
          {/* The one live thing on the picture. */}
          <Link
            className={styles.openArea}
            href="/app/swap"
            prefetch={false}
            aria-label={h.openArea}
            style={OPEN_APP_AREA}
          />
        </div>
      </div>
    </section>
  );
}
