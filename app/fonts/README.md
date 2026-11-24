# The site's faces

Every face the site loads is a file in this folder, so the build asks nobody for a font. A face fetched from a font
service at build time makes every build depend on that service's answer. The faces used to come from Google Fonts
through `next/font/google`, and these files are the same faces (see below).

## Where each is loaded

| Module | Faces | Where | Variables |
| --- | --- | --- | --- |
| `root.ts` | Geist, Geist Mono, Unbounded | `app/layout.tsx`, every page | `--font-geist`, `--font-geist-mono`, `--font-sora` |
| `city.ts` | Hubot Sans, Mona Sans | `city/styles/fonts.ts` (`CITY_FONTS`): the city and the terminal | `--font-display`, `--font-ui` |
| `landing.ts` | Onest, IBM Plex Mono, with the root's Unbounded | `/product`, `/product-map`, `/agent-control`, `/assets/<mint>` | `--font-sora`, `--font-geist`, `--font-geist-mono` |
| `lab.ts` | Inter | `/preview/agg-lab` | `--font-agg-inter` |

There are four modules, not one, because next/font preloads every face of a module on every page whose layout imports
it. One module would make every page preload all eight families. The terminal's plain zero is a face of its own
(`terminal/styles/zero/`).

## How a family is put together

The variables carry what they carried, and the browser does what it did:

- **One face per script, one family name.** The Latin face and the Cyrillic face of a family both declare its name
  (`font-family` in `declarations`), each with the `unicode-range` Google gave that script. The browser composes them as
  it composed Google's stylesheet. The face that carries the variable gives it the value next/font/google gave it:
  `--font-geist` is `'Geist', 'Geist Fallback'`.
- **Weights as Google declared them.** A range on the variable file for Geist, Onest, Hubot Sans and Mona Sans (and the
  width range, `75% 125%`, for the last two). Three or four separate weights pointing at one variable file for Geist
  Mono, Unbounded and Inter, so a weight in between takes the nearest face as before. IBM Plex Mono has a static file
  per weight.
- **Preloaded as before.** Google preloaded the scripts the old call named (`subsets`): both scripts of Geist and Geist
  Mono, and the Latin of the others. The Cyrillic of Unbounded, Onest, IBM Plex Mono and Inter is there when a word
  needs it, and is not preloaded.
- **The same fallbacks.** next/font/local computes the fallback's metrics from the file, and those differ from the ones
  next/font/google used. Hubot Sans differs by a third, because its variable file opens at the narrowest width. So each
  face sets `adjustFontFallback: false` and names its fallback, and `fallbacks.css` declares that fallback with
  next/font/google's own numbers.
- **Latin and Cyrillic only.** These are the scripts of the site in English and Ukrainian. Google also served Latin
  Extended, Cyrillic Extended and Vietnamese, but never preloaded them, and none of the site's own words uses them. A
  coin name with such a letter now shows that letter in the fallback.

## Files

Each file is copied unchanged from its npm package, the path inside the package being `files/<the same name>`. The
test (`fonts.test.mjs`) checks every hash below.

| File | Package | SHA-256 |
| --- | --- | --- |
| `geist-latin-wght-normal.woff2` | `@fontsource-variable/geist@5.3.0` | `19f9c92546aa300c312235e3125af1b81394d8db9a4bc4a425cd5b641d2d54e1` |
| `geist-cyrillic-wght-normal.woff2` | `@fontsource-variable/geist@5.3.0` | `6894439694946a589d157ece003086960a6a4013d74a813dab7602efdb3d8c09` |
| `geist-mono-latin-wght-normal.woff2` | `@fontsource-variable/geist-mono@5.3.0` | `684ad5b531f81d43c1e8c7038262d5db7cdc1f68006e04d6c7769efa8d33c8cc` |
| `geist-mono-cyrillic-wght-normal.woff2` | `@fontsource-variable/geist-mono@5.3.0` | `4866787fc952dbdbd591d6923d67bc21c2d894b93f34ab69d0cdf25d47bfb2df` |
| `unbounded-latin-wght-normal.woff2` | `@fontsource-variable/unbounded@5.3.0` | `22f9b928aa3928a896340422b54d690fbb5875c30eae4c106f029c61f2289fd6` |
| `unbounded-cyrillic-wght-normal.woff2` | `@fontsource-variable/unbounded@5.3.0` | `e30bf6a6063b6a47232bbd657e24c7cf4fdaf76fc2c50d92d9ee63e2ad2087cf` |
| `hubot-sans-latin-standard-normal.woff2` | `@fontsource-variable/hubot-sans@5.3.0` | `650838c44a4bc0f7daebe48bcea3db9f91abb165973b9b6f109edca3a6dfa2b9` |
| `mona-sans-latin-standard-normal.woff2` | `@fontsource-variable/mona-sans@5.3.0` | `5ea3740633e5ac7af56c13d7e8ec32bcae12e7723e53d34284469a8947ccb2f3` |
| `onest-latin-wght-normal.woff2` | `@fontsource-variable/onest@5.3.1` | `052df74533250c2e0ca0c4bdd32de594e107d99c1648e63820ef9c6142067828` |
| `onest-cyrillic-wght-normal.woff2` | `@fontsource-variable/onest@5.3.1` | `68e5e01d6265bd68967746d4f5a9d18d0e6cbb5d15583c7082d6384ab1229b27` |
| `ibm-plex-mono-latin-400-normal.woff2` | `@fontsource/ibm-plex-mono@5.3.0` | `08949f728dc52d528e69b1667d15c89a5686a4ee9a296ff90983985f99c380f7` |
| `ibm-plex-mono-latin-500-normal.woff2` | `@fontsource/ibm-plex-mono@5.3.0` | `01d285447409c8a588692162439a038b8cbd7871309ee20267b0d2d91c6e8e22` |
| `ibm-plex-mono-latin-600-normal.woff2` | `@fontsource/ibm-plex-mono@5.3.0` | `0d1f0b8d0722224e32e9f28261bdc86c79115be73444ae5eceb73976a1bcdf83` |
| `ibm-plex-mono-cyrillic-400-normal.woff2` | `@fontsource/ibm-plex-mono@5.3.0` | `7635422bd10ddbbcb0e0caa1154b928298f5c8319b8c00b30978d4395f4783ce` |
| `ibm-plex-mono-cyrillic-500-normal.woff2` | `@fontsource/ibm-plex-mono@5.3.0` | `1d89462e86cb8e87e7e9d6f6635605bd7c3081baca6caaecee84916bf7b60edc` |
| `ibm-plex-mono-cyrillic-600-normal.woff2` | `@fontsource/ibm-plex-mono@5.3.0` | `2b05a8695c7f9f4abd7178b279646a3b005a8ce57546bef6fd145f25d131e0aa` |
| `inter-latin-wght-normal.woff2` | `@fontsource-variable/inter@5.3.0` | `3100e775e8616cd2611beecfa23a4263d7037586789b43f035236a2e6fbd4c62` |
| `inter-cyrillic-wght-normal.woff2` | `@fontsource-variable/inter@5.3.0` | `71d5ee93cc1e9f1d520a3a8b66456de18c7879d8df09d57fcd2eaff75fef0075` |

Fontsource cuts its files from Google Fonts. Each file was compared with fontTools against the file Google Fonts
serves `next/font/google` for the same family, script and axes. They match on code points, outlines, advances, vertical
metrics, axes and version. The only difference is the hinting tables: `prep` in the variable files, and `cvt `,
`fpgm`, `prep` and `VDMX` in IBM Plex Mono. Google drops these for the macOS browser that next/font poses as. Hubot Sans
and Mona Sans are the `standard` files (weight and width axes), byte for byte the same as the packages' `wdth` files.

## Licences

Every family is licensed under the SIL Open Font License 1.1. Each package's licence, with its family's copyright line,
stands beside the files as `files/OFL-<Family>.txt`. The files are not modified, so the Reserved Font Names of Hubot
Sans («Hubot») and Mona Sans («Mona») are kept as the licence allows.

## Updating a face

1. `npm pack <package>@<version>` and take the file from the package's `files/`.
2. Compare it with the one here (code points, outlines, advances, metrics). A face that changes shape changes the
   site's look, and needs new before/after shots.
3. Replace the file, the package and the hash in the table above, and the licence if it changed. `npm test` checks
   the hashes.
