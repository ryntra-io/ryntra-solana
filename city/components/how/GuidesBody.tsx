'use client';

import { Guides } from './Guides';
import { tryGuide } from './try';
import { useLessons } from './useLessons';

/** The window's contents (loaded the first time it opens): the lessons, «Try» opening each function right here. */
export default function GuidesBody() {
  const items = useLessons();
  return <Guides where="window" items={items} onTry={tryGuide} />;
}
