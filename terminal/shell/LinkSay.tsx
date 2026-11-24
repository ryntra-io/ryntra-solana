'use client';

import { useEffect, useState } from 'react';
import { create } from 'zustand';
import { opensFromLink, SAY_PARAM, sentenceOfQuery } from '../../lib/mcp/say.ts';
import { modelWanted } from './ask-route.ts';
import { beginSentence } from './ask.ts';
import { useAskRows, useSay } from './say';

/**
 * A sentence that came in a link — `ryntra.io/?say=trade 1 SOL a day`, the link another AI writes for the person through
 * Ryntra's MCP (`lib/mcp/**`) — said to the agent once, as the page opens, and taken out of the address.
 *
 * The line's own reading decides, as if the person had typed it: a reading a link may open (`lib/mcp/say.ts` — never a
 * transfer, never a question) that the line's rules read in full opens its screen filled, and the person signs there.
 * Anything else — a transfer, a question, a sentence only the model could place — stands in the agent's line for the
 * person to read and say themselves. No model is asked on a link's word, and nothing here signs.
 */
/**
 * A link's sentence left for the person to say themselves, for the home page's own field: there the header's line is
 * hidden (`./shell.module.css`), so the Market's agent panel takes it (`terminal/market/HomeHero.tsx`). Fresh for a few
 * seconds — the page the link opens — and taken once.
 */
export const useLinkLeft = create<{ left: Readonly<{ said: string; at: number }> | null }>(() => ({ left: null }));

/** How long a left sentence waits for the home page's field, ms. */
export const LINK_LEFT_MS = 10_000;

/** The sentence a link left for the home page's field, once, while fresh; null otherwise. */
export function takeLinkLeft(now = Date.now()): string | null {
  const left = useLinkLeft.getState().left;
  if (!left) return null;
  useLinkLeft.setState({ left: null });
  return now - left.at <= LINK_LEFT_MS ? left.said : null;
}

export function LinkSay() {
  const [said, setSaid] = useState<string | null>(null);
  const rows = useAskRows(said ?? '');
  const say = useSay();

  // Once, as the frame opens: the sentence out of the address, in place (the router follows the browser's own history),
  // so Back and a reload never say it again.
  useEffect(() => {
    const url = new URL(window.location.href);
    if (!url.searchParams.has(SAY_PARAM)) return;
    const sentence = sentenceOfQuery(url.search);
    url.searchParams.delete(SAY_PARAM);
    window.history.replaceState(window.history.state, '', url);
    if (sentence) setSaid(sentence);
  }, []);

  useEffect(() => {
    if (!said) return;
    setSaid(null);
    const first = rows[0] ?? null;
    if (first && opensFromLink(first.command.kind) && !modelWanted(said, first)) say(said, first);
    else {
      beginSentence(said);
      useLinkLeft.setState({ left: { said, at: Date.now() } });
    }
  }, [said, rows, say]);

  return null;
}
