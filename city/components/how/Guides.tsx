'use client';

import Link from 'next/link';
import { useEffect, useRef, useState, type RefObject } from 'react';
import { useWords } from '@/city/lib/i18n/dict';
import { useLang } from '@/city/lib/i18n/lang';
import { length, type GuideFilm } from '@/city/lib/how/films';
import { GUIDE_ACTION, tryHref, type GuideId, type Lesson } from '@/city/lib/how/guides';
import { PlayGlyph } from './glyphs';
import g from './guides.module.css';
import { GUIDE_WORDS } from './words';

/**
 * «How it works» (CITY-43): the lessons, the same in the window over the city (`GuidesLayer`) and on the page
 * `/how-it-works` (`GuidesPage`). Each lesson is its film, its name, one line and one amber «Try»; its steps wait behind
 * a quiet «Details». In the city «Try» opens the function's window at once; on the page it leads into the city, which
 * opens it there. Only lessons with a film reach here — the caller never passes an empty one.
 */
export type Where = 'window' | 'page';

/** The still at the head: the island from above at night, filmed from our own live 3D city (CITY-64). */
const HERO = { small: '/city/art/district-market-800.webp', large: '/city/art/district-market-1600.webp' };

export function Guides({ where, items, onTry }: { where: Where; items: readonly Lesson[]; onTry?: (id: GuideId) => void }) {
  const w = useWords(GUIDE_WORDS);
  const root = useRef<HTMLDivElement>(null);
  return (
    <div ref={root} className={g.body} data-where={where} data-city-guides="">
      <header className={g.hero}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          className={g.art}
          src={HERO.small}
          srcSet={`${HERO.small} 800w, ${HERO.large} 1600w`}
          sizes={where === 'window' ? '(min-width: 900px) 560px, 100vw' : '100vw'}
          alt=""
          decoding="async"
          fetchPriority={where === 'page' ? 'high' : 'auto'}
        />
        <div className={g.heroBody} data-words="">
          <span className={`${g.display} ${g.kicker}`}>{w.kicker}</span>
          {where === 'page' ? <h1 className={`${g.display} ${g.title}`}>{w.title}</h1> : <h2 className={`${g.display} ${g.title}`}>{w.title}</h2>}
          <p className={g.lead}>{w.lead}</p>
        </div>
      </header>
      <ul className={g.grid} aria-label={w.lessons} data-words="">
        {items.map((lesson, at) => (
          <LessonCard key={lesson.id} lesson={lesson} root={root} onTry={onTry} eager={at < 2} />
        ))}
      </ul>
    </div>
  );
}

/** A lesson's words, by its function. */
function useLessonWords(id: GuideId) {
  const w = useWords(GUIDE_WORDS);
  return {
    name: w[`${id}Name`],
    line: w[`${id}Line`],
    steps: [w[`${id}Step1`], w[`${id}Step2`], w[`${id}Step3`]],
    action: GUIDE_ACTION[id] === 'ask' ? w.ask : GUIDE_ACTION[id] === 'home' ? w.goHome : w.tryIt,
  };
}

function LessonCard({ lesson, root, onTry, eager }: { lesson: Lesson; root: RefObject<HTMLDivElement | null>; onTry?: (id: GuideId) => void; eager: boolean }) {
  const w = useWords(GUIDE_WORDS);
  const words = useLessonWords(lesson.id);
  const [details, setDetails] = useState(false);
  const stepsId = `city-guide-${lesson.id}-steps`;
  return (
    <li className={g.card} data-guide={lesson.id}>
      <Film film={lesson.film} name={words.name} root={root} eager={eager} />
      <div className={g.words}>
        <h3 className={`${g.display} ${g.name}`}>{words.name}</h3>
        <p className={g.line}>{words.line}</p>
        <div className={g.actions}>
          {onTry ? (
            <button type="button" className={`${g.display} ${g.try}`} onClick={() => onTry(lesson.id)}>
              {words.action}
            </button>
          ) : (
            <Link className={`${g.display} ${g.try}`} href={tryHref(lesson.id)} prefetch={false}>
              {words.action}
            </Link>
          )}
          <button type="button" className={g.details} aria-expanded={details} aria-controls={stepsId} onClick={() => setDetails((v) => !v)}>
            {w.details}
            <span className={g.chevron} aria-hidden="true" />
          </button>
        </div>
        {details && (
          <ol id={stepsId} className={g.steps}>
            {words.steps.map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ol>
        )}
      </div>
    </li>
  );
}

/**
 * The film: its cover until it is asked for, then the browser's own player from our own domain — no one else's player,
 * nothing fetched before the tap. Captions in English and Ukrainian, the one on screen in the city's language. One
 * film plays at a time, and a film that scrolls out of view stops.
 */
function Film({ film, name, root, eager }: { film: GuideFilm; name: string; root: RefObject<HTMLDivElement | null>; eager: boolean }) {
  const w = useWords(GUIDE_WORDS);
  const lang = useLang();
  const [playing, setPlaying] = useState(false);
  const video = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    if (playing) void video.current?.play().catch(() => {});
  }, [playing]);
  useEffect(() => {
    const el = video.current;
    if (!playing || !el) return;
    const seen = new IntersectionObserver(([entry]) => !entry?.isIntersecting && el.pause(), { root: root.current, threshold: 0.2 });
    seen.observe(el);
    return () => seen.disconnect();
  }, [playing, root]);
  const onlyThis = () => {
    for (const other of root.current?.querySelectorAll('video') ?? []) if (other !== video.current) other.pause();
  };
  return (
    <div className={g.frame}>
      {playing ? (
        <video ref={video} className={g.video} controls playsInline preload="metadata" poster={film.poster} aria-label={name} onPlay={onlyThis}>
          {film.webm && <source src={film.webm} type="video/webm" />}
          <source src={film.mp4} type="video/mp4" />
          {film.captions?.en && <track kind="captions" src={film.captions.en} srcLang="en" label={w.english} default={lang === 'en'} />}
          {film.captions?.uk && <track kind="captions" src={film.captions.uk} srcLang="uk" label={w.ukrainian} default={lang === 'uk'} />}
        </video>
      ) : (
        <button type="button" className={g.cover} aria-label={w.play(name)} onClick={() => setPlaying(true)}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className={g.poster} src={film.poster} alt="" loading={eager ? 'eager' : 'lazy'} decoding="async" />
          <span className={g.play} aria-hidden="true">
            <PlayGlyph />
          </span>
          {film.seconds ? <span className={g.length}>{length(film.seconds)}</span> : null}
        </button>
      )}
    </div>
  );
}
