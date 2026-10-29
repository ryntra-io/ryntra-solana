import { ImageResponse } from "next/og";

import { momentWords, shipGrowth, type CardMoment } from "@/lib/mission-control/scene";
import type { SceneMission } from "@/lib/mission-control/types";
import { MISSION_CONTROL_WORDS as W } from "@/lib/mission-control/words";

import { WORDMARK_BOX } from "./generated/wordmark-box";
import { WORDMARK_DARK_UI_DATA_URI } from "./generated/wordmark-dark-ui";
import { RYNTRA_COLORS } from "./mark";

/** X's large card (decision 68: 1200 × 675, not the brandbook's 1200 × 630). */
export const MISSION_CARD_SIZE = { width: 1200, height: 675 } as const;

const SKY = "#04070B";
const GOLD = "#F5B544";
const INFO = "#4FB8FF";

/**
 * The mission's ship from its genome, flat: the same hull and trim as on the sky — and grown as far as the chain says
 * (MC-2): a booster ring at each quarter of the curve it stands past, solar wings once in orbit — and a day ring for
 * each check it passed (MC-3): blue for days 7 and 30, gold for the star's day 90.
 */
function Ship({ mission, size }: { mission: SceneMission; size: number }) {
  const { base, accent, fins, length } = mission.ship;
  const { boosters, wings, rings } = shipGrowth(mission);
  return (
    <svg width={size} height={Math.round(size * 1.3 * length)} viewBox="0 0 100 130" preserveAspectRatio="none">
      {/* The card's renderer takes only intrinsic elements inside an <svg>: each wing its own path, no fragment. */}
      {wings ? <path d="M36 50 L4 44 L4 60 L36 62 Z" fill="#4FB8FF" opacity={0.55} stroke="#D6E6FF" strokeWidth="1.5" /> : null}
      {wings ? <path d="M64 50 L96 44 L96 60 L64 62 Z" fill="#4FB8FF" opacity={0.55} stroke="#D6E6FF" strokeWidth="1.5" /> : null}
      <path d="M50 4 C64 24 66 52 64 92 L36 92 C34 52 36 24 50 4 Z" fill={base} />
      <path d="M50 4 C57 14 60 26 61 36 L39 36 C40 26 43 14 50 4 Z" fill={accent} />
      <circle cx="50" cy="52" r="7" fill={SKY} stroke={accent} strokeWidth="3" />
      <path d="M36 70 L18 100 L36 92 Z" fill={accent} />
      <path d="M64 70 L82 100 L64 92 Z" fill={accent} />
      {fins === 4 ? <path d="M47 78 L50 108 L53 78 Z" fill={accent} /> : null}
      <path d="M40 94 C44 116 56 116 60 94 Z" fill="#FC9D01" opacity={mission.phase === "ascent" ? 0.95 : 0.35} />
      {[86, 76, 66].slice(0, boosters).map((y) => (
        <ellipse key={y} cx="50" cy={y} rx="17" ry="3.2" fill="none" stroke={accent} strokeWidth="2.4" />
      ))}
      {rings.map((day, index) => (
        <ellipse key={`day${day}`} cx="50" cy="56" rx={30 + index * 8} ry={7 + index * 2} fill="none" stroke={day === 90 ? GOLD : INFO} strokeWidth="1.6" opacity={0.85} />
      ))}
    </svg>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", marginRight: 54 }}>
      <div style={{ display: "flex", fontSize: 20, letterSpacing: 3, color: RYNTRA_COLORS.muted }}>{label}</div>
      <div style={{ display: "flex", fontSize: 40, fontWeight: 600, marginTop: 8 }}>{value}</div>
    </div>
  );
}

/**
 * A moment of a mission as a card a person posts to X (MC-0): the moment's title, the mission's ship and its numbers
 * as the chain gave them when the card was drawn. A figure not read is left off; nothing on it promises a price.
 * Without a mission it is Mission Control's own card — the home page's preview.
 */
export function missionCard(mission: SceneMission | null, moment: CardMoment | null): ImageResponse {
  const wordmarkWidth = Math.round(40 * (WORDMARK_BOX.width / WORDMARK_BOX.height));
  const words = mission && moment ? momentWords(moment, mission) : null;
  const facts: Array<[string, string]> = [];
  if (mission) {
    if (mission.phase === "ascent" && mission.altitude !== null) facts.push(["TO ORBIT", `${mission.altitude.toFixed(1)}%`]);
    if (mission.holders !== null) facts.push(["HOLDERS", `${mission.holdersAtLeast ? "≥" : ""}${mission.holders.toLocaleString("en-US")}`]);
    if (mission.day !== null) facts.push(["DAY", String(Math.floor(mission.day))]);
    if (mission.crew.length > 1) facts.push(["CREW", String(mission.crew.length)]);
  }
  return new ImageResponse(
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        width: "100%",
        height: "100%",
        background: `radial-gradient(circle at 78% 118%, #142030 0%, ${RYNTRA_COLORS.graphite} 46%, ${SKY} 78%)`,
        color: RYNTRA_COLORS.text,
        padding: "48px 60px 40px",
        fontFamily: "Geist, Arial, sans-serif",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <img src={WORDMARK_DARK_UI_DATA_URI} alt="" width={wordmarkWidth} height={40} />
        <div style={{ display: "flex", fontSize: 20, letterSpacing: 4, color: RYNTRA_COLORS.muted }}>MISSION CONTROL · SOLANA</div>
      </div>
      {mission && words ? (
        <div style={{ display: "flex", flex: 1, alignItems: "center" }}>
          <div style={{ display: "flex", flexDirection: "column", flex: 1 }}>
            <div style={{ display: "flex", fontSize: 26, letterSpacing: 6, color: moment === "orbit" || moment === "day90" ? GOLD : INFO }}>{words.title}</div>
            <div style={{ display: "flex", fontSize: 104, fontWeight: 800, letterSpacing: -4, lineHeight: 1, marginTop: 14 }}>{mission.ticker}</div>
            <div style={{ display: "flex", fontSize: 32, color: "#C3CCD8", marginTop: 18, maxWidth: 700 }}>{words.line}</div>
            {mission.ryntraTest ? <div style={{ display: "flex", fontSize: 20, letterSpacing: 3, color: RYNTRA_COLORS.muted, marginTop: 14 }}>RYNTRA TEST LAUNCH · TECHNICAL VALIDATION</div> : null}
            <div style={{ display: "flex", flexWrap: "wrap", rowGap: 18, marginTop: 34, maxWidth: 760 }}>
              {facts.map(([label, value]) => (
                <Fact key={label} label={label} value={value} />
              ))}
            </div>
          </div>
          <Ship mission={mission} size={300} />
        </div>
      ) : (
        <div style={{ display: "flex", flex: 1, flexDirection: "column", justifyContent: "center" }}>
          <div style={{ display: "flex", fontSize: 108, fontWeight: 800, letterSpacing: -5, lineHeight: 0.95, maxWidth: 900 }}>{W.h1}</div>
          <div style={{ display: "flex", fontSize: 30, color: "#C3CCD8", marginTop: 26, maxWidth: 900 }}>{W.descriptor}</div>
        </div>
      )}
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 20, color: RYNTRA_COLORS.muted }}>
        <div style={{ display: "flex" }}>{W.meteora}</div>
        <div style={{ display: "flex" }}>{mission ? `ryntra.io/mission/${mission.id.slice(0, 4)}…${mission.id.slice(-4)}` : "ryntra.io"}</div>
      </div>
    </div>,
    { ...MISSION_CARD_SIZE },
  );
}
