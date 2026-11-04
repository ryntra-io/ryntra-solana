import 'server-only';

import { buildSection, docsFrame } from './book';
import { CITY_STATUS } from './doors';
import { docsFacts } from './facts';
import type { DocId } from './model';

/** The documentation as this build stands: its figures from the product's modules, what is open from the deployment's switches. */
export function readDocsFrame() {
  return docsFrame(docsFacts(), CITY_STATUS);
}

export function readSection(id: DocId) {
  const facts = docsFacts();
  return { en: buildSection(id, 'en', facts, CITY_STATUS), uk: buildSection(id, 'uk', facts, CITY_STATUS) };
}
