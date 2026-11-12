import { useCity } from '../city/store.ts';
import { vaultStore } from './store.ts';

/**
 * Into the Vault's room from the city — its tower, its name over it (CITY-241) — as «Arena → Vault» opens it: the
 * picked tower lets go and the camera flies to the door. Already inside, the room stays as it is.
 */
export function enterVault(): void {
  if (vaultStore.getState().open) return;
  useCity.getState().select(null);
  void vaultStore.getState().enter();
}
