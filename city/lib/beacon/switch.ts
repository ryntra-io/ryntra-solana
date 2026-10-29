import { beaconsMode } from '../../../lib/world/beacons/switch.ts';

/** This build's beacons: closed unless `NEXT_PUBLIC_RYNTRA_CITY_BEACONS` is `device` or `open` (`lib/world/beacons/switch.ts`). */
export const BEACONS = beaconsMode(process.env.NEXT_PUBLIC_RYNTRA_CITY_BEACONS);
