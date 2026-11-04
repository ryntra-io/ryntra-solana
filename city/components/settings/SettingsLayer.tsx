'use client';

import dynamic from 'next/dynamic';
import { useEffect, useMemo, useRef } from 'react';
import { useHudPanels } from '@/city/lib/city/windows';
import { openTower, standsInCity } from '@/city/lib/coin/open';
import { EARN_OPEN } from '@/city/lib/earn/flag';
import { isEarnNoteKind } from '@/city/lib/earn/notes';
import { openEarn } from '@/city/lib/earn/open';
import { hydrateFeed } from '@/city/lib/feed/store';
import { useWords } from '@/city/lib/i18n/dict';
import { useFilming } from '@/city/lib/moments/MomentsLayer';
import { startNotifySources } from '@/city/lib/notify/sources';
import { hydrateNotify, notify, setNotifyEnv } from '@/city/lib/notify/store';
import { useRun } from '@/city/lib/run/store';
import { closeSettings } from '@/city/lib/settings/view';
import { Banners } from '../notify/Banners';
import { useCityWindow } from '../window/useCityWindow';
import { GearGlyph } from './glyphs';
import { SETTINGS } from './words';
import s from './settings.module.css';

// The window's contents load the first time it opens: the city's first frame carries none of them.
const SettingsWindow = dynamic(() => import('./SettingsWindow'), { ssr: false, loading: () => <div className={s.pending} aria-busy="true" /> });

/**
 * Settings and the notification centre (CITY-87) in the city's one window frame (CITY-65): the window opens from the
 * avatar and the menu (`openSettings`), on a phone as the bottom sheet. Mounted once in `CityApp`, it also reads the
 * person's centre after the first paint, starts the sources that tell through it, and stands the banners.
 */
export function SettingsLayer({ onSound }: { onSound: (on: boolean) => void }) {
  const open = useHudPanels((st) => st.settings);
  const running = useRun((st) => st.phase !== 'off');
  const filming = useFilming();
  const title = useWords(SETTINGS).settings;
  const sound = useRef(onSound);
  sound.current = onSound;

  // After the first paint, so the server's page and the browser's agree.
  useEffect(() => {
    hydrateFeed();
    setNotifyEnv({
      open: (tower) => standsInCity(tower) && openTower(tower),
      // Earn's notes are about no tower: the computer's notification opens Earn's «Mine» (CITY-100).
      openKind: (kind) => {
        if (EARN_OPEN && isEarnNoteKind(kind)) openEarn('mine');
      },
    });
    hydrateNotify();
    // Development builds only: the stand's hook for the review shots (`city/lib/settings/shots.mjs`).
    if (process.env.NODE_ENV !== 'production') (window as unknown as { __cityNotify?: typeof notify }).__cityNotify = notify;
    return startNotifySources();
  }, []);

  const shown = open && !(running || filming);
  const spec = useMemo(
    () => ({
      id: 'settings',
      title,
      icon: <GearGlyph />,
      render: () => <SettingsWindow onSound={(on: boolean) => sound.current(on)} />,
      size: { width: 700, height: 680 },
      min: { width: 360, height: 420 },
      onClose: closeSettings,
    }),
    // A new language is a new title: the open window's head follows it.
    [title],
  );
  useCityWindow(shown, spec);
  // A run or a clip owns the screen: no banner stands over it.
  return running || filming ? null : <Banners />;
}
