import { freeBuildOpen } from '../../../../../lib/world/layout.ts';

/** This build's free building: closed unless `NEXT_PUBLIC_RYNTRA_CITY_FREE_BUILD=open` (`lib/world/layout.ts`). */
export const FREE_BUILD = freeBuildOpen(process.env.NEXT_PUBLIC_RYNTRA_CITY_FREE_BUILD);
