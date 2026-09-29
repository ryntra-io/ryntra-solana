/**
 * Compatibility re-export. The evidence envelope lives in `lib/evidence/envelope.ts`
 * and is chain-neutral; Stellar surfaces keep importing it from here so nothing
 * moves twice. New code imports the neutral module directly.
 */
export * from "../evidence/envelope.ts";
