/**
 * The «City / Play» switch and Play's own dock (CITY-81) stand only where the deployment's switch says `open`
 * (`NEXT_PUBLIC_RYNTRA_CITY_PLAY`). Since decision 86 the city has one menu of seven places: the Ring and
 * the Vault stand in the Arena, the garage in Agents, and the rest of Play — the Studio's Run and the players' own
 * districts — waits. The layer itself still holds the places of play opened from the
 * menu: your quarter, the garage, the Vault's room.
 */
export function playOpen(value: string | undefined): boolean {
  return value?.trim() === 'open';
}

export const PLAY_OPEN = playOpen(process.env.NEXT_PUBLIC_RYNTRA_CITY_PLAY);
