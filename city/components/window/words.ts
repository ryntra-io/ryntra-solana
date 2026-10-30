import { words } from '../../lib/i18n/dict.ts';

/** The window frame's own controls (CITY-65), in both languages (CITY-79). The title is the window owner's. */
export const WINDOW = words(
  {
    popOut: 'Pop out',
    full: 'Full screen',
    exitFull: 'Exit full screen',
    close: 'Close',
    openWindows: 'Open windows',
    snap: 'Snap together',
    goOut: 'Open in a new window',
    backToCity: 'Back to the city',
    confirmInWallet: 'Confirm in your wallet',
    outTray: 'Windows on another screen',
    bringBack: (title: string) => `Bring ${title} back`,
    loading: 'Loading',
  },
  {
    popOut: 'Відкріпити',
    full: 'На весь екран',
    exitFull: 'Вийти з повного екрана',
    close: 'Закрити',
    openWindows: 'Відкриті вікна',
    snap: 'Зібрати разом',
    goOut: 'Відкрити в новому вікні',
    backToCity: 'Назад у місто',
    confirmInWallet: 'Підтверди в гаманці',
    outTray: 'Вікна на іншому екрані',
    bringBack: (title: string) => `Повернути «${title}»`,
    loading: 'Завантаження',
  },
);
