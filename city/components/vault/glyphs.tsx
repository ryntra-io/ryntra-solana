/** The Vault's glyphs, drawn like the HUD's: one stroke weight, square joins, 24 px. */

export const VaultGlyph = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" aria-hidden="true">
    <path d="M4 3h16v18H4z" />
    <circle cx="12" cy="12" r="4.5" />
    <path d="M12 7.5V10M12 14v2.5M7.5 12H10M14 12h2.5M4 7H2M4 17H2" />
  </svg>
);

export const LockGlyph = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinejoin="round" aria-hidden="true">
    <path d="M6 11h12v10H6zM8.5 11V8a3.5 3.5 0 0 1 7 0v3" />
  </svg>
);

export const CheckGlyph = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinejoin="round" aria-hidden="true">
    <path d="M5 12.5l4.5 4.5L19 7.5" />
  </svg>
);
