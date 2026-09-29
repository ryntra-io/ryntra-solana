import type { LandingLocale } from "./landing-copy";
import { SHOT_SIZE, SHOT_THEMES, shotSrc, type ShotName } from "./landing-shots";
import styles from "./blocks.module.css";

/**
 * One screen of `ryntra.io` in a phone's frame, in the reader's theme. Both
 * files are named in the markup; the stylesheet shows the one that matches
 * `data-theme`, and a lazy image the page never shows is never fetched.
 */
export function Shot({ name, locale, alt, className }: { name: ShotName; locale: LandingLocale; alt: string; className?: string }) {
  return (
    <span className={className ? `${styles.phone} ${className}` : styles.phone}>
      <span className={styles.screen}>
        {SHOT_THEMES.map((theme) => (
          // eslint-disable-next-line @next/next/no-img-element -- a screen of the product at its own size, already WebP
          <img
            key={theme}
            className={theme === "dark" ? styles.shotDark : styles.shotLight}
            src={shotSrc(name, locale, theme)}
            alt={alt}
            width={SHOT_SIZE.width}
            height={SHOT_SIZE.height}
            loading="lazy"
            decoding="async"
          />
        ))}
      </span>
    </span>
  );
}
