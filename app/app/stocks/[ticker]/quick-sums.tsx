"use client";

import { Button } from "@ryntra/core/ui";
import { useId, useRef, useState, type FormEvent } from "react";

import { investWords } from "@/app/app/invest/invest-words";
import type { WorkspaceLocale } from "@/app/shell/locale";
import { useQuickBuySums } from "@/app/solana/workspace/spot/quick-buy";
import { QUICK_BUY_COUNT, quickSum, quickSumLabel } from "@/lib/spot/quick-trade";

import company from "./company.module.css";

/**
 * «Швидка купівля» on a company's page: the person's four sums, one tap each from
 * the sheet on that sum with its Review; «Змінити швидкі суми» turns them into four
 * fields — the same sums, remembered on this device, as on Spot.
 */
export function QuickSums({ locale, onPick }: Readonly<{ locale: WorkspaceLocale; onPick: (usd: number) => void }>) {
  const lang = locale === "uk" ? "uk" : "en";
  const word = investWords(locale);
  const [sums, save] = useQuickBuySums();
  const [drafts, setDrafts] = useState<string[] | null>(null);
  const [invalid, setInvalid] = useState(false);
  const labelId = useId();
  const errorId = useId();
  const row = useRef<HTMLDivElement>(null);
  /* Back from the fields, the keyboard lands where it left: on the pencil. */
  const leave = () => {
    setDrafts(null);
    setInvalid(false);
    window.requestAnimationFrame(() => row.current?.querySelector<HTMLButtonElement>("[data-quick-edit]")?.focus());
  };
  const finish = (event: FormEvent) => {
    event.preventDefault();
    const parsed = (drafts ?? []).map((draft) => quickSum(draft, lang));
    if (parsed.length !== QUICK_BUY_COUNT || parsed.some((sum) => sum === null)) {
      setInvalid(true);
      return;
    }
    save(parsed as number[]);
    leave();
  };
  return (
    <div ref={row} className={company.quickBuy} data-quick-buy-row>
      <span id={labelId} className={company.quickBuyLabel}>
        {word("quickBuy")}
      </span>
      {drafts ? (
        <form
          className={company.quickBuyRow}
          data-editing="true"
          aria-label={word("quickSumsEdit")}
          onSubmit={finish}
          onKeyDown={(event) => {
            if (event.key !== "Escape") return;
            /* Escape leaves the sums as they were — and stops here, so nothing around closes. */
            event.preventDefault();
            event.stopPropagation();
            leave();
          }}
          noValidate
        >
          {drafts.map((draft, index) => (
            <label key={index} className={company.quickSumField} data-invalid={invalid && quickSum(draft, lang) === null ? "true" : undefined}>
              <span aria-hidden="true">$</span>
              <input
                inputMode="decimal"
                autoComplete="off"
                spellCheck={false}
                value={draft}
                aria-label={`${word("quickSumField")} ${index + 1}`}
                aria-invalid={invalid && quickSum(draft, lang) === null ? true : undefined}
                aria-describedby={invalid ? errorId : undefined}
                autoFocus={index === 0}
                onChange={(event) => {
                  const value = event.target.value;
                  setDrafts((current) => (current ?? []).map((entry, at) => (at === index ? value : entry)));
                }}
              />
            </label>
          ))}
          <Button type="submit" variant="secondary" icon="check" aria-label={word("quickSumsSave")} title={word("quickSumsSave")} lang={lang} />
        </form>
      ) : (
        <div className={company.quickBuyRow} role="group" aria-labelledby={labelId}>
          {sums.map((usd, index) => (
            <Button key={`${index}:${usd}`} variant="secondary" aria-haspopup="dialog" aria-label={`${word("quickBuyFor")} ${quickSumLabel(usd, lang, true)}`} onClick={() => onPick(usd)} lang={lang} data-quick-buy={usd} translate="no">
              {quickSumLabel(usd, lang)}
            </Button>
          ))}
          <Button
            variant="ghost"
            icon="sliders-horizontal"
            aria-label={word("quickSumsEdit")}
            title={word("quickSumsEdit")}
            lang={lang}
            data-quick-edit
            onClick={() => {
              setDrafts(sums.map((sum) => (lang === "uk" ? String(sum).replace(".", ",") : String(sum))));
              setInvalid(false);
            }}
          />
        </div>
      )}
      {drafts && invalid ? (
        <p id={errorId} className={company.quickSumError} role="alert">
          {word("quickSumsRange")}
        </p>
      ) : null}
    </div>
  );
}
