# KontorRPG

A slow, social sandbox RPG for the office — crafting, combat and housing in a world inspired by
Rana. This repository is at **M1 — mining & smithing**: the M0 engine and netcode plus the first real
gameplay loop.
The design doc lives in the claude.ai doc "KontorRPG — Product Design Doc".

## What it does so far

- **World:** first-person walking (5 m/s, no sprint, jump) on streamed terrain chunks of
  "Mofjellet": hills, a lake, pine and birch forest, grass and flowers in the wind, rippling water.
  The camp at spawn, the lakeside village **Bjørkvik**, and **the Old Mine** (an underground area
  with its own lighting). Map on **M**.
- **Graphics:** physical sky, HDR environment, PBR, ACES, soft shadows, ambient occlusion, bloom
  and grading; three quality levels for office laptops.
- **Characters:** four races with racial bonuses (human: ranged + fishing; dwarf: armour +
  mining; gnome: magic + luck; ogre: +15% melee, −15% speed, + woodcutting), five faces,
  attributes, one major and one minor perk. Worn gear shows on the model.
- **Gathering:** shared ore veins (stone, iron, coal, silver) in a few hotspots plus loners,
  every tree can be felled (birch and pine) and topples over, leaving a stump until it regrows.
  A ring shows how used-up a vein or tree is, the same for everyone. Depleted nodes return after
  a random 45 min – 2 h (trees 20–60 min); nobody is told when. Fishing in the lake (or off
  Bjørkvik's pier) with a reel-in minigame.
- **Crafting:** furnace, anvil, workbench (carpentry), campfires and the inn stove (cooking, can
  burn). Timed queues. Crafted gear can roll **uncommon / rare / epic** with 1–3 random effects;
  luck raises the odds. **Legendary** only drops from bosses.
- **Metal tiers:** stone → iron → **steel** (iron ore + coal at a furnace) → **silversteel**
  (steel + silver bars). Every tier has swords, longswords, battleaxes, pickaxes, hatchets,
  skinning knives, shields and full armour; silversteel armour also wards off some magic.
  **Jewellery:** silver rings and necklaces, plain or set with quartz, sapphire or garnet.
- **Gear:** stone and iron swords, longswords (Whirlwind), battleaxes, kite shields and full metal
  armour; birch and pine bows (arrows from shafts + smithed arrowheads) and staffs (imbued with fire
  or frost by Ragna in Bjørkvik); leather and cloth armour from the trader. Metal: strong vs
  physical, a little slower, magic hurts more. Leather: middle, a little faster. Cloth: strong vs
  magic.
- **Combat:** left click attacks at the weapon's pace, right click is the weapon's special on a
  6–18 s cooldown (longer = stronger). Fire stacks burns, Ignite detonates them; frost slows, Frost
  Nova freezes. Wolves and goblins in the wild; bats, goblins, shamans and the boss **Old Knut** in
  the mine. Loot drops on the ground and is free for all: whoever gets there first takes it. Soft death: wake up
  at camp, weakened for two minutes.
- **Skinning and leather:** smith a skinning knife and wear it, then press E on a dead wolf or
  goblin (bodies stay 30 s) for pelts or goblin skin. Hides can be ruined (stone knife 35%, iron
  18%); either way the body is gone for everyone. Knives wear out — repair them at an anvil; rarer
  knives last longer and give extra pelts. Tan hides at a tanning rack, then make leather armour.
- **Progression:** skills (mining, smithing, woodcutting, carpentry, fishing, cooking) and a
  player level from combat. Every level is a talent point; talent trees (**T**) start with a
  three-rank root and branch out to bigger one-point notables. Repeatable daily / twice-weekly /
  weekly quests from NPCs.
- **Gruben:** a second region through the pass in the eastern mountains (level 12+): an old mine
  valley with lynxes (skin them for lynx leather, tier 3), draug miners, Lyktemenn in the bog,
  scree trolls, and the boss **the Mine King** in the pit. Coal and silver everywhere; a camp with a
  forge, a tanning rack and Johan's quests.
- **Housing:** one home at a time — a lodge room (25 g/wk, 24-slot chest), a cottage on Bjørkvik's
  green (60 g/wk, 48 slots) or a miners' hut at Gruben camp (40 g/wk, 36 slots). Rent at the door
  (or from Hilde for rooms); your chest moves with you. Rest at your door for **Rested** (+5–10% XP
  for 30 min).
- **World state is saved:** depleted veins and trees, boss and monster respawn timers and items on
  the ground survive server restarts and deploys (Supabase `world_state`, server-only).
- **Interface:** hotbar (1–5), health and buffs, item tooltips (type, damage, effects, vendor
  value), right-click to drop, quest tracker, character sheet with skills, gear and bag (**C** / **I** / **K**).
- **Multiplayer:** authoritative Node server checks every move, swing, cast and craft; rolls every
  random thing. Accounts via Supabase magic links; everything is saved for logged-in players.
- **Office features:** chat, roster, ping, boss key (**F9**), auto-reload after deploys.

What changed: three.js r128 → current via npm, one HTML file → TypeScript modules, client-trusted
damage → server authority, small flat maps → streamed heightmap chunks.

## Next

M1 polish (bank chest, durability, more veins and recipes), then M2: fishing and the docks.

## Tools

- `tools/model-batch/` generates races, gear, enemies, mounts and NPCs as game-ready `.glb` files with Tripo (or Meshy): previews, a local pick page, then texture, rig, animate and compress. See its README.
