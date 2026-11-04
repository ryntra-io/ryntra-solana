'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { districtFrame, srcSet } from '@/city/lib/art/frames';
import { useLang } from '@/city/lib/i18n/lang';
import { launchWindowNow, windowLine } from '@/city/lib/launch/launch-window';
import s from './launch.module.css';

/** Our own docks, filmed from the live city (CITY-64): where the tower will rise. */
const DOCKS = districtFrame('launch');

/**
 * The live preview of the tower (CITY-143): the docks of our own city and the coin's face rising over them as the sheet
 * fills — the picture in its ring, the ticker and the name as they are typed, one step higher for each. With a mouse the
 * whole preview is the picture's button (`children` — the file input); with a finger (`doors`, CITY-168) it holds two
 * big doors to the picture, the camera and the gallery, which fold to two small ones once there is a picture. It is a
 * preview only: the tower itself rises in the docks once the launch lands.
 */
export function LaunchPreview({
  inputId,
  picture,
  symbol,
  name,
  rise,
  bad,
  words,
  doors,
  children,
}: {
  inputId: string;
  picture: string | null;
  symbol: string;
  name: string;
  /** 0 … 1: how much of the sheet is filled. */
  rise: number;
  bad: boolean;
  words: Readonly<{ picture: string; tickerPlaceholder: string; namePlaceholder: string; takePhoto: string; gallery: string }>;
  /** A finger's two file inputs; null with a mouse. */
  doors: Readonly<{ camera: ReactNode; gallery: ReactNode }> | null;
  children: ReactNode;
}) {
  const inside = (
    <>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img className={s.previewFrame} src={DOCKS.files[0]!.src} srcSet={srcSet(DOCKS)} sizes="(min-aspect-ratio: 1/1) 440px, 100vw" alt="" draggable={false} />
      <span className={s.previewShade} aria-hidden="true" />
      <WindowClock />
      <span className={s.beam} aria-hidden="true" />
      {(picture || !doors) && (
        <span className={`${s.badge} ${picture ? s.badgeSet : ''} ${bad ? s.badgeBad : ''}`} style={picture ? { backgroundImage: `url(${picture})` } : undefined}>
          {!picture && (
            <>
              <b aria-hidden="true">+</b>
              <span>{words.picture}</span>
            </>
          )}
        </span>
      )}
      <span className={s.plate}>
        <b className={`${s.display} ${symbol ? '' : s.plateEmpty}`}>${symbol || words.tickerPlaceholder}</b>
        <span className={name ? '' : s.plateEmpty}>{name || words.namePlaceholder}</span>
      </span>
      {children}
    </>
  );
  const className = `${s.preview} ${rise >= 1 ? s.previewReady : ''}`;
  const style = { ['--rise' as string]: rise };
  if (!doors) {
    return (
      <label className={className} htmlFor={inputId} style={style} data-launch-preview="">
        {inside}
      </label>
    );
  }
  return (
    <div className={className} style={style} data-launch-preview="">
      {inside}
      <div className={`${s.doors} ${picture ? s.doorsFolded : ''} ${bad ? s.doorsBad : ''}`}>
        <label className={s.door}>
          <CameraGlyph />
          <span className={`${s.display} ${s.doorWord}`}>{words.takePhoto}</span>
          {doors.camera}
        </label>
        <label className={s.door}>
          <GalleryGlyph />
          <span className={`${s.display} ${s.doorWord}`}>{words.gallery}</span>
          {doors.gallery}
        </label>
      </div>
    </div>
  );
}

const CameraGlyph = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" strokeLinecap="square" aria-hidden="true">
    <path d="M3 8h4.5L9 5h6l1.5 3H21v11H3z" />
    <circle cx="12" cy="13" r="3.5" />
  </svg>
);

const GalleryGlyph = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" strokeLinecap="square" aria-hidden="true">
    <path d="M3 5h18v14H3z" />
    <path d="M3 16l5-5 4 4 3-3 6 6" />
    <circle cx="16" cy="9" r="1" />
  </svg>
);

/**
 * The launch windows' clock (CITY-143): the published schedule, ticking on this device. A show only — a launch goes out
 * whenever its creator signs; nothing waits for a window and no window promises a fairer start.
 */
function WindowClock() {
  useLang();
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  if (now === null) return null;
  const open = launchWindowNow(now).open;
  return (
    <span className={`${s.clock} ${open ? s.clockOpen : ''}`} data-launch-clock="">
      <i aria-hidden="true" />
      {windowLine(now)}
    </span>
  );
}
