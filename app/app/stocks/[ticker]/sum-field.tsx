"use client";

import { useEffect, useRef } from "react";

import company from "./company.module.css";

/**
 * The sum of a purchase or a sale, as a person types it (at most six taps and
 * sixty seconds from a company's page to the signature).
 *
 * A press on the field chooses the whole sum, so the next key replaces it:
 * the sheet's $10 becomes $1 with one tap and one key, never a tap and three.
 * The keyboard's own action key — «Go» on a phone, Enter on a desk — is the
 * sheet's one action (`onGo`), so a keyboard over the button never costs a
 * press to close. On a desk, where typing raises no keyboard, the field is
 * ready as the sheet opens: the sum chosen, the next key the new one. On a
 * phone the sheet opens as it was — the keyboard rises only on the person's
 * tap — and stands above it (`useSheetAboveKeyboard`).
 */
export function SumField({
  value,
  onChange,
  onGo,
  label,
  describedBy,
  disabled = false,
  placeholder,
}: Readonly<{
  value: string;
  onChange: (value: string) => void;
  /** The sheet's one action, run from the keyboard's own key; the sheet decides whether it runs now. */
  onGo: () => void;
  label: string;
  describedBy: string;
  disabled?: boolean;
  placeholder?: string;
}>) {
  const field = useRef<HTMLInputElement>(null);
  /* True from the focus to the press that brought it: that press's own caret placement must not undo the choice. */
  const choosing = useRef(false);
  const readied = useRef(false);

  useEffect(() => {
    /* Once, as soon as the field can take a sum — the sale's waits for the position — and only where no keyboard has to rise. */
    const input = field.current;
    if (readied.current || disabled || !input || !typesWithoutRising()) return undefined;
    const frame = window.requestAnimationFrame(() => {
      if (!input.closest("dialog")?.open || input.disabled) return;
      readied.current = true;
      input.focus({ preventScroll: true });
      chooseAll(input);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [disabled]);

  return (
    <form
      className={company.sumForm}
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        onGo();
      }}
    >
      <label className={company.amount}>
        <span className={company.srOnly}>{label}</span>
        <span className={company.amountSign} aria-hidden="true">
          $
        </span>
        <input
          ref={field}
          className={company.amountInput}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onFocus={(event) => {
            choosing.current = true;
            chooseAll(event.currentTarget);
          }}
          onClick={(event) => {
            if (!choosing.current) return;
            choosing.current = false;
            chooseAll(event.currentTarget);
          }}
          onBlur={() => {
            choosing.current = false;
          }}
          inputMode="decimal"
          enterKeyHint="go"
          autoComplete="off"
          spellCheck={false}
          placeholder={placeholder}
          disabled={disabled}
          aria-describedby={describedBy}
          data-sum
        />
      </label>
    </form>
  );
}

/** The whole sum chosen, so a key replaces it; `setSelectionRange` is what a phone's browser honours inside a focus. */
function chooseAll(input: HTMLInputElement) {
  try {
    input.setSelectionRange(0, input.value.length);
  } catch {
    input.select();
  }
}

/** A desk: a mouse or a trackpad, where focusing a field raises no keyboard over the sheet. */
function typesWithoutRising(): boolean {
  return typeof window.matchMedia === "function" && window.matchMedia("(hover: hover) and (pointer: fine)").matches;
}
