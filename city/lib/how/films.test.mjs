import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

import { FILMS, length, ownPath, readFilm, readFilms } from "./films.ts";

/* CITY-43: the lessons come from our own domain only, from the place the video factory fills — the MP4 and its cover,
   captions beside them. An entry that is not ours whole is dropped, never half-played. */

const PUBLIC = new URL("../../../public/", import.meta.url);

test("only a file in our own films' folder is played", () => {
  assert.equal(ownPath("/city/how/trade.mp4"), true);
  for (const bad of [
    "https://youtube.com/watch?v=1",
    "//cdn.example.com/a.mp4",
    "/city/art/video/intro-city.mp4",
    "/city/how/../../secret",
    "/city/how/a.mp4?x=1",
    "/city/how/a b.mp4",
    "city/how/a.mp4",
    42,
    null,
  ]) {
    assert.equal(ownPath(bad), false, String(bad));
  }
});

test("an entry with any outside file, or without its cover, is dropped whole", () => {
  assert.deepEqual(readFilm({ mp4: "/city/how/trade.mp4", poster: "/city/how/trade.webp", captions: { en: "/city/how/trade.en.vtt" }, seconds: 74.4 }), {
    mp4: "/city/how/trade.mp4",
    poster: "/city/how/trade.webp",
    captions: { en: "/city/how/trade.en.vtt" },
    seconds: 74,
  });
  assert.equal(readFilm({ mp4: "/city/how/trade.mp4" }), null, "no cover: the card would stand black");
  assert.equal(readFilm({ mp4: "/city/how/trade.mp4", poster: "https://x.com/a.png" }), null);
  assert.equal(readFilm({ mp4: "/city/how/trade.mp4", poster: "/city/how/trade.webp", webm: "https://vimeo.com/1" }), null);
  assert.equal(readFilm({ mp4: "/city/how/trade.mp4", poster: "/city/how/trade.webp", captions: { uk: "https://x.com/a.vtt" } }), null);
  assert.equal(readFilm({ webm: "/city/how/trade.webm", poster: "/city/how/trade.webp" }), null, "MP4 is the one every browser plays");
  assert.equal(readFilm({ mp4: "/city/how/trade.mp4", poster: "/city/how/trade.webp", seconds: -3 }).seconds, undefined);
});

test("a manifest reads entry by entry", () => {
  const films = readFilms({ films: { trade: { mp4: "/city/how/trade.mp4", poster: "/city/how/trade.webp" }, chart: { mp4: "https://x.com/c.mp4", poster: "/city/how/c.webp" } } });
  assert.deepEqual(Object.keys(films), ["trade"]);
  assert.deepEqual(readFilms(null), {});
  assert.deepEqual(readFilms({}), {});
});

test("the manifest in the repository is valid, and every file it names is in public/", () => {
  const raw = JSON.parse(readFileSync(new URL("./films.json", import.meta.url), "utf8"));
  assert.equal(typeof raw.films, "object");
  assert.deepEqual(Object.keys(FILMS).sort(), Object.keys(raw.films).sort(), "no entry is dropped: every one is ours");
  for (const film of Object.values(FILMS)) {
    for (const path of [film.mp4, film.webm, film.poster, film.captions?.en, film.captions?.uk].filter(Boolean)) {
      assert.ok(existsSync(new URL(`.${path}`, PUBLIC)), path);
    }
  }
});

test("the length chip", () => {
  assert.equal(length(45), "0:45");
  assert.equal(length(90), "1:30");
  assert.equal(length(119.6), "2:00");
});
