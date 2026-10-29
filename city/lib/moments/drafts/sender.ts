import type { Draft, MediaType } from './store.ts';

/**
 * The sender: what puts an approved draft on X. Its shape lives here; the real one is `x-sender` (`city/lib/x`,
 * CITY-39), connected only with `RYNTRA_X_SENDER=on` and the X keys the owner adds to the environment. There is no X
 * key in this repository. Without them the queue's sender is not connected and refuses without touching the network;
 * `NO_SENDER` below is the same refusal, for tests. The switch that lets a sender run is off by default.
 */

export type OutgoingPost = Readonly<{
  draftId: string;
  text: string;
  link: string;
  media: { type: MediaType; bytes: Uint8Array } | null;
}>;

export type SendResult = { ok: true; postId: string } | { ok: false; error: string };

export interface XSender {
  /** False until a real sender is connected; the desk says so. */
  readonly connected: boolean;
  /**
   * A scheduled sender posts on its own clock (`city/lib/x`, CITY-39): approving a draft or turning the switch on
   * only puts it in line, and the publisher's cron sends it in the next open slot.
   */
  readonly scheduled?: boolean;
  send(post: OutgoingPost): Promise<SendResult>;
}

export const NOT_CONNECTED = 'Sender not connected: X keys and publishing are the owner’s word.';

/** The only sender there is: it never sends. */
export const NO_SENDER: XSender = {
  connected: false,
  async send() {
    return { ok: false, error: NOT_CONNECTED };
  },
};

/** The post a sender would get for a draft: its words, its link and its clip. */
export function outgoing(draft: Draft, media: OutgoingPost['media']): OutgoingPost {
  return { draftId: draft.id, text: draft.text, link: draft.link, media };
}
