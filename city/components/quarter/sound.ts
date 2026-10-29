import { setMuted, startAudio } from '@/city/lib/audio/engine';
import { useCity } from '@/city/lib/city/store';

/** Whether the visitor muted the city themselves on this visit: their choice wins over every tap after it. */
let silenced = false;

/** Follows the city's sound switch; returns the call that stops following it. */
export function watchSound(): () => void {
  return useCity.subscribe((now, before) => {
    if (before.sound && !now.sound) silenced = true;
    else if (!before.sound && now.sound) silenced = false;
  });
}

/**
 * The tap that claims a spot or opens the quarter also starts the sound, as the tap that starts a run does
 * (browsers start sound only from a tap), unless the visitor chose silence: a module lands with its sound.
 */
export function wakeSound() {
  const city = useCity.getState();
  if (city.sound || silenced) return;
  city.setSound(true);
  void startAudio()
    .then(() => setMuted(false))
    .catch(() => {});
}
