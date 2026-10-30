# KontorRPG Meshy batch

Turns the prompts from the KontorRPG Meshy Prompt Style Guide into game-ready `.glb` files, with one manual step: you pick the best-looking variant.

```
plan  →  generate  →  pick  →  finish
free     previews     your      texture, rig, animate,
         (2 each)     browser   compress → out/
```

Every step saves to `state.json`. If a run stops halfway (closed laptop, network drop, Meshy error), run the same command again and it carries on where it left off without paying twice.

## Setup

1. Install Node 18 or newer.
2. In this folder: `npm install`
3. Get an API key at meshy.ai → Settings → API. The API needs **Meshy Pro or higher**; free-plan keys get error 402.
4. Set the key in the terminal you run the script from:
   - macOS / Linux: `export MESHY_API_KEY=msy_...`
   - Windows PowerShell: `$env:MESHY_API_KEY="msy_..."`

## Try it free first

The mock server imitates Meshy's API and returns placeholder cubes, so you can walk through the whole flow without a key or credits.

```
# terminal 1
node mock-meshy.mjs

# terminal 2 (PowerShell: $env:MESHY_BASE_URL="http://localhost:4010"; $env:MESHY_API_KEY="mock")
export MESHY_BASE_URL=http://localhost:4010 MESHY_API_KEY=mock
node meshy.mjs generate --category helmets
node meshy.mjs pick
node meshy.mjs finish
```

Delete `state.json`, `work/` and `out/` afterwards, and close the mock, before the real run.

## The real run

```
node meshy.mjs plan --category races,helmets        # prompts, lengths, credit estimate. Free.
node meshy.mjs generate --category races,helmets    # asks before spending credits
node meshy.mjs pick                                 # opens http://localhost:5179
node meshy.mjs finish                               # asks before spending credits
```

- **generate** makes 2 untextured previews per item (`--variants 3` for more) and downloads a thumbnail and the preview model for each.
- **pick** shows every item with its variants. Click a picture to pick it, press **3D** to turn it around, or **None are good — regenerate** to have the next `generate` try again. Picks save instantly; press Ctrl+C in the terminal when done.
- **finish** textures each pick with Meshy's lighting removal on, rigs and animates bodies, enemies, NPCs and mounts, downloads everything and compresses it into `out/<category>/`.

Pick and finish within 3 days of generating: Meshy deletes task files after 3 days on non-Enterprise plans, and texturing needs the preview to still exist.

Other commands: `status` (where each item is), `anims <word>` (search Meshy's animation library), `balance` (credits left), `help`.

Useful options: `--only id1,id2`, `--all`, `--yes` (skip the credit question), `--redo` (rebuild finished items; reuses downloads, no new credits unless a different variant was picked), `--concurrency 3`.

## What it costs

| Step | Credits |
| --- | --- |
| Preview (per variant) | 20 |
| Texture | 10 |
| Rig (includes walk and run) | 5 |
| Each extra animation | 3 |

A helmet with 2 variants is about 50 credits. A rigged enemy with idle, attack, hit and death is about 67. Run `plan` for the exact estimate before any batch.

## What comes out

```
out/
  helmets/helm-nasal.glb
  enemies/goblin-miner.glb           rigged model
  enemies/goblin-miner@walk.glb      one file per animation
  enemies/goblin-miner@attack.glb
  ...
```

Files are compressed with meshopt geometry and WebP textures, with textures capped at each category's size (512 px for gear, 1024 for bodies, 2048 for bosses). Load them in three.js (r128 or newer) with the meshopt decoder, and play clips from the animation files on the main model:

```js
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';

const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
const goblin = await loader.loadAsync('models/enemies/goblin-miner.glb');
const attack = await loader.loadAsync('models/enemies/goblin-miner@attack.glb');

const mixer = new THREE.AnimationMixer(goblin.scene);
mixer.clipAction(attack.animations[0]).play();   // call mixer.update(dt) every frame
```

## Changing the prompts

Everything lives in `prompts.json`:

- `style` is the style block added to every prompt.
- `categories` set the triangle budget (`polycount`), texture size, pose, rig type (`biped`, `quadruped` or `none`), animations and an `extra` phrase per category.
- `items` are the models. Any category setting can be overridden per item, for example `"polycount": 2000` on the greatsword or `"height": 3.0` (metres, used for rigging) on the troll.

Add a model by adding an item with a new `id`, a `category` and a `subject`. Prompts must stay under 800 characters; `plan` checks this.

Animations are listed by name (`"idle"`, `"attack"`). The first time, the script searches Meshy's animation library for each name, prints which animation it chose and remembers it. If it picked the wrong one, find a better match with `node meshy.mjs anims attack` and pin it:

```json
"animationIds": { "attack": 1234, "death": 5678 }
```

## When something goes wrong

| Message | What to do |
| --- | --- |
| `rejected the API key (401)` | Check `MESHY_API_KEY`. |
| `Not enough credits, or the key is on the free plan (402)` | Top up, or upgrade to Pro. |
| An item failed | Run the same command again; only failed work is retried. |
| `No animation found for "..."` | Pin an id in `animationIds` as above. |
| Rigging fails on a creature | Meshy's auto-rigging suits standard humanoids and four-legged animals. Set `"rig": "none"` on that item and animate it in code or Blender. |
