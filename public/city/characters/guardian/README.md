# Vault guardian (CITY-57)

Built by `node assets-source/characters/guardian/build.mjs` from the Blender scripts in `assets-source/characters/guardian/` —
do not edit by hand. `guardian.glb` holds three meshes (hero, standard, crowd: 59298 / 19622 / 4740 triangles) in the
character's space at rest, each vertex tagged with its bone (`_BONE`, by the names in the file's extras) and surface
(`_MAT`), and one material whose textures are the WebP files beside it. Read by `city/components/characters/model.ts`.

| File | Size |
| --- | --- |
| guardian.base.webp | 190 KB |
| guardian.orm.webp | 375 KB |
| guardian.normal.webp | 438 KB |
| guardian.glb | 816 KB |

Everything here is made in this repository (no third-party models, textures or fonts beyond Blender's own).
