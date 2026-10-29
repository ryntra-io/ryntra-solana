'use client';

import { playTick } from '@/city/lib/audio/engine';
import { useCity } from '@/city/lib/city/store';
import { VAULT_OPEN } from '@/city/lib/vault/flag';
import { useVault, vaultStore } from '@/city/lib/vault/store';
import s from '../hud/hud.module.css';
import { VaultGlyph } from './glyphs';
import v from './vault.module.css';

/**
 * The Vault in the city's dock, once its flag is open: one more district beside the others, drawn as they are. A tap
 * opens the room (the camera flies to the door); a second tap closes it.
 */
export function VaultDockItem() {
  const open = useVault((st) => st.open);
  if (!VAULT_OPEN) return null;
  return (
    <button
      className={[s.dockItem, v.dockVault, open && s.dockOn].filter(Boolean).join(' ')}
      aria-label="Vault"
      aria-pressed={open}
      data-hint="Talk the guard out of the phrase"
      onClick={() => {
        if (useCity.getState().sound) playTick();
        if (vaultStore.getState().open) return vaultStore.getState().leave();
        useCity.getState().select(null);
        void vaultStore.getState().enter();
      }}
    >
      <span className={s.dockGlyph}>
        <VaultGlyph />
      </span>
      <span className={s.dockLabel}>Vault</span>
    </button>
  );
}
