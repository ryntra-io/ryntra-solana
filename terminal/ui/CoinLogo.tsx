'use client';

import { useEffect, useRef, useState } from 'react';
import { cx } from './cx';
import { darkLogo, LOGO_SAMPLE } from './logo-tone';
import s from './ui.module.css';

/** Each address's answer, once: a logo seen again — the next row, the next screen — stands on its disc at once. */
const TONES = new Map<string, boolean>();

/** The addresses of a list that could not be brought. */
type Gone = Readonly<{ key: string; gone: readonly string[] }>;

/** One more address gone, for the list `key`: the same address twice is still one — an error and a check never skip a next. */
const goneToo =
  (key: string, failed: string) =>
  (was: Gone): Gone => {
    const gone = was.key === key ? was.gone : [];
    return gone.includes(failed) ? was : { key, gone: [...gone, failed] };
  };

/**
 * Whether a loaded logo is dark ink (`darkLogo`), read from the picture drawn small. A picture whose pixels the page
 * may not read (another site's, without its leave) answers no, and stays as it is.
 */
function readTone(img: HTMLImageElement): boolean {
  try {
    const canvas = document.createElement('canvas');
    canvas.width = LOGO_SAMPLE;
    canvas.height = LOGO_SAMPLE;
    const pen = canvas.getContext('2d', { willReadFrequently: true });
    if (!pen) return false;
    pen.drawImage(img, 0, 0, LOGO_SAMPLE, LOGO_SAMPLE);
    return darkLogo(pen.getImageData(0, 0, LOGO_SAMPLE, LOGO_SAMPLE).data);
  } catch {
    return false;
  }
}

/**
 * A coin's logo, from Ryntra's own proxy (`/api/icon/<mint>`) or the address given. A logo that cannot be brought, or a
 * coin without one, leaves a quiet disc with the ticker's first letter — never a broken image. Logos are the engine's:
 * nothing here is drawn for a coin.
 *
 * `also`: the addresses tried in turn when `src` cannot be brought (the engine's logo route answers nothing
 * for some coins, the catalogue's does); the letter only when none of them loads.
 *
 * `eager`: the picture is asked at once — in a list that opens on a tap (what to pay with, the coin picker), where a lazy
 * picture inside a scrolled box waited for a scroll and the person saw letters instead of logos. Long tables
 * stay lazy.
 *
 * A logo in dark ink (Anthropic's black mark on ANT vanished on the glass) stands on a light disc — by the
 * picture's own pixels (`logo-tone.ts`), never by a list of coins; every other logo is drawn as it is.
 */
export function CoinLogo({ src, also, symbol, size = 'm', eager = false, className }: { src: string | null; also?: readonly string[]; symbol: string; size?: 's' | 'm' | 'l' | 'xl'; eager?: boolean; className?: string }) {
  const list = src ? [src, ...(also ?? [])] : [];
  const key = list.join(' ');
  // The addresses of this list that failed: a new list starts again from its first. The first not gone is shown.
  const [missed, setMissed] = useState<Gone>({ key, gone: [] });
  const gone = missed.key === key ? missed.gone : [];
  const now = list.find((one) => !gone.includes(one)) ?? null;
  // A logo read dark once is dark at once the next time; the first load reads it.
  const [read, setRead] = useState<Readonly<{ src: string; dark: boolean }> | null>(null);
  const dark = now !== null && (TONES.get(now) ?? (read?.src === now && read.dark));
  const img = useRef<HTMLImageElement>(null);
  const judge = (src: string, picture: HTMLImageElement | null) => {
    let tone = TONES.get(src);
    if (tone === undefined) {
      if (!picture || !picture.complete || picture.naturalWidth === 0) return;
      tone = readTone(picture);
      TONES.set(src, tone);
    }
    // Another logo of the same address may have read it first: this one draws its answer too.
    if (tone) setRead((was) => (was?.src === src && was.dark ? was : { src, dark: true }));
  };
  // A picture the browser brought — or failed to bring — before the page came alive fired its load or its error unheard
  // (flaw 1: the browser's broken-picture mark stood where a logo was, 2Z in the Portfolio, MET when the
  // source failed). Once mounted it is read: a broken one — complete with no size, and its decoding refused — gives way
  // to the next address or the letter.
  useEffect(() => {
    const picture = img.current;
    if (!now || !picture) return;
    if (!picture.complete || picture.naturalWidth > 0) {
      judge(now, picture);
      return;
    }
    let live = true;
    picture.decode().then(
      () => live && judge(now, picture),
      () => live && setMissed(goneToo(key, now)),
    );
    return () => {
      live = false;
    };
  }, [now, key]);
  const sized = cx(s.logo, size === 's' && s.logoS, size === 'l' && s.logoL, size === 'xl' && s.logoXl, className);
  if (!now) {
    return (
      <span className={cx(sized, s.logoMark)} aria-hidden="true">
        {symbol.replace(/^\$+/u, '').slice(0, 1).toUpperCase()}
      </span>
    );
  }
  // A new address is a new picture: the last coin's logo never stands in while the next one loads.
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      key={now}
      ref={img}
      className={cx(sized, dark && s.logoInk)}
      src={now}
      alt=""
      loading={eager ? 'eager' : 'lazy'}
      decoding="async"
      onLoad={(event) => judge(now, event.currentTarget)}
      onError={() => setMissed(goneToo(key, now))}
    />
  );
}

/** The engine's logo address for a coin of the market read, or none. */
export function coinIcon(coin: Readonly<{ id: string; icon: string | null }>): string | null {
  return coin.icon ? `/api/icon/${coin.id}` : null;
}
