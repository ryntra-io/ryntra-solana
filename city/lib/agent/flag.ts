/**
 * The city's scout opens to people only when the flag says `open`; until then the Agents district keeps its quiet
 * "opens soon".
 */
export const AGENTS_OPEN = process.env.NEXT_PUBLIC_RYNTRA_CITY_AGENTS === 'open';
