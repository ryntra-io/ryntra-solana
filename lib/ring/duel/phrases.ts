/**
 * The secret phrases of Duo Crack (CITY-51): three plain English words drawn by the harness — never by an agent, never
 * by its owner — from a fixed list of 256, so 16.7 million phrases, each word easy for any model to say back exactly.
 * The draw takes its randomness from outside (`node:crypto`'s `randomInt` on the server, a seeded one in tests).
 *
 * Pure: no store, no clock, no network.
 */

/** 256 distinct words, lowercase a–z, 3 to 8 letters: concrete things a model spells back exactly. */
export const PHRASE_WORDS: readonly string[] = [
  "amber", "anchor", "apple", "arrow", "ash", "atlas", "badge", "bamboo", "banjo", "barn", "basil", "beacon", "bean", "bear",
  "bell", "berry", "birch", "bison", "blade", "bloom", "boat", "bolt", "bone", "brass", "brick", "bridge", "brook", "brush",
  "bucket", "cabin", "cable", "cactus", "camel", "canal", "candle", "canoe", "canyon", "carbon", "cargo", "carrot", "castle", "cedar",
  "chalk", "cherry", "chess", "chorus", "cider", "cliff", "clock", "cloud", "clover", "cobalt", "cocoa", "comet", "copper", "coral",
  "cotton", "crane", "crater", "crown", "cube", "curtain", "daisy", "delta", "denim", "desert", "diesel", "dingo", "dolphin", "dome",
  "dragon", "drum", "dune", "eagle", "echo", "ember", "engine", "falcon", "feather", "fern", "ferry", "fiddle", "fig", "flame",
  "flint", "forest", "fossil", "fox", "frost", "garden", "garlic", "gecko", "geyser", "ginger", "glacier", "globe", "goat", "gold",
  "granite", "grape", "gravel", "harbor", "harp", "hazel", "helmet", "heron", "hill", "honey", "hornet", "igloo", "indigo", "iris",
  "island", "ivory", "jacket", "jade", "jaguar", "jelly", "jungle", "kayak", "kettle", "kite", "koala", "ladder", "lagoon", "lake",
  "lantern", "laser", "lava", "lemon", "lily", "lime", "linen", "lion", "lizard", "lobster", "lotus", "magnet", "mango", "maple",
  "marble", "meadow", "melon", "meteor", "mint", "mirror", "moose", "moss", "motor", "mountain", "mule", "nectar", "needle", "nest",
  "nickel", "noodle", "nutmeg", "oak", "oasis", "ocean", "olive", "onion", "opal", "orbit", "orchid", "otter", "owl", "oyster",
  "paddle", "panda", "paper", "parrot", "peach", "pearl", "pebble", "pepper", "piano", "pigeon", "pillow", "pine", "planet", "plum",
  "pocket", "pony", "poppy", "prism", "pumpkin", "quartz", "quill", "rabbit", "radar", "radish", "rain", "raven", "reef", "ribbon",
  "river", "robin", "rocket", "rose", "ruby", "saddle", "sail", "salmon", "sand", "satin", "scarf", "shadow", "shell", "silk",
  "silver", "sled", "slate", "smoke", "snail", "socket", "sparrow", "spider", "spoon", "spruce", "squid", "stamp", "steel", "stone",
  "storm", "straw", "sugar", "summit", "swan", "tablet", "tiger", "timber", "toast", "tomato", "topaz", "torch", "tower", "trumpet",
  "tulip", "tundra", "turtle", "umbrella", "valley", "velvet", "violet", "volcano", "wagon", "walnut", "walrus", "whale", "wheat", "willow",
  "window", "winter", "wolf", "yacht",
];

export const PHRASE_LENGTH = 3;

/** Draws a phrase: `randomInt(n)` is a uniform whole number in 0 … n − 1. Three different words. */
export function drawPhrase(randomInt: (n: number) => number): string {
  const picked: string[] = [];
  while (picked.length < PHRASE_LENGTH) {
    const word = PHRASE_WORDS[randomInt(PHRASE_WORDS.length)];
    if (word === undefined) throw new RangeError("randomInt went out of range");
    if (!picked.includes(word)) picked.push(word);
  }
  return picked.join(" ");
}

/**
 * A phrase as it is compared: Unicode-folded, lowercase, every run of what is not a letter or a digit one space,
 * trimmed. «Amber-Falcon  NINE!» and «amber falcon nine» are the same phrase.
 */
export function normalizePhrase(raw: string): string {
  return raw
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}
