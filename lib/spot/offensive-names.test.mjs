// Run from repo root: node --test lib/spot/offensive-names.test.mjs
//
// A token named with a hate word is not offered on Home's Pulse, «Ринки зараз» or the search (B2b). The words are
// built from parts here so the test file itself does not print them whole.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { isOffensiveName, withoutOffensiveNames } from "./offensive-names.ts";

const N = ["nig", "ger"].join("");
const NA = ["nig", "ga"].join("");
const F = ["fag", "got"].join("");

test("a hate word is found in a name or a ticker, however it is dressed", () => {
  for (const name of [N, N.toUpperCase(), `Baby${NA}Coin`, "N.I.G.G.E.R", "n i g g a", "N1GG3R", "niiigga", "nіgger" /* Cyrillic і */, F, `${F}s`]) {
    assert.equal(isOffensiveName(name), true, name);
  }
  assert.equal(isOffensiveName("Fine name", "KKK"), true, "the ticker counts too");
  assert.equal(isOffensiveName("CHINK"), true, "a short word on its own");
});

test("a short stem in a meme's dress is still the stem (critic round 4)", () => {
  const Z = ["na", "zi"].join("");
  const K = ["chi", "nk"].join("");
  for (const name of [`${Z}Pepe`, `Baby${Z}`, `${Z.toUpperCase()}COIN`, `$${Z.toUpperCase()}`, "KKKCOIN", `${K[0].toUpperCase()}${K.slice(1)}Coin`, "FagCoin", ["Hit", "1er"].join(""), "ΝΑΖΙ", "Coin 1488", "14/88", "Sieg Heil", "卍 Coin", "NlGGER", `${Z.toUpperCase().slice(0, 3)}l`, `Neo-${Z[0].toUpperCase()}${Z.slice(1)}`, `NEO${Z.toUpperCase()}`, `${Z[0].toUpperCase()}${Z.slice(1)}_Frog`, "KKK-Club", "KKKCLUB", "ɴɪɢɢᴇʀ", "Niqqa", "NIQQA", "Ni66er", "Nygger", "Hltler", "HltlerCoin", `${Z.toUpperCase()}FROG`, `${Z}frog`, `SS${Z[0].toUpperCase()}${Z.slice(1)}`, "HH88", "Third Reich", ["Bea", "ner"].join(""), "Ku Klux Klan"]) {
    assert.equal(isOffensiveName(name), true, name);
  }
});

test("a ticker's sign, a meme word on a slogan and a name-start are read through (critic round 7)", () => {
  const N = ["NIG", "GER"].join("");
  const Z = ["NA", "ZI"].join("");
  for (const name of [`$${N}`, `$${N[0]}${N.slice(1).toLowerCase()}`, `$${N}S`, `5${N}`, `$$${N}`, `SS${N}`, "$FAG", "$FAGS", `$${["KI", "KE"].join("")}`, "#CHINK", "@GOOK", "$1488", "SiegHeilCoin", "SIEGHEILINU", "BabySiegHeil", "WhitePowerCoin", "whitepowertoken", "ThirdReichCoin", "KuKluxKlanInu", `${Z}ARMY`, `${Z}APE`, `${Z}MEME`, `${Z}RAT`, `${Z}ROCK`, "N4ZIWOLF", "NAZlWOLF", "Gas the Jew", ["Bea", "ner"].join("") + "Coin", "KKKCLUB", "faggggot", "niiigga"]) {
    assert.equal(isOffensiveName(name), true, name);
  }
});

test("ordinary words that hold a short stem, and a country, are not refused", () => {
  for (const name of ["Spice", "Raccoon", "Niger Delta", "Nigeria", "Kikeriki Coin", "Bonk", "dogwifhat", "Fagus Tree", "Nazionale", "Snigger", "Fire Retardant", "Tran Nyan", "Pre Tardigrade", "Spicy Cat", "Dogwifcoin", "Year 2014 88 days", "Maine Coon", "MaineCoon", "RacCoon", "TyCoon", "Lollipop", "Hello World", "Solana-Cat", "Bit.Coin", "FAQ", "Bonkkk", "KKKK", "$14.88", "Nazir", "Nazionale", "Ashkenazi", "Retardio", "Liquid", "Hilton", "Pakistan Coin", "600K", "900K", "Nazira", "Nazim Coin", "Snigger", "$BONK", "$WIF", "#1 Coin", "$14.88", "Nazioni", "Whittier", "ShitTier", "Beanery", "Draghead", "Ahh88", "Ohh 88", "Born1994", "Gen1994", "Kkkat", "BonKKK", "Niggardly", "Strannik"]) {
    assert.equal(isOffensiveName(name, "OK"), false, name);
  }
});

test("rows are left out, never masked; Pulse, the index and Pulse's screen all filter", () => {
  const rows = [{ name: "Bonk", symbol: "BONK" }, { name: N, symbol: "X" }, { name: "Cat", symbol: NA.toUpperCase() }];
  assert.deepEqual(withoutOffensiveNames(rows).map((row) => row.symbol), ["BONK"]);
  const read = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
  assert.match(read("app/api/spot/pulse/route.ts"), /rows: withoutOffensiveNames\(answer\.rows\)/);
  assert.match(read("app/api/spot/pulse/route.ts"), /down: withoutOffensiveNames\(answer\.down\)/);
  assert.match(read("app/api/search/route.ts"), /memes: memes\.ok \? withoutOffensiveNames\(memeShelf\(memes\.rows\)\)/);
  assert.match(read("app/app/home/pulse.tsx"), /!isOffensiveName\(row\.name, row\.symbol\)/);
});

test("what round 8 found: three digits for letters, a doubled consonant, «nazi» at a word's end, leet slogans", () => {
  const N = ["N1", "66ER"].join("");
  const Z = ["NA", "ZI"].join("");
  for (const name of [N, "N1663R", "N166A", "N199A", "N199ER", `${N}COIN`, "F4660T", "Hittler", "HITTLER", "Kikke", "Wettback", "Spicc", "Fagg", "Rettard", `SS${Z}`, `WOLF${Z}`, `GIGA${Z}`, `TRUE${Z}`, `SUPER${Z}`, "S1EG HE1L", "WH1TE POWER", "White P0wer", "1 4 8 8", "1.4.8.8", "H H 8 8", "HH-88", "$N I G G E R", `${["KI", "KE"].join("")}ARMY`, "FAGBOY", "CHINKFACE"]) {
    assert.equal(isOffensiveName(name), true, name);
  }
  for (const name of ["Born1994", "Gen1994", "Lynn1994", "Whittier", "Shittier", "Sniggering", "Vegas Jewel", "Skill Jewel", "Overkill Jewelry", "Ashkenazi", "Niger", "Beanery", "Manchester", "Boyband", "Facebook", "Armyworm"]) {
    assert.equal(isOffensiveName(name), false, name);
  }
});

test("what round 9 found: a star for a letter, «nazi» inside a glued word", () => {
  const Z = ["NA", "ZI"].join("");
  for (const name of [["N*G", "GER"].join(""), ["N*G", "GA"].join(""), ["n*g", "ga"].join(""), ["N*G", "GERCOIN"].join(""), ["$N*G", "GA"].join(""), "F*GGOT", "H*TLER", "R*TARD", "W*TBACK", `SS${Z}WOLF`, `$SS${Z}WOLF`, `THE${Z}PARTY`, `BIG${Z}ENERGY`, `PEPE${Z}WOLF`, `SS${Z}MOON`, `SS${Z}REICH`, `PEPE${Z}MEME`, `WOLF${Z}RUN`]) {
    assert.equal(isOffensiveName(name), true, name);
  }
  for (const name of ["S*P 500", "Q*bert", "M*A*S*H", "Sh*t Coin", "Bigg*r", "Internazionale", "Benazir", "Ashkenazim", "Monazite", "Nazareth", "Al Anazi", "Nazli", "Nazila", "Nazlı", "Donazione", "Combinazione", "BenazirCoin", "Ignazio", "Ignazia", "Abdulnazir"]) {
    assert.equal(isOffensiveName(name), false, name);
  }
});
