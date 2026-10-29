import { createHmac } from "node:crypto";

/**
 * The phrase a vault keeps: a few plain words, made by the server from its secret, the vault and the day, so every
 * instance of the server knows today's phrase without storing it and nobody knows it without the secret. A new day is
 * a new phrase; what a person cracked stays theirs.
 *
 * The words are five letters or longer and none is a word a guard says anyway (door, vault, phrase), so a guard's
 * ordinary sentence never looks like a leak.
 */
export const WORDS: readonly string[] = [
  "amber", "anchor", "arrow", "atlas", "autumn", "badger", "banjo", "beacon", "birch", "blossom", "bramble", "breeze",
  "bronze", "cactus", "canyon", "carbon", "castle", "cedar", "cherry", "cinder", "citrus", "clover", "cobalt", "comet",
  "copper", "coral", "cotton", "crater", "cricket", "crystal", "cypress", "dragon", "ember", "falcon", "feather",
  "fennel", "forest", "fossil", "garnet", "geyser", "ginger", "glacier", "granite", "hazel", "hermit", "hollow",
  "honey", "horizon", "iceberg", "indigo", "island", "ivory", "jasmine", "jigsaw", "juniper", "kettle", "lantern",
  "lemon", "lilac", "lizard", "lotus", "magnet", "mango", "maple", "marble", "meadow", "meteor", "mirror", "monsoon",
  "mosaic", "nectar", "nickel", "nutmeg", "oasis", "olive", "orbit", "orchid", "otter", "oyster", "paddle", "panther",
  "papaya", "parrot", "pebble", "pepper", "pigeon", "pillow", "pirate", "planet", "plasma", "pollen", "prism",
  "puzzle", "quartz", "quiver", "rabbit", "raven", "ribbon", "river", "rocket", "saffron", "salmon", "sapphire",
  "satin", "scarlet", "shadow", "silver", "sparrow", "spiral", "spruce", "summit", "sunset", "temple", "thistle",
  "thunder", "tiger", "timber", "topaz", "tulip", "tundra", "turtle", "velvet", "walnut", "willow", "winter",
  "wizard", "zephyr",
];

/** The phrase of a vault on a day: `count` different words, the same on every instance that holds the secret. */
export function phraseOf(secret: string, vaultId: string, day: string, count: number): string[] {
  const words: string[] = [];
  for (let round = 0; words.length < count && round < 16; round += 1) {
    const bytes = createHmac("sha256", secret).update(`vault-phrase:v1:${vaultId}:${day}:${round}`).digest();
    for (let i = 0; i + 4 <= bytes.length && words.length < count; i += 4) {
      const word = WORDS[bytes.readUInt32BE(i) % WORDS.length]!;
      if (!words.includes(word)) words.push(word);
    }
  }
  return words;
}

/** Text as words for comparing: compatibility forms folded, lower case, everything but letters a space. */
export function plainWords(text: string): string {
  return text
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}]+/gu, " ")
    .trim();
}

/** Whether an attempt is the phrase itself: the same words in the same order, case and punctuation aside. */
export function isPhrase(text: string, words: readonly string[]): boolean {
  return words.length > 0 && plainWords(text) === words.join(" ");
}
