import { visitorId } from './world.ts';

/**
 * The run log: one small event per run start and end, sent with sendBeacon to our own
 * /api/run. An anonymous id and game facts only: no name, no wallet, no address.
 */
export type TrackEvent =
  | { ev: 'home'; challenge?: boolean; touch?: boolean }
  | { ev: 'play'; from: 'home' | 'city' | 'result'; form: string }
  | { ev: 'explore' }
  | { ev: 'run_start'; form: string; course: string; attempt: number; again: boolean }
  | { ev: 'run_end'; form: string; course: string; attempt: number; result: 'finish' | 'crash' | 'quit'; time: number; progress: number; reason?: string; routes?: string; node?: string; hits?: number; best?: boolean }
  | { ev: 'challenge'; form: string; course: string };

export function track(event: TrackEvent) {
  try {
    const body = JSON.stringify({ ...event, id: visitorId(), at: Date.now() });
    if (navigator.sendBeacon?.('/api/run', new Blob([body], { type: 'application/json' }))) return;
    void fetch('/api/run', { method: 'POST', body, headers: { 'content-type': 'application/json' }, keepalive: true });
  } catch {
    // The game never waits on the log.
  }
}
