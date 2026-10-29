/**
 * Somebody else's text in Ryntra City (CITY-73, decision 74): coin names and tickers, launch names, quarter signs,
 * island and crew names, everything the city hands to the assistant or a model. See `README.md`.
 */
export {
  TEXT_LIMITS,
  cleanCrewName,
  cleanIslandName,
  cleanName,
  cleanResidentName,
  cleanSign,
  cleanSymbol,
  cleanText,
  disguised,
  instructionLike,
  shownText,
  type Cleaned,
  type TextKind,
  type TextReason,
} from "./clean.ts";
export { FAMOUS_COINS, lookalikeOf, skeleton, type Lookalike } from "./lookalike.ts";
export { NOT_MEASURED, measured, shownFigure, unmeasuredKeys, type Locale } from "./measured.ts";
export { WITHHELD, forModel, modelField, type ModelField } from "./for-model.ts";
