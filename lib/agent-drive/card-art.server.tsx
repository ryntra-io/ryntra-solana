/* eslint-disable @next/next/no-img-element -- the card is drawn by next/og, where <img> is the only picture there is. */
import { ImageResponse } from "next/og";

import { BRAND } from "@/city/lib/brand";
import { PALETTE } from "@/city/lib/palette";
import { cityFonts, markUri } from "@/city/lib/share/fonts.server";
import { cardHeld, type DriveCard } from "./card";
import { xText } from "./events";
import { coinName, solPlain, type Lang } from "./figures";
import { DRIVE_WORDS } from "./words";

/**
 * The «×» card of a closed trade, 1200×675 — X's own picture size: the night's ink with the terminal's violet haze and a
 * thin frame, the mark, «My agent closed a trade», the coin, the «×» — mint for a gain, the flare for a loss — and the
 * trade's three facts: what went in, what came out, how long it was open; at the foot the line and ryntra.io. Every
 * figure is the kept card's (`./card.ts`): nothing on it is estimated or promised. The faces and the mark are the city's
 * share card's; the colours the brand's palette.
 */

export const DRIVE_CARD_SIZE = { width: 1200, height: 675 } as const;

const DIM = "rgba(238,241,255,0.62)";
const EDGE = "rgba(153,69,255,0.34)";

function closedText(ms: number, lang: Lang): string {
  const text = new Intl.DateTimeFormat(lang === "uk" ? "uk-UA" : "en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "UTC" }).format(new Date(ms));
  return `${text} UTC`;
}

function Fact({ label, value, ui, display }: { label: string; value: string; ui: string; display: string }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", padding: "18px 24px", border: `1px solid ${EDGE}`, background: "rgba(17,14,30,0.72)", marginRight: 16, minWidth: 220 }}>
      <div style={{ display: "flex", fontFamily: ui, fontSize: 18, fontWeight: 600, letterSpacing: 2, textTransform: "uppercase", color: DIM }}>{label}</div>
      <div style={{ display: "flex", marginTop: 8, fontFamily: display, fontWeight: 900, fontSize: 40, color: PALETTE.ice }}>{value}</div>
    </div>
  );
}

export async function driveCardImage(card: DriveCard, lang: Lang): Promise<ImageResponse> {
  const faces = await cityFonts();
  const display = faces ? "Hubot Sans" : "sans-serif";
  const ui = faces ? "Mona Sans" : "sans-serif";
  const w = DRIVE_WORDS[lang];
  const coin = coinName(card.coin, lang);
  const entry = BigInt(card.entryRaw);
  const exit = BigInt(card.exitRaw);
  const tone = exit > entry ? PALETTE.mint : exit < entry ? PALETTE.flare : PALETTE.ice;
  const figure = card.x === null ? `${solPlain(card.exitRaw, lang)} SOL` : xText(card.x, lang);
  const held = cardHeld(card, lang);
  /* A kept card never changes: once drawn with the faces it is kept for good; without them, briefly. */
  const headers = { "cache-control": faces ? "public, max-age=86400, s-maxage=604800, immutable" : "public, max-age=60, s-maxage=60" };
  return new ImageResponse(
    <div style={{ display: "flex", position: "relative", width: "100%", height: "100%", background: PALETTE.inkDeep, color: PALETTE.ice, fontFamily: ui }}>
      <div style={{ position: "absolute", left: 0, top: 0, width: 1200, height: 675, display: "flex", background: "radial-gradient(circle at 86% 14%, rgba(153,69,255,0.46) 0%, rgba(42,22,64,0.52) 34%, rgba(6,5,12,0) 72%)" }} />
      <div style={{ position: "absolute", left: 0, top: 0, width: 1200, height: 675, display: "flex", background: "radial-gradient(circle at 8% 112%, rgba(255,178,63,0.16) 0%, rgba(6,5,12,0) 42%)" }} />
      <div style={{ position: "absolute", left: 24, top: 24, width: 1152, height: 627, display: "flex", border: `1px solid ${EDGE}` }} />
      <div style={{ position: "relative", display: "flex", flexDirection: "column", width: "100%", height: "100%", padding: "56px 72px 52px" }}>
        <div style={{ display: "flex", alignItems: "center" }}>
          <img src={markUri()} alt="" width={48} height={48} />
          <div style={{ display: "flex", marginLeft: 14, fontFamily: display, fontWeight: 900, fontSize: 28, letterSpacing: 3 }}>{BRAND.name.toUpperCase()}</div>
          <div style={{ display: "flex", marginLeft: 18, fontSize: 18, fontWeight: 600, letterSpacing: 2, color: DIM }}>SOLANA</div>
        </div>
        <div style={{ display: "flex", marginTop: 40, fontSize: 24, fontWeight: 800, letterSpacing: 3, textTransform: "uppercase", color: PALETTE.warmWhite }}>{w.cardKick}</div>
        <div style={{ display: "flex", alignItems: "center", marginTop: 18 }}>
          <div style={{ display: "flex", width: 112, height: 112, borderRadius: 56, padding: 5, background: `linear-gradient(135deg, ${PALETTE.violet}, ${PALETTE.warmWhite})`, flexShrink: 0 }}>
            <div style={{ display: "flex", width: 102, height: 102, borderRadius: 51, background: PALETTE.ink, alignItems: "center", justifyContent: "center", fontFamily: display, fontWeight: 900, fontSize: 48, color: PALETTE.amber }}>
              {coin.slice(0, 1).toUpperCase()}
            </div>
          </div>
          <div style={{ display: "flex", marginLeft: 28, fontFamily: display, fontWeight: 900, fontSize: coin.length > 7 ? 72 : 96, lineHeight: 1 }}>{coin}</div>
          <div style={{ display: "flex", marginLeft: "auto", fontFamily: display, fontWeight: 900, fontSize: 168, lineHeight: 1, color: tone }}>{figure}</div>
        </div>
        <div style={{ display: "flex", marginTop: 40 }}>
          <Fact label={w.cardEntry} value={`${solPlain(card.entryRaw, lang)} SOL`} ui={ui} display={display} />
          <Fact label={w.cardExit} value={`${solPlain(card.exitRaw, lang)} SOL`} ui={ui} display={display} />
          {held ? <Fact label={w.cardHeld} value={held} ui={ui} display={display} /> : null}
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", marginTop: "auto" }}>
          <div style={{ display: "flex", alignItems: "center", fontSize: 24, fontWeight: 800 }}>
            <div style={{ display: "flex", width: 40, height: 5, background: PALETTE.amber, marginRight: 16 }} />
            {`${w.cardSlogan} · ${BRAND.domain}`}
          </div>
          <div style={{ display: "flex", fontSize: 18, fontWeight: 600, color: DIM }}>{`${w.cardClosed} ${closedText(card.closedAt, lang)}`}</div>
        </div>
      </div>
    </div>,
    { ...DRIVE_CARD_SIZE, fonts: faces ?? undefined, headers },
  );
}
