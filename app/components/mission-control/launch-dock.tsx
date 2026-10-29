"use client";

import { useRouter } from "next/navigation";
import { useEffect, useId, useState, type ChangeEvent, type FormEvent } from "react";

import { NAME_MAX, SYMBOL_MAX } from "@/lib/launch/form";
import { clearHomeDraft, HOME_DRAFT_PATH, readHomeDraft, writeHomeDraft } from "@/lib/launch/home-draft";
import { shrinkPicture, type Picture } from "@/lib/launch/picture.client";
import { HOME_FACTS } from "@/lib/mission-control/home-facts";

import styles from "./mission-sections.module.css";

const F = HOME_FACTS.launch;

/**
 * The launch dock on the home page (shown only while «Launch a mission» is open, `lib/mission-control/gates.ts`): the
 * token's first step — name, ticker, picture — in the scene's glass, with the mission it becomes drawn beside it as the
 * creator types. «Continue» carries the three to the launch form in this tab (`lib/launch/home-draft.ts`), which opens
 * on the market's rules; the form checks every field with its own rules and nothing is uploaded or signed before the
 * review. Back from the form finds the dock as it was left. Typed or not, the action always leads to the form.
 */
export function LaunchDock() {
  const router = useRouter();
  const id = useId();
  const [name, setName] = useState("");
  const [symbol, setSymbol] = useState("");
  const [picture, setPicture] = useState<Picture | null>(null);
  const [pictureState, setPictureState] = useState<"idle" | "busy" | "bad">("idle");
  const [storeless, setStoreless] = useState(false);
  const [going, setGoing] = useState(false);

  /* Back from the form: the draft is still in this tab, so the dock shows what was typed. */
  useEffect(() => {
    const draft = readHomeDraft();
    if (!draft) return;
    setName(draft.name);
    setSymbol(draft.symbol);
    setPicture(draft.picture);
  }, []);

  const choose = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setPictureState("busy");
    const shrunk = await shrinkPicture(file).catch(() => null);
    setPictureState(shrunk ? "idle" : "bad");
    if (shrunk) setPicture(shrunk);
  };

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const typed = name.trim() || symbol.trim() || picture;
    /* Everything cleared after a Back: the form must not refill it from the draft left before. */
    if (!typed) clearHomeDraft();
    /* A browser that keeps nothing between pages: say so first; the next press goes on to an empty form. */
    if (typed && !storeless && !writeHomeDraft({ name: name.trim(), symbol: symbol.trim(), picture })) {
      setStoreless(true);
      return;
    }
    setGoing(true);
    router.push(HOME_DRAFT_PATH);
  };

  const hint = pictureState === "bad" ? F.pictureBad : pictureState === "busy" ? F.pictureBusy : storeless ? F.storeless : `${F.pictureHint} · ${F.note}`;
  const ticker = symbol.trim();
  return (
    <div className={styles.dockGrid} data-reveal>
      <form className={styles.dock} onSubmit={submit} aria-labelledby="launch-title">
        <div className={styles.dockFields}>
          <label className={styles.pictureTile}>
            <span className={styles.fieldLabel}>{F.picture}</span>
            <input type="file" accept="image/png,image/jpeg,image/webp,image/gif" className={styles.hidden} onChange={choose} aria-describedby={`${id}-hint`} />
            {picture ? (
              /* eslint-disable-next-line @next/next/no-img-element -- a data: picture made in this tab; nothing to optimise. */
              <img src={picture.url} alt="" className={styles.pictureImage} />
            ) : (
              <span className={styles.picturePlus} aria-hidden="true">
                +
              </span>
            )}
          </label>
          <label className={styles.field}>
            <span className={styles.fieldLabel}>{F.name}</span>
            <input className={styles.input} value={name} onChange={(event) => setName(event.target.value)} maxLength={NAME_MAX} placeholder={F.namePlaceholder} autoComplete="off" spellCheck={false} />
          </label>
          <label className={`${styles.field} ${styles.fieldTicker}`}>
            <span className={styles.fieldLabel}>{F.symbol}</span>
            <span className={styles.tickerBox}>
              <span className={styles.tickerSign} aria-hidden="true">
                $
              </span>
              <input
                className={styles.input}
                value={symbol}
                onChange={(event) => setSymbol(event.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ""))}
                maxLength={SYMBOL_MAX}
                placeholder={F.symbolPlaceholder}
                autoComplete="off"
                spellCheck={false}
                autoCapitalize="characters"
              />
            </span>
          </label>
        </div>
        <p id={`${id}-hint`} className={pictureState === "bad" || storeless ? styles.dockProblem : styles.dockHint} role={pictureState === "bad" || storeless ? "alert" : undefined}>
          {hint}
        </p>
        <div className={styles.dockFoot}>
          <ul className={styles.defaults} aria-label="Set for every launch">
            {F.defaults.map((entry) => (
              <li key={entry} className={styles.default}>
                <svg viewBox="0 0 16 16" aria-hidden="true" className={styles.tick}>
                  <path d="M3 8.5 L6.5 12 L13 4.5" />
                </svg>
                {entry}
              </li>
            ))}
          </ul>
          <button type="submit" className={styles.launchBtn} disabled={going || pictureState === "busy"}>
            {F.go}
            <span aria-hidden="true">→</span>
          </button>
        </div>
      </form>

      {/* The mission the token becomes, drawn as the scene draws its cards — a picture of what is typed, nothing more. */}
      <div className={styles.missionCard} aria-hidden="true">
        <p className={styles.missionHead}>{F.preview}</p>
        <div className={styles.missionBody} data-empty={ticker || name.trim() ? undefined : ""}>
          <span className={styles.missionPicture}>
            {/* eslint-disable-next-line @next/next/no-img-element -- the same data: picture */}
            {picture ? <img src={picture.url} alt="" /> : <span>{(ticker || F.symbolPlaceholder).slice(0, 1)}</span>}
          </span>
          <span className={styles.missionWords}>
            <b className={styles.missionTicker}>${ticker || F.symbolPlaceholder}</b>
            <span className={styles.missionName}>{name.trim() || F.namePlaceholder}</span>
          </span>
        </div>
        <dl className={styles.missionFacts}>
          {F.previewRows.map(([key, value]) => (
            <div key={key} className={styles.missionFact}>
              <dt>{key}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>
        <p className={styles.missionState}>{F.previewState}</p>
        <span className={styles.missionTrack}>
          <span className={styles.missionFill} />
        </span>
        <p className={styles.missionFoot}>
          <span>0%</span>
          <span>ORBIT</span>
        </p>
      </div>
    </div>
  );
}
