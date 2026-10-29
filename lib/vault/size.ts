/**
 * How long an attempt may be, for the server and the city alike. Its own small file, so the city's bundle takes these
 * two and none of the screen's word lists.
 */

export const MAX_ATTEMPT_CHARS = 280;

/** Characters, as a person counts them (an emoji is one). */
export const charCount = (text: string): number => [...text].length;
