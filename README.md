# KontorRPG

A slow, social sandbox RPG for the office — crafting, combat and housing in a world inspired by
Rana. This repository is the **M0 tech spike**: the engine and netcode everything else builds on.
The design doc lives in the claude.ai doc "KontorRPG — Product Design Doc".

## What it does so far

- **World:** first-person walking (5 m/s, no sprint, jump) on streamed terrain chunks of
  "Mofjellet": hills, a lake, faceted pine and birch forest, mossy rocks, ore veins, grass and
  flowers that sway in the wind, and reflective rippling water.
- **Graphics:** physical sky baked into an HDR environment map, PBR materials, ACES tone mapping,
  soft shadows, ambient occlusion (GTAO), bloom and colour grading. Three quality levels
  (high / medium / low) for office laptops.
- **Characters:** creator with three races (human, dwarf, gnome — different heights and leg
  lengths), attributes that start at 5 and can be moved between (1–10, total 20), one of 10
  major perks and one of 8 minor perks, live derived stats and a 3D preview. Shoulder pauldrons
  per gear tier.
- **Multiplayer:** authoritative Node server; the client predicts its own movement and the
  server checks every step with the same shared rules (including perk speed changes).
  Remote players are interpolated; you only receive players near you (area of interest).
- **Accounts (optional):** email magic-link login through Supabase. Characters are saved on
  first login and loaded afterwards, with your last position. Guests can still play unless
  `REQUIRE_LOGIN=true`.
- **Office features:** chat, roster, ping, boss key (**F9**), character panel (**C**), and every
  open tab reloads itself after a deploy.

## Run locally

```bash
corepack enable          # once, gives you pnpm
pnpm install
pnpm dev                 # server on :8787, client with hot reload on http://localhost:5173
```

Open two browser windows (one incognito) to see two players. Production-style:

```bash
pnpm build && pnpm start # everything on http://localhost:8787
```

Tests: `pnpm test` (terrain, movement rules, protocol, world/netcode). Types: `pnpm typecheck`.

## Accounts and storage (Supabase)

Project `kontor-rpg` (Stockholm). The schema is in `supabase/migrations/`.

- `characters`: one row per account. Players can **read** only their own row (row-level
  security); only the game server writes, using the secret key, so gold, items and positions
  can't be edited from a browser.
- The server enables accounts when these environment variables are set:

| Variable | Where to find it | Secret? |
| --- | --- | --- |
| `SUPABASE_URL` | already in `render.yaml` | no |
| `SUPABASE_PUBLISHABLE_KEY` | already in `render.yaml` | no |
| `SUPABASE_SECRET_KEY` | Supabase → Project Settings → API Keys → Secret keys | **yes** — paste it in Render only |
| `REQUIRE_LOGIN` | `false` while people try it out, `true` once everyone has an account | no |

One-time Supabase setting: **Authentication → URL Configuration** → set *Site URL* to your
Render URL (e.g. `https://kontor-rpg.onrender.com`) and add it under *Redirect URLs*, plus
`http://localhost:8787` for local testing. Supabase's built-in email sender only sends a few
login emails per hour; for the whole office, add your own SMTP under Authentication → Emails.

## Design (Figma)

UI file: <https://www.figma.com/design/mcD4GPOdJW2knnFXc7Dsjl>. It holds the design tokens as
variables (colours, radius, spacing — the same values as `:root` in `packages/client/src/styles.css`),
text styles, components (button, option card, stat tile, attribute row, HUD chip, equipment
slot) and the screens: character creator, in-game HUD, character panel and pause.

## Deploy to Render

1. Push this repo to GitHub.
2. In Render, choose **New → Blueprint** and pick the repo; `render.yaml` sets everything up.
3. Every push to `main` deploys; open game tabs reload automatically.

Characters live in Supabase, so no Render disk is needed. The free plan works but sleeps after
15 idle minutes (about a minute to wake); the Starter plan (about 7 USD/month) stays awake.

## Layout

```
packages/
  shared/   constants, terrain, movement rules, character rules (races, perks), items, protocol
  server/   http + static client + WebSocket; World (tick, validation, area of interest);
            persistence (Supabase or in-memory)
  client/   Vite + three.js
    engine/    renderer, input, procgen (ported from KontorLAN)
    world/     terrain chunk streaming, vegetation and rocks, water
    entities/  character model (from KontorLAN's soldier), first-person viewmodel
    physics/   local movement / prediction
    net/       socket client, remote-player interpolation, Supabase login
    state/     stores: net, ui, settings
    ui/        HUD, creator, account box, character panel, pause, boss key
supabase/   SQL migrations
```

## What we took from KontorLAN

Procedural meshes and canvas textures (`canvasTex`, `speckle`, `grime`, `mat`, `boxGeo`, `limb`,
draw-call merging), the soldier model's skeleton (re-dressed as an adventurer), the separate
viewmodel scene, the name sprites, the presence-and-interpolation idea for remote players, the
self-hosted WebSocket with version check, and the dark/amber UI style.
What changed: three.js r128 → current via npm, one HTML file → TypeScript modules, client-trusted
damage → server authority, small flat maps → streamed heightmap chunks.

## Next: M1

Mining and smithing slice in Mofjellet: real ore veins with shared depletion and gems, carry
weight, furnace and anvil, bag and bank, character creation with attributes and traits, and
SQLite persistence.

## Tools

- `tools/model-batch/` generates races, gear, enemies, mounts and NPCs as game-ready `.glb` files with Tripo (or Meshy): previews, a local pick page, then texture, rig, animate and compress. See its README.
