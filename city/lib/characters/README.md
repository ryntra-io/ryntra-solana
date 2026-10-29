# Characters (CITY-57)

Agents in the city are characters, not icons. The first is the **vault guardian**: a sleek humanoid sentinel about
1.97 m tall (simple, in the spirit of the film robots — our own design, not a copy of any), drawn
to the site's key art (`public/city/art/district-vault-1600.webp`) — glossy white ceramic plates over a body of black
glass, a black glass helmet whose face is a thin amber slit (a face of light when it speaks or feels), pale ear plates
with sensor rings, a small amber core in the sternum, tendons across the elbows and knees; every animation written in
code. Its body is modelled in Blender by
scripts in this repository (`assets-source/characters/guardian/`) with PBR textures baked from the model itself. Every
piece is fixed to one bone of the rig in code, so nothing deforms and there is no skinning: the renderer places each
vertex by its bone, in one draw call. (The first Blender pass, a heavy hard-surface mech, is in this branch's history.)

## Use it

```tsx
import { Guardian } from '@/city/components/characters/Guardian';

<Guardian position={[x, y, z]} height={1.2} state="thinking" />
<Guardian state="ready" reaction={{ kind: 'attempt', key: attemptId }} lookAt={playerQuarter} />
<Guardian state="ready" reaction={{ kind: 'defeat', key: breakId, hold: true }} />   // stays down
```

| Prop | What it does |
| --- | --- |
| `state` | `ready` · `thinking` · `acting` · `done` — what it is doing, shown by body and light (below). Default `ready`. |
| `reaction` | `{ kind, key, hold? }` — `attempt` · `laugh` · `alarm` · `defeat` · `celebrate` · `greet`. Plays once each time `key` changes, then hands back to `state`; with `hold: true` it stays in its last section (defeat stays kneeling, alarm keeps scanning) until the next reaction or `reaction={null}`. |
| `lookAt` | A world point (or `THREE.Vector3`): the head turns, the eyes lead. Past the shoulder the whole body turns on the spot. |
| `walkTo` | `[x, z]` in the guardian's own space and units: it turns, walks with heavy steps (dust where each foot lands) and stops; `onArrive` says when. |
| `heading` | Which way it faces while standing (radians, 0 = +z). |
| `height` | Height in the scene; it is about 1.97 units tall as built. |
| `detail` | `'auto'` (default: by size on screen) or 0 hero · 1 standard · 2 crowd · 3 impostor. |
| `onEvent` | `stomp.L` · `stomp.R` · `sparks` · `burst` · `clank` — for sound. |
| `body` | `'model'` (default: the Blender model) or `'code'` (the body built from parts in code — the first prototype). |
| `env`, `envIntensity`, `light`, `contact` | A studio's prefiltered HDR environment, its key/rim/fill and a contact shadow; in the city the body keeps the city's light. |

It lives under the city's clock (`SHARED.uTime` in `city/lib/city/shared.ts`), as every city material does, and in the
city's light: fog, the Slot Pulse, bloom from `city/components/city/Effects.tsx`.

## States and moments — body and light, never text

| | Body | Light |
| --- | --- | --- |
| ready | guard stance, breathing, weight shifting; a glance around now and then; Idle B every 9–15 s | amber visor, stern eyes, slow blink |
| thinking | left palm up with a hologram over it, head bent to read it, the right hand working it | warm visor, a scan bar sweeping, the core pulsing |
| acting | an open hand held out, a fist brought down — answering | bright amber, the mouth speaking, seams and core bright |
| done | a nod, then arms crossed | warm, pleased eyes, the core settling |
| attempt | head snaps round, a guard, fists up | eyes wide, then narrowed and stern |
| laugh | head back, shoulders shaking, a hand on its belly | happy arcs, an open laughing mouth |
| alarm | wide stance, fists high, the head sweeping left and right | flare red visor, core and beacon — a slow pulse, no strobe |
| defeat | sparks, a stagger, down on one knee, head hung | the visor tears and gutters to a dim red, eyes crossed out |
| celebrate | a crouch, both fists up, a burst of light at its feet | warm, happy, blazing |
| greet | the right hand up and waving, a small bow | warm smile, a word |

Red (flare) only for an alarm and a broken vault — danger that is true; mint never (it means value). A test holds both.

## How it is built

- `math.ts` — quaternions and 3×4 bone matrices on typed arrays; nothing allocates in a frame.
- `rig.ts` — the skeleton (rest rotations are identity: a bone's space at rest is the character's), forward kinematics,
  two-bone leg reach (feet stay planted through every pose and blend) and pistons aimed across the elbows and knees.
- `body.ts` — parts: a shape, a bone, a place, a surface, the detail levels it shows at; mirrored to the right side.
- `pose.ts`, `clip.ts` — key poses in degrees, eased into one another, with procedural life on top (breath, shaking,
  the wave); legs are never posed — the hips move and the feet are placed.
- `expression.ts` — the visor's face and the body's lights as numbers that blend like poses.
- `animator.ts` — plays a state, reactions over it, the walk and the look-at; crossfades every change.
- `lod.ts` — detail by size on screen with hysteresis.
- `guardian/` — the guardian's skeleton, clips and the armour in code (the stand-in while the model cannot load, and the
  proportions the model keeps).

The renderer is `city/components/characters/`: `model.ts` reads the GLB and moves each vertex from the character's space
into its bone's, `geometry.ts` merges the code body's parts into one geometry (bone and surface per vertex),
`bodyMaterial.ts` places vertices by bone in the shader, lights the baked PBR surfaces (or the code body's metal,
carbon and bronze) and draws the visor's face and the body's lights from the expression, `fx.ts` the hologram, sparks
and ground (shadow, dust, burst), `contactShadow.ts` a soft contact shadow for a studio or a hero room, `impostor.ts`
renders the standing guardian from 16 sides at two heights into one atlas for the far plane, coloured live by the
visor's hue.

### The model

`node assets-source/characters/guardian/build.mjs` (after `npm ci` in `assets-source/characters/`; Blender 5.2 at its
default path or `BLENDER=…`) rebuilds it from nothing:

1. `rig.mjs` writes the rig at rest from `guardian/rig.ts`; the model is built round those joints.
2. Blender runs `model.py`: `guardian.py` designs the body with `kit.py` — smooth lofts of superellipse cross-sections
   cut into plates by planes (the gaps are real seams; inner pieces of a limb are black glass, not shell), the visor
   set flush into an opening of the helmet, joints, tendons;
   `pipeline.py` unwraps the hero (only faces light reaches; sealed faces share one dark corner), bakes in Cycles — the
   fine relief and the engraved panel lines, rivets and hatches of `greebles.py` (selected to active), occlusion,
   worn edges, grime, the stencils of `decals.py` — composes base colour and ORM in numpy, gives the standard and crowd
   levels the hero's UVs, and exports the three levels with each vertex's bone and surface.
3. The pack step adds MikkTSpace tangents, WebP textures (colour lossy at full size; ORM and normal near-lossless at
   half) and Meshopt geometry, and writes `public/city/characters/guardian/` — the GLB with its textures as `.webp`
   files beside it (the site's CSP refuses the `blob:` URLs a loader makes for embedded images).

The standard level is the hero simplified (Decimate) and the crowd the standard simplified, so their UVs come with
them; the crowd reads its textures a few mip levels down. The city's quality ladder (CITY-6a, `city/lib/city/quality.ts`)
sets what a character spends: `CHARACTER_BUDGET` in `lod.ts` — on low the hero is never drawn and the crowd and the
picture come sooner, the contact shadow only on high.

The browser decodes the WebP textures itself; KTX2 would need the Basis transcoder, whose bindings are built with
eval, and the site's CSP allows WebAssembly (`'wasm-unsafe-eval'`, for Meshopt) but never eval. Should the model not
load, the body in code stands in.

An artist's model can take the same road: every piece a mesh fixed to one bone by name (the rig's names), surfaces
named as in `kit.py` (`TEXTURED`, `LIGHTS`), the visor's UVs across its glass. `pipeline.py` from step 2 on — UVs,
bake, levels, export — and the pack step do not care who made the pieces.

## Cost

One draw call for the body and one for the ground under it; the hologram adds one while thinking, sparks one for two seconds
after a defeat, the contact shadow (studio only) one draw of the body and four blur passes. The model: hero 59k
triangles, standard 20k, crowd 4.7k, impostor 2; the GLB and its three textures are 1.8 MB together, under 3 MB (a test
holds it). The body in code: hero 20k, standard 3.7k, crowd 0.4k. One update (blend, look, legs, 33 bones) is about 40 µs on a
desktop core. Measurements on the phone profile: `node city/components/characters/shots.mjs fps`.

## Review

`/city/characters` in development (production answers 404): every state, moment, movement and detail level, in the
studio (an HDR light room in the city's colours, a contact shadow, a violet rim) or on a pier with the city behind.
`?set=studio|city`, `?body=model|code` (the model or the first prototype), `?play=…&t=…` holds a clip at a second;
`&lod=lineup` shows the four levels side by side; `&silhouette`, `&stats`, `&bare`, `&clean`, `&turn`, `&dist`, `&lift` —
see `city/components/characters/dev/Studio.tsx`. Frames, the
contact sheet, the video and the measurements: `city/components/characters/shots.mjs`.

## Licences

Everything here is written in this repository: no third-party models, rigs, textures or animation files; the model is
made by Blender from our own scripts, its stencils in Blender's built-in font. When outside clips come
(registry CITY-57): Mixamo animations may be used in the product but their raw files are never redistributed; Meshy only
on a paid plan; free Tripo models are not for commercial use; Quaternius animations are CC0.

## Next archetypes

Scout, fighter, tactician, engineer and host reuse `rig.ts`, `pose.ts`, `clip.ts`, `animator.ts` and the renderer: each
brings its own skeleton proportions, parts and clips in a folder like `guardian/`.
