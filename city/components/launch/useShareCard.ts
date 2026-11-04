'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRyntraApp } from '@/city/lib/app-mode';
import { useLang } from '@/city/lib/i18n/lang';
import { drawShareCard, warmCardFrames, type DrawOptions } from '@/city/lib/launch/card-draw';
import { postText } from '@/city/lib/launch/card-words';
import { cardFile, type ShareCard } from '@/city/lib/launch/cards';
import { SHARE_CARD } from '@/city/lib/launch/words';
import { postCard, touchScreen, type PostOutcome } from '@/city/lib/share/post';

/** How long «Card saved» stays after a computer saved the card and opened X. */
const SAVED_MS = 6_000;

/**
 * One tap from a launch's card to a post (L8 · CITY-145): the card is drawn from the frame and the engine's figures at
 * the tap, then goes to the app's or the phone's share sheet, or — on a computer — is saved while X opens with the
 * words and the link. `making` names the card being made, so only its button waits; `saved` asks for the one line.
 */
export function useShareCard() {
  const lang = useLang();
  const app = useRyntraApp();
  const phone = useMemo(touchScreen, []);
  const [making, setMaking] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const busy = useRef(false);
  const live = useRef(true);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    live.current = true;
    /* The stills the cards stand on arrive before the tap, so the share sheet opens while the tap still counts. */
    warmCardFrames();
    return () => {
      live.current = false;
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  const share = useCallback(
    async (id: string, card: ShareCard, link: string, options?: DrawOptions) => {
      if (busy.current) return;
      busy.current = true;
      setMaking(id);
      setSaved(false);
      try {
        const blob = await drawShareCard(card, lang, options).catch(() => null);
        const words = postText(card, lang);
        const outcome = await postCard({ blob, name: cardFile(card), text: `${words} ${link}`, x: { text: words, url: link }, phone }).catch((): PostOutcome => 'failed');
        if (outcome === 'saved' && live.current) {
          setSaved(true);
          if (timer.current) clearTimeout(timer.current);
          timer.current = setTimeout(() => setSaved(false), SAVED_MS);
        }
      } finally {
        busy.current = false;
        if (live.current) setMaking(null);
      }
    },
    [lang, phone],
  );

  const w = SHARE_CARD[lang];
  return { share, making, saved, savedLine: w.saved, label: app || phone ? w.share : w.postOnX };
}
