'use client';

import { useEffect, useLayoutEffect } from 'react';
import { srcSet } from '@/city/lib/art/frames';
import { BRAND } from '@/city/lib/brand';
import { useWords } from '@/city/lib/i18n/dict';
import { hydrateLang } from '@/city/lib/i18n/lang';
import { LOST_CODE, LOST_FRAME, LOST_HOME, LOST_MARK, LOST_SIZES, type LostKind } from '@/city/lib/open/lost';
import { CITY_FONTS } from '@/city/styles/fonts';
import city from '@/city/styles/city.module.css';
import { Mark } from '../hud/Mark';
import { LOST } from './words';
import s from './lost.module.css';

/**
 * The city's own page where there is none (CITY-159): an address that never was (404) or a page that broke (500). The
 * island under the eclipse, filmed from the live city, behind one line and one way back — to the city's home, a full
 * load, so whatever broke starts again clean. The mark stands where the city's top bar has it; nothing else is on the
 * screen. `app/not-found.tsx`, `app/error.tsx` and `app/global-error.tsx` show it.
 */
export function Lost({ kind }: { kind: LostKind }) {
  const w = useWords(LOST);

  // The person's language before the first paint, as in the city (CITY-79).
  useLayoutEffect(() => void hydrateLang(), []);

  // The tab says what happened, in the person's language — also where the page that broke, or the section whose page
  // was not found, had already given it a title of its own.
  const title = kind === 'missing' ? w.missingTitle : w.brokenTitle;
  useEffect(() => {
    document.title = title;
  }, [title]);

  const marked = { [LOST_MARK]: kind };
  return (
    <main className={`${city.root} ${CITY_FONTS.className} ${s.page}`} style={CITY_FONTS.style} {...marked}>
      {/* The frame comes in the widths it was cut to (`city/lib/art/frames.ts`), as the city's cards draw it. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img className={s.art} src={LOST_FRAME.files[0]!.src} srcSet={srcSet(LOST_FRAME)} sizes={LOST_SIZES} alt="" decoding="async" fetchPriority="high" />
      <div className={s.shade} aria-hidden="true" />
      <div className={s.brand} aria-hidden="true">
        <Mark size={32} />
        <span className={s.brandName}>{BRAND.name}</span>
      </div>
      <section className={s.card}>
        <p className={s.code} aria-hidden="true">
          {LOST_CODE[kind]}
        </p>
        <h1 className={s.title}>{kind === 'missing' ? w.missing : w.broken}</h1>
        <a className={s.action} href={LOST_HOME}>
          {w.toCity}
        </a>
      </section>
    </main>
  );
}
