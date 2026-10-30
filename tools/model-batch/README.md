# KontorRPG model batch

Turns the prompts in `prompts.json` (from the KontorRPG Meshy Prompt Style Guide) into game-ready `.glb` files using **Tripo** by default, or Meshy with `--provider meshy`. You do one thing by hand: pick the best-looking variant.

```
plan  →  generate  →  pick  →  finish
free     untextured   your      texture, rig, animate,
         previews     browser   compress → out/
```

Every step saves to `state.json`. If a run stops halfway (closed laptop, network drop, an error), run the same command again and it carries on without paying twice.

## Setup

1. Install Node 20 or newer (the same as the game).
2. In this folder: `npm install`
3. Get a Tripo API key: sign in at **platform.tripo3d.ai**, open **API Keys** and create one. Tripo reportedly adds about 2,000 free credits the first time you create a key; run `node models.mjs balance` afterwards to see what you got. These API credits are separate from the 300 monthly credits on Tripo's website.
4. Set the key in the terminal you run the tool from (once per terminal window):
   - Windows PowerShell: `$env:TRIPO_API_KEY="your-key"`
   - macOS / Linux: `export TRIPO_API_KEY=your-key`

Never commit the key or paste it into chat.

## Try it free first

The mock server imitates Tripo's (and Meshy's) API and returns placeholder cubes, so you can walk through the whole flow without spending anything.

```
# terminal 1
node mock-api.mjs

# terminal 2  (PowerShell: $env:TRIPO_BASE_URL="http://localhost:4010/v3"; $env:TRIPO_API_KEY="mock")
export TRIPO_BASE_URL=http://localhost:4010/v3 TRIPO_API_KEY=mock
node models.mjs generate --category helmets
node models.mjs pick
node models.mjs finish
```

Afterwards: close the mock, delete `state.json`, `work/` and `out/`, and open a fresh terminal (so `TRIPO_BASE_URL` is gone) before the real run.

## The real run

```
node models.mjs plan --category races               # prompts, lengths, credit estimate. Free.
node models.mjs generate --category races           # asks before spending credits
node models.mjs pick                                # opens http://localhost:5179
node models.mjs finish                              # asks before spending credits
```

- **generate** makes 2 untextured low-poly previews per item (`--variants 1` halves the cost) and downloads a picture and the preview model of each.
- **pick** shows every item with its variants. Click a picture to pick it, press **3D** to turn it around, or **None are good — regenerate** to have the next `generate` try again. Picks save instantly; press Ctrl+C in the terminal when done.
- **finish** textures each pick with baked lighting removed, rigs bodies, enemies, NPCs and mounts (after Tripo's free "can this be rigged?" check), adds their animations, downloads everything and compresses it into `out/<category>/`.

Do pick and finish soon after generating; Tripo's download links don't last forever.

Other commands: `status` (where each item is), `balance` (credits left), `help`. Useful options: `--only id1,id2`, `--all`, `--yes` (skip the credit question), `--redo` (rebuild finished items from saved downloads), `--concurrency 2`.

## What it costs (Tripo)

| Step | Credits |
| --- | --- |
| Preview, per variant (untextured, smart low-poly) | 20 |
| Texture the pick | about 10 (not on Tripo's price list; estimated) |
| "Can it be rigged?" check | free |
| Rig | 25 |
| Each animation (max 5 per model) | 10 |

Prices from [Tripo's developer pricing](https://developers.tripo3d.ai/en/pricing). All 42 models at 2 variants each come to about 2,900 credits, so spend the free credits where they matter most. A first round that fits in about 2,000:

| Batch | Command | Credits (approx.) |
| --- | --- | --- |
| Races, 2 variants | `generate --category races` | 375 |
| Helmets, shoulders, weapons, 1 variant | `generate --category helmets,shoulders,weapons --variants 1` | 690 |
| Enemies, 2 variants | `generate --category enemies` | 500 |
| Left for regenerating | | ~400 |

`plan` gives the exact estimate for whatever you select.

## What comes out

```
out/
  races/human.glb          rigged, with its animation clips inside
  helmets/helm-nasal.glb   gear: no rig
  mounts/work-horse.glb    rigged quadruped with a walk cycle
```

With Tripo, each rigged model is one file holding the model and up to 5 clips (idle, walk, run, attack, hit by default; enemies get death instead of run). With Meshy you get one extra file per animation (`goblin-miner@attack.glb`).

Files are compressed with meshopt geometry and WebP textures, with textures capped per category (512 px for gear, 1024 for bodies, 2048 for bosses). Put them in `packages/client/public/models/` and load them in three.js with the meshopt decoder:

```js
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';

const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
const human = await loader.loadAsync('/models/races/human.glb');
console.log(human.animations.map((c) => c.name));      // check the clip names once

const mixer = new THREE.AnimationMixer(human.scene);
mixer.clipAction(human.animations[0]).play();           // call mixer.update(dt) every frame
```

## Changing the prompts

Everything lives in `prompts.json`:

- `style` is added to every prompt; `negative` lists what to avoid (Tripo only, max 255 characters together with a category's `negativeExtra`).
- `categories` set the triangle budget (`polycount`, 500–20,000 with Tripo's smart low-poly), texture size, rig type (`biped`, `quadruped` or `none`) and animations per category.
- `items` are the models. Any category setting can be overridden per item, for example `"polycount": 2000` or `"rig": "none"`.
- `tripoAnimations` maps the animation names used in categories (`idle`, `attack`, `hit`, `death`…) to Tripo's presets: idle, walk, run, dive, climb, jump, slash, shoot, hurt, fall and turn for bipeds, and a walk for quadrupeds.

Add a model by adding an item with a new `id`, a `category` and a `subject`; `plan` checks prompt lengths.

## When something goes wrong

| Message | What to do |
| --- | --- |
| `rejected the API key` | Check `TRIPO_API_KEY`. |
| `Not enough credits` | `node models.mjs balance`; top up at platform.tripo3d.ai (from 1 USD) or wait for more free credits. |
| `banned: blocked by the content filter` | Reword that item's subject and run `generate` again. |
| `can't be rigged; keeping it unrigged` | The model is still exported, without bones. Animate it in code, or regenerate with a clearer T-pose. |
| An item failed | Run the same command again; only failed work is retried. |
| `state.json was made with tripo` | A run's tasks belong to one provider. Use `--state meshy-state.json` for a separate Meshy run. |

## Meshy instead

If you get Meshy Pro later: set `MESHY_API_KEY` and add `--provider meshy` (with its own `--state` file). Meshy costs 20 per preview, 10 to texture, 5 to rig (walk and run included) and 3 per extra animation.
