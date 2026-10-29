'use client';

import { HowItWorks } from './HowItWorks';
import { WarmCards } from './Intro';

/**
 * The city's frames on the page (CITY-64), in one place for `CityApp`: «How the city works» over everything when the menu
 * opens it, and the district cards' frames fetched once the live city is drawn.
 */
export function Art() {
  return (
    <>
      <WarmCards />
      <HowItWorks />
    </>
  );
}
