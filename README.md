# KontorRPG

A slow, social sandbox RPG for the office — crafting, combat and housing in a world inspired by
Rana. This repository is the **M0 tech spike**: the engine and netcode everything else builds on.
The design doc lives in the claude.ai doc "KontorRPG — Product Design Doc".

## What M0 does

- First-person walking (5 m/s, no sprint, jump) on streamed terrain chunks of "Mofjellet":
  hills, a lake, pine and birch forest, rocks and decorative ore veins.
- Multiplayer through an authoritative Node server: the client predicts its own movement, the
  server checks every step with the same shared rules and corrects cheaters or glitches.
- Remote players are interpolated 120 ms in the past from server-timestamped snapshots, and you
  only receive players in the 3 × 3 chunks around you (area of interest).
- A character panel (**C**) shows a rotating third-person render of your character.
- Chat (**Enter**), online roster, ping, low-GPU mode, and a boss key (**F9**).
- Deploy-safe: on a new deploy every open tab notices `/version` changed and reloads itself.

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

## Deploy to Render

1. Push this repo to GitHub.
2. In Render, choose **New → Blueprint** and pick the repo; `render.yaml` sets everything up.
3. Every push to `main` deploys; open game tabs reload automatically.

The free plan sleeps after 15 idle minutes (about a minute to wake) and has no persistent disk.
That is fine for M0. From M1, characters are saved, so switch to the Starter plan with a 1 GB disk.

## Layout

```
packages/
  shared/   constants, deterministic terrain, movement rules, wire protocol — used by both sides
  server/   http + static client + WebSocket; World (tick, validation, area of interest)
  client/   Vite + three.js
    engine/    renderer, input, procgen (ported from KontorLAN)
    world/     terrain chunk streaming, props, water
    entities/  character model (from KontorLAN's soldier), first-person viewmodel
    physics/   local movement / prediction
    net/       socket client, remote-player interpolation
    state/     stores: net, ui, settings
    ui/        HUD, menu, character panel, boss key
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
