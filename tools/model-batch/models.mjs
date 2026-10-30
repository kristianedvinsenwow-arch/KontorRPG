#!/usr/bin/env node
// KontorRPG model batch: turn prompts.json into game-ready .glb files with Tripo (default) or Meshy.
//
//   node models.mjs plan      --category helmets      prompts and credit estimate, no API calls
//   node models.mjs generate  --category helmets      untextured previews (2 variants each)
//   node models.mjs pick                              local page to pick the best variant
//   node models.mjs finish                            texture, rig, animate, download, compress
//   node models.mjs status                            where every item is
//   node models.mjs balance                           credits left
//
// Tripo needs TRIPO_API_KEY (made at platform.tripo3d.ai). Meshy needs MESHY_API_KEY (Pro plan)
// and --provider meshy. Every step saves to state.json, so a run that stops halfway can simply be
// run again and carries on where it left off.

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import readline from 'node:readline/promises';
import { spawn } from 'node:child_process';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------- args

const argv = process.argv.slice(2);
const command = argv[0] && !argv[0].startsWith('--') ? argv[0] : 'help';
const positional = [];
const flags = {};
for (let i = command === 'help' ? 0 : 1; i < argv.length; i++) {
  const a = argv[i];
  if (a.startsWith('--')) {
    const [k, v] = a.slice(2).split('=');
    if (v !== undefined) flags[k] = v;
    else if (argv[i + 1] && !argv[i + 1].startsWith('--')) flags[k] = argv[++i];
    else flags[k] = true;
  } else positional.push(a);
}
const list = (v) => (typeof v === 'string' ? v.split(',').map((s) => s.trim()).filter(Boolean) : []);

const PROMPTS_FILE = path.resolve(flags.prompts || path.join(HERE, 'prompts.json'));
const STATE_FILE = path.resolve(flags.state || path.join(HERE, 'state.json'));
const WORK = path.join(HERE, 'work');
const OUT = path.resolve(flags.out || path.join(HERE, 'out'));
const VARIANTS = Math.max(1, Number(flags.variants || 2));
const CONCURRENCY = Math.max(1, Number(flags.concurrency || 2));
const PORT = Number(flags.port || 5179);
const POLL_SECONDS = Number(process.env.POLL_SECONDS || 4);

// ---------------------------------------------------------------- helpers

function die(msg) {
  console.error(`\n✖ ${msg}\n`);
  process.exit(1);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (id, msg) => console.log(`  ${id.padEnd(28)} ${msg}`);
const rel = (p) => path.relative(HERE, p).split(path.sep).join('/');

async function pool(items, n, fn) {
  const queue = [...items];
  await Promise.all(Array.from({ length: Math.min(n, queue.length) }, async () => {
    while (queue.length) await fn(queue.shift());
  }));
}

async function download(url, file) {
  await fsp.mkdir(path.dirname(file), { recursive: true });
  const res = await fetch(url);
  if (!res.ok || !res.body) throw new Error(`Download failed (${res.status}) for ${url}`);
  const tmp = file + '.part';
  await pipeline(Readable.fromWeb(res.body), fs.createWriteStream(tmp));
  await fsp.rename(tmp, file);
  return file;
}

function imageExt(url) {
  const ext = path.extname(new URL(url).pathname).toLowerCase();
  return ['.png', '.jpg', '.jpeg', '.webp'].includes(ext) ? ext : '.png';
}

// ---------------------------------------------------------------- HTTP

let PROVIDER; // set below

async function api(method, route, body) {
  const key = process.env[PROVIDER.keyEnv];
  if (!key) die(`Set ${PROVIDER.keyEnv} first. ${PROVIDER.keyHelp}`);
  const base = (process.env[PROVIDER.baseEnv] || PROVIDER.base).replace(/\/$/, '');
  for (let attempt = 0; ; attempt++) {
    let res;
    try {
      res = await fetch(base + route, {
        method,
        headers: { Authorization: `Bearer ${key}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch (err) {
      if (attempt < 4) { await sleep(2000 * (attempt + 1)); continue; }
      throw new Error(`Network error on ${method} ${base}${route}: ${err.cause?.code || err.message}`);
    }
    if ((res.status === 429 || res.status >= 500) && attempt < 6) {
      await sleep((Number(res.headers.get('retry-after')) || 2 ** attempt) * 1000);
      continue;
    }
    const text = await res.text();
    let data;
    try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }
    // Tripo answers {code: 0, data} on success and a non-zero code with a message on errors.
    const failed = !res.ok || (typeof data.code === 'number' && data.code !== 0);
    if (failed) {
      const detail = [data.message || data.error || data.raw || res.statusText, data.suggestion].filter(Boolean).join(' — ');
      if (res.status === 401 || res.status === 403) throw new Error(`${PROVIDER.label} rejected the API key (${res.status}). Check ${PROVIDER.keyEnv}. ${detail}`);
      if (res.status === 402) throw new Error(`Not enough credits (402). ${PROVIDER.creditHelp} ${detail}`);
      const err = new Error(`${PROVIDER.label} ${res.status}${data.code ? ' code ' + data.code : ''} on ${method} ${route}: ${detail}`);
      err.status = res.status;
      throw err;
    }
    return { data, retryAfter: Number(res.headers.get('retry-after')) || 0 };
  }
}

async function createTask(route, body) {
  const { data } = await api('POST', route, body);
  const id = data.data?.task_id ?? data.result;
  if (!id) throw new Error(`No task id from POST ${route}: ${JSON.stringify(data).slice(0, 200)}`);
  return id;
}

// Polls until the task ends; returns the provider's normalised view: { glb, thumb, ...extras }.
async function waitTask(kind, id, label) {
  let last = -1;
  for (;;) {
    const { view, retryAfter } = await PROVIDER.get(kind, id);
    if (view.state === 'success') return view;
    if (view.state === 'failed') throw new Error(view.error || 'task failed');
    const step = Math.floor((view.progress || 0) / 25) * 25; // log at 25, 50 and 75 %
    if (label && step > 0 && step < 100 && step !== last) { log(label, `${step}%`); last = step; }
    await sleep(Math.max(retryAfter, POLL_SECONDS) * 1000);
  }
}

// ---------------------------------------------------------------- providers

const tripo = {
  name: 'tripo',
  label: 'Tripo',
  keyEnv: 'TRIPO_API_KEY',
  baseEnv: 'TRIPO_BASE_URL',
  base: 'https://openapi.tripo3d.ai/v3',
  keyHelp: 'Make a key at platform.tripo3d.ai → API Keys.',
  creditHelp: 'Check credits with "node models.mjs balance" and top up at platform.tripo3d.ai.',
  maxPrompt: 1024,
  // Credits from developers.tripo3d.ai/en/pricing. Texturing an existing mesh is not listed there;
  // 10 is an estimate (the price gap between textured and untextured generation).
  cost: { preview: (s) => 10 + (s.smartLowPoly === false ? 0 : 10), texture: 10, rig: 25, anim: 10, maxAnims: 5, estimated: ['texture'] },

  preview(s) {
    const smart = s.smartLowPoly !== false;
    return createTask('/generation/text-to-model', {
      prompt: s.prompt,
      ...(s.negative ? { negative_prompt: s.negative } : {}),
      model: s.tripoModel || 'v3.1-20260211',
      texture: false,
      pbr: false,
      smart_low_poly: smart,
      face_limit: smart ? Math.min(20000, Math.max(500, s.polycount)) : s.polycount,
    });
  },
  texture(sourceTask) {
    return createTask('/models/texture', { input: sourceTask, model: 'v3.5-20260815', pbr: false, delight: true, texture_quality: 'standard' });
  },
  async get(kind, id) {
    const { data, retryAfter } = await api('GET', `/tasks/${id}`);
    const d = data.data || data;
    const out = d.output || {};
    const done = d.status === 'success';
    const failed = ['failed', 'banned', 'expired', 'cancelled', 'unknown'].includes(d.status);
    const why = d.status === 'banned' ? 'blocked by the content filter; reword the prompt' : d.error_message || '';
    return {
      retryAfter,
      view: {
        state: done ? 'success' : failed ? 'failed' : 'running',
        progress: d.progress ?? 0,
        error: failed ? `${d.status}${why ? ': ' + why : ''}` : null,
        glb: out.model_url || out.pbr_model || out.model || null,
        thumb: out.rendered_image_url || out.rendered_image || null,
        riggable: out.riggable,
        rigType: out.rig_type,
      },
    };
  },
  async rig(st, s, item) {
    // The rig check is free and tells us whether auto-rigging will work at all.
    if (st.rig.riggable === undefined) {
      st.rig.checkTask ??= await createTask('/animations/rig-check', { input: st.texture.taskId });
      await saveState();
      const check = await waitTask('rigcheck', st.rig.checkTask);
      st.rig.riggable = check.riggable !== false;
      st.rig.suggested = check.rigType;
      await saveState();
    }
    if (!st.rig.riggable) {
      log(item.id, `⚠ Tripo says this model can't be rigged; keeping it unrigged`);
      return false;
    }
    if (st.rig.suggested && st.rig.suggested !== s.rig) log(item.id, `note: Tripo suggests rig type "${st.rig.suggested}", using "${s.rig}" from prompts.json`);
    st.rig.taskId ??= await createTask('/animations/rig', {
      input: st.texture.taskId,
      model: s.rig === 'biped' ? 'v3.0-20260909' : 'v2.5-20260210',
      rig_type: s.rig,
      out_format: 'glb',
    });
    await saveState();
    log(item.id, `rigging (${s.rig})`);
    const task = await waitTask('rig', st.rig.taskId, item.id);
    if (!task.glb) throw new Error('rigged model has no .glb link');
    st.rig.file = rel(await download(task.glb, path.join(WORK, 'rigged', `${item.id}.glb`)));
    return true;
  },
  // One retarget task with up to 5 presets gives one .glb holding the model and all its clips.
  async animate(st, s, item, cfg) {
    const map = cfg.tripoAnimations || {};
    const wanted = [];
    for (const name of s.animations) {
      const preset = (s.rig === 'quadruped' && map[`quadruped:${name}`]) || map[name];
      if (!preset) { log(item.id, `⚠ no Tripo preset for "${name}" (add it to "tripoAnimations"); skipped`); continue; }
      if (s.rig !== 'biped' && !preset.includes(`${s.rig}:`)) { log(item.id, `⚠ "${name}" is a biped animation; skipped for ${s.rig}`); continue; }
      if (!wanted.includes(preset)) wanted.push(preset);
    }
    if (wanted.length > 5) { log(item.id, `⚠ Tripo takes 5 animations per model; using ${wanted.slice(0, 5).join(', ')}`); wanted.length = 5; }
    if (!wanted.length) return null;

    const a = (st.anims ??= {});
    if (a.key !== wanted.join('|')) Object.assign(a, { key: wanted.join('|'), taskId: undefined, file: undefined });
    if (!a.file) {
      if (!a.taskId) {
        // Tripo has documented both "preset:idle" and "idle"; the spelling that worked is remembered.
        const spell = (names, prefixed) => names.map((n) => { const bare = n.replace(/^preset:/, ''); return prefixed ? `preset:${bare}` : bare; });
        const body = (names) => ({ input: st.rig.taskId, animations: names, out_format: 'glb', export_with_geometry: true });
        const first = state.tripoPresetPrefix ?? wanted[0].startsWith('preset:');
        try {
          a.taskId = await createTask('/animations/retarget', body(spell(wanted, first)));
          state.tripoPresetPrefix = first;
        } catch (err) {
          if (err.status === undefined || err.status >= 500 || state.tripoPresetPrefix !== undefined) throw err;
          a.taskId = await createTask('/animations/retarget', body(spell(wanted, !first)));
          state.tripoPresetPrefix = !first;
          log(item.id, `note: Tripo wants animation names ${first ? 'without' : 'with'} "preset:"; remembered for the next models`);
        }
        await saveState();
      }
      log(item.id, `animating: ${s.animations.join(', ')}`);
      const task = await waitTask('anim', a.taskId, item.id);
      if (!task.glb) throw new Error('animated model has no .glb link');
      a.file = rel(await download(task.glb, path.join(WORK, 'animated', `${item.id}.glb`)));
      await saveState();
    }
    return { main: path.join(HERE, a.file), extras: [] };
  },
  async balance() {
    const { data } = await api('GET', '/account/balance');
    const d = data.data || data;
    return `${d.balance}${d.frozen ? ` (${d.frozen} held for running tasks)` : ''}`;
  },
};

const meshy = {
  name: 'meshy',
  label: 'Meshy',
  keyEnv: 'MESHY_API_KEY',
  baseEnv: 'MESHY_BASE_URL',
  base: 'https://api.meshy.ai',
  keyHelp: 'Make a key at meshy.ai → Settings → API (needs Meshy Pro).',
  creditHelp: 'The Meshy API also needs a Pro plan or higher.',
  maxPrompt: 800,
  cost: { preview: () => 20, texture: 10, rig: 5, anim: 3, maxAnims: 99, estimated: [] },

  preview(s) {
    return createTask('/openapi/v2/text-to-3d', {
      mode: 'preview', prompt: s.prompt, ai_model: s.meshyModel || 'meshy-6', should_remesh: true, topology: 'triangle',
      target_polycount: s.polycount, ...(s.pose ? { pose_mode: s.pose } : {}), target_formats: ['glb'],
    });
  },
  texture(sourceTask) {
    return createTask('/openapi/v2/text-to-3d', { mode: 'refine', preview_task_id: sourceTask, enable_pbr: false, remove_lighting: true, target_formats: ['glb'] });
  },
  async get(kind, id) {
    const route = { preview: '/openapi/v2/text-to-3d', texture: '/openapi/v2/text-to-3d', rig: '/openapi/v1/rigging', anim: '/openapi/v1/animations' }[kind];
    const { data: d, retryAfter } = await api('GET', `${route}/${id}`);
    const failed = d.status === 'FAILED' || d.status === 'CANCELED';
    const glb = d.result?.rigged_character_glb_url || d.result?.animation_glb_url || d.model_urls?.glb || null;
    return {
      retryAfter,
      view: {
        state: d.status === 'SUCCEEDED' ? 'success' : failed ? 'failed' : 'running',
        progress: d.progress ?? 0,
        error: failed ? `${d.status.toLowerCase()}: ${d.task_error?.message || 'no reason given'}` : null,
        glb,
        thumb: d.thumbnail_url || null,
        basic: d.result?.basic_animations || null,
      },
    };
  },
  async rig(st, s, item) {
    st.rig.taskId ??= await createTask('/openapi/v1/rigging', { input_task_id: st.texture.taskId, height_meters: s.height || 1.7, animation_type: s.rig });
    await saveState();
    log(item.id, `rigging (${s.rig})`);
    const task = await waitTask('rig', st.rig.taskId, item.id);
    if (!task.glb) throw new Error('rigged model has no .glb link');
    st.rig.file = rel(await download(task.glb, path.join(WORK, 'rigged', `${item.id}.glb`)));
    st.rig.basic = {};
    for (const [key, name] of [['walking_glb_url', 'walk'], ['running_glb_url', 'run']]) {
      if (task.basic?.[key]) st.rig.basic[name] = rel(await download(task.basic[key], path.join(WORK, 'animated', `${item.id}@${name}.glb`)));
    }
    return true;
  },
  // Meshy makes one file per animation; walk and run come free with the rig.
  async animate(st, s, item, cfg) {
    const extras = Object.entries(st.rig.basic || {}).map(([name, f]) => ({ name, file: path.join(HERE, f) }));
    st.anims ??= {};
    for (const name of s.animations) {
      if (st.rig.basic?.[name]) continue;
      const id = cfg.meshyAnimationIds?.[name] ?? state.animationIds[name] ?? (await meshySearch(name));
      const a = (st.anims[name] ??= {});
      if (a.actionId !== id) Object.assign(a, { actionId: id, taskId: undefined, file: undefined });
      if (!a.file) {
        a.taskId ??= await createTask('/openapi/v1/animations', { rig_task_id: st.rig.taskId, action_id: id });
        await saveState();
        log(item.id, `animating: ${name}`);
        const task = await waitTask('anim', a.taskId, item.id);
        if (!task.glb) throw new Error(`animation "${name}" has no .glb link`);
        a.file = rel(await download(task.glb, path.join(WORK, 'animated', `${item.id}@${name}.glb`)));
        await saveState();
      }
      extras.push({ name, file: path.join(HERE, a.file) });
    }
    return { main: null, extras };
  },
  async balance() {
    const { data } = await api('GET', '/openapi/v1/balance');
    return data.balance ?? JSON.stringify(data);
  },
};

async function meshySearch(name) {
  const { data } = await api('GET', `/openapi/v1/animations/library?search=${encodeURIComponent(name)}`);
  const arr = Array.isArray(data) ? data : data.result || data.data || data.items || [];
  const hit = (Array.isArray(arr) ? arr : []).map((a) => ({ id: a.action_id ?? a.id, name: a.name ?? '' })).find((a) => a.id != null);
  if (!hit) throw new Error(`No Meshy animation found for "${name}". Set "meshyAnimationIds": {"${name}": <id>} in prompts.json.`);
  state.animationIds[name] = hit.id;
  console.log(`  animation "${name}" → Meshy #${hit.id} ${hit.name}`);
  await saveState();
  return hit.id;
}

const PROVIDERS = { tripo, meshy };
const providerName = String(flags.provider || process.env.MODEL_PROVIDER || (process.env.MESHY_API_KEY && !process.env.TRIPO_API_KEY ? 'meshy' : 'tripo')).toLowerCase();
PROVIDER = PROVIDERS[providerName];
if (!PROVIDER) die(`Unknown provider "${providerName}". Use tripo or meshy.`);

// ---------------------------------------------------------------- config + state

function loadConfig() {
  const cfg = JSON.parse(fs.readFileSync(PROMPTS_FILE, 'utf8'));
  const ids = new Set();
  for (const item of cfg.items) {
    if (ids.has(item.id)) throw new Error(`Duplicate item id "${item.id}" in ${PROMPTS_FILE}`);
    ids.add(item.id);
    if (!cfg.categories[item.category]) throw new Error(`Item "${item.id}" uses unknown category "${item.category}"`);
  }
  return cfg;
}

// An item's settings: its own fields win over its category's.
function settings(cfg, item) {
  const cat = cfg.categories[item.category];
  const s = { ...cat, ...item };
  s.prompt = [item.subject, cat.extra, cfg.style].filter(Boolean).join(', ');
  s.negative = [cfg.negative, cat.negativeExtra, item.negativeExtra].filter(Boolean).join(', ');
  s.animations = item.animations ?? cat.animations ?? [];
  s.rig = s.rig || 'none';
  return s;
}

function estimate(s) {
  const c = PROVIDER.cost;
  const anims = s.rig === 'none' ? 0 : Math.min(c.maxAnims, s.animations.length);
  return { preview: c.preview(s), finish: c.texture + (s.rig !== 'none' ? c.rig + c.anim * anims : 0) };
}

let state = { provider: null, items: {}, animationIds: {} };
function loadState() {
  if (fs.existsSync(STATE_FILE)) state = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
  state.items ??= {};
  state.animationIds ??= {};
  if (state.provider && state.provider !== PROVIDER.name && Object.keys(state.items).length && !['plan', 'status', 'help', 'balance'].includes(command)) {
    die(`state.json was made with ${state.provider}; tasks can't move between providers. Add --provider ${state.provider}, or use --state another.json for a ${PROVIDER.label} run.`);
  }
}
let saving = Promise.resolve();
function saveState() {
  state.provider ??= PROVIDER.name;
  // Serialised, write-then-rename, so a crash never leaves a half-written state file.
  saving = saving.then(async () => {
    const tmp = STATE_FILE + '.tmp';
    await fsp.writeFile(tmp, JSON.stringify(state, null, 2));
    await fsp.rename(tmp, STATE_FILE);
  });
  return saving;
}
const itemState = (id) => (state.items[id] ??= { variants: [], pick: null });

function select(cfg, { requireFilter = false } = {}) {
  const cats = list(flags.category);
  const only = list(flags.only);
  for (const c of cats) if (!cfg.categories[c]) die(`Unknown category "${c}". Categories: ${Object.keys(cfg.categories).join(', ')}`);
  for (const id of only) if (!cfg.items.some((i) => i.id === id)) die(`Unknown item "${id}"`);
  if (requireFilter && !cats.length && !only.length && !flags.all) die('Say what to generate: --category helmets,shoulders   --only helm-nasal   or --all');
  return cfg.items.filter((i) => (!cats.length || cats.includes(i.category)) && (!only.length || only.includes(i.id)));
}

async function confirm(credits, what) {
  const mocked = !!process.env[PROVIDER.baseEnv];
  console.log(`\n  ${what}: about ${credits} ${PROVIDER.label} credits${mocked ? ' (test server, nothing is spent)' : ''}`);
  if (mocked || flags.yes || credits === 0) return;
  if (!process.stdin.isTTY) die('Add --yes to spend credits in a non-interactive run.');
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const answer = (await rl.question('  Go ahead? [y/N] ')).trim().toLowerCase();
  rl.close();
  if (answer !== 'y' && answer !== 'yes') die('Stopped, nothing was sent.');
}

// ---------------------------------------------------------------- plan

function cmdPlan() {
  const cfg = loadConfig();
  loadState();
  const items = select(cfg);
  let preview = 0, finish = 0, problems = 0;
  const byCat = {};
  for (const item of items) {
    const s = settings(cfg, item), e = estimate(s);
    preview += VARIANTS * e.preview;
    finish += e.finish;
    (byCat[item.category] ??= []).push({ item, s });
  }
  console.log(`\nKontorRPG model batch — ${PROVIDER.label}, ${items.length} items, ${VARIANTS} preview variant(s) each\n`);
  for (const [cat, rows] of Object.entries(byCat)) {
    const c = cfg.categories[cat];
    console.log(`${cat}  (${c.polycount} tris, ${c.textureSize} px, rig: ${c.rig}${c.animations?.length ? ', anims: ' + c.animations.join('/') : ''})`);
    for (const { item, s } of rows) {
      const st = state.items[item.id];
      const where = st?.done ? 'done' : st?.pick != null ? 'picked' : st?.variants?.some((v) => v.status === 'SUCCEEDED') ? 'previewed' : 'new';
      const long = s.prompt.length > PROVIDER.maxPrompt;
      const longNeg = PROVIDER.name === 'tripo' && s.negative.length > 255;
      if (long || longNeg) problems++;
      console.log(`  ${item.id.padEnd(30)} ${String(s.prompt.length).padStart(4)} chars${long ? ' ✖ TOO LONG' : ''}${longNeg ? ' ✖ negative over 255' : ''}  ${where}`);
    }
  }
  const est = PROVIDER.cost.estimated.length ? ` (${PROVIDER.cost.estimated.join(', ')} cost is an estimate)` : '';
  console.log(`\nCredits, roughly:  previews ${preview}  +  finishing ${finish}  =  ${preview + finish}${est}`);
  if (PROVIDER.name === 'tripo') console.log('Tripo: preview 20 (untextured, smart low-poly), texture ~10, rig 25, each animation 10 (max 5). Retries cost extra.');
  else console.log('Meshy: preview 20, texture 10, rig 5 incl. walk/run, each extra animation 3. Retries cost extra.');
  if (problems) console.log(`\n✖ ${problems} prompt(s) are over ${PROVIDER.label}'s length limit (${PROVIDER.maxPrompt} characters, negative prompt 255).`);
  if (flags.verbose) for (const item of items) { const s = settings(cfg, item); console.log(`\n${item.id}:\n${s.prompt}\nnegative: ${s.negative}`); }
  console.log('');
}

// ---------------------------------------------------------------- generate

async function cmdGenerate() {
  const cfg = loadConfig();
  loadState();
  const items = select(cfg, { requireFilter: true });
  const jobs = [];
  let credits = 0;
  for (const item of items) {
    const s = settings(cfg, item);
    if (s.prompt.length > PROVIDER.maxPrompt) die(`Prompt for "${item.id}" is ${s.prompt.length} characters; ${PROVIDER.label} allows ${PROVIDER.maxPrompt}.`);
    if (PROVIDER.name === 'tripo' && s.negative.length > 255) die(`Negative prompt for "${item.id}" is ${s.negative.length} characters; Tripo allows 255.`);
    const st = itemState(item.id);
    if (st.done && !flags.redo) continue;
    if (st.regenerate) { st.variants = []; st.pick = null; st.regenerate = false; }
    st.variants = st.variants.filter((v) => v.taskId); // drop slots that never got a task (crash mid-request)
    const usable = st.variants.filter((v) => v.status !== 'FAILED');
    for (let n = usable.length; n < VARIANTS; n++) { jobs.push({ item, s, slot: null }); credits += estimate(s).preview; }
    for (const v of st.variants) if (v.status !== 'SUCCEEDED' && v.status !== 'FAILED') jobs.push({ item, s, slot: v });
  }
  if (!jobs.length) return console.log('\nNothing to generate: every selected item already has its previews. Run "pick" next.\n');
  const fresh = jobs.filter((j) => !j.slot).length;
  await confirm(credits, `${fresh} new preview(s) for ${new Set(jobs.map((j) => j.item.id)).size} item(s)`);
  console.log('');

  await pool(jobs, CONCURRENCY, async ({ item, s, slot }) => {
    const st = itemState(item.id);
    let v = slot;
    try {
      if (!v) {
        st.variants = st.variants.filter((x) => x.status !== 'FAILED');
        st.seq = (st.seq || 0) + 1;
        v = { n: st.seq, taskId: null, status: 'PENDING' };
        st.variants.push(v);
        v.taskId = await PROVIDER.preview(s);
        await saveState();
        log(item.id, `preview ${v.n} started`);
      }
      const task = await waitTask('preview', v.taskId, item.id);
      if (task.thumb) v.thumb = rel(await download(task.thumb, path.join(WORK, 'thumbs', `${item.id}-${v.n}${imageExt(task.thumb)}`)));
      if (task.glb) v.preview = rel(await download(task.glb, path.join(WORK, 'previews', `${item.id}-${v.n}.glb`)));
      v.status = 'SUCCEEDED';
      log(item.id, `preview ${v.n} ready`);
    } catch (err) {
      if (v) { v.status = 'FAILED'; v.error = err.message; }
      log(item.id, `✖ ${err.message}`);
    }
    await saveState();
  });
  await saving;
  console.log('\nDone. Next: node models.mjs pick\n');
}

// ---------------------------------------------------------------- pick (local page)

function pickPage() {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>KontorRPG — pick models</title>
<style>
:root{--bg:#f4f1ea;--card:#fff;--ink:#22201c;--muted:#6f6a60;--line:#ddd6c8;--accent:#3e6a85;--ok:#3f5a3c;--warn:#8c4a2f}
@media (prefers-color-scheme:dark){:root{--bg:#1b1d1f;--card:#24272a;--ink:#ece7dc;--muted:#a19a8c;--line:#383c40;--accent:#7fb0cf;--ok:#9fbf8a;--warn:#e09a7a}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.45 system-ui,sans-serif}
header{position:sticky;top:0;z-index:2;background:var(--bg);border-bottom:1px solid var(--line);padding:14px 20px;display:flex;gap:16px;align-items:baseline;flex-wrap:wrap}
h1{font-size:18px;margin:0}#summary{color:var(--muted)}main{padding:8px 20px 60px;max-width:1300px;margin:auto}
h2{font-size:13px;letter-spacing:.08em;text-transform:uppercase;color:var(--muted);margin:28px 0 8px}
.item{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:12px 14px;margin:10px 0}
.top{display:flex;justify-content:space-between;gap:12px;align-items:baseline;flex-wrap:wrap}
.name{font-weight:600}.state{font-size:13px;color:var(--muted)}.state.picked{color:var(--ok)}.state.regen{color:var(--warn)}
.prompt{font-size:12.5px;color:var(--muted);margin:4px 0 10px}
.variants{display:grid;grid-template-columns:repeat(auto-fill,minmax(210px,1fr));gap:10px}
.v{border:2px solid var(--line);border-radius:8px;overflow:hidden;cursor:pointer;background:var(--bg);position:relative}
.v.on{border-color:var(--ok)}.v.on::after{content:"✓ picked";position:absolute;top:6px;right:6px;background:var(--ok);color:#fff;font-size:12px;padding:2px 7px;border-radius:5px}
.v img,.v model-viewer{display:block;width:100%;aspect-ratio:1;object-fit:contain;background:transparent;--poster-color:transparent}
.v .cap{display:flex;justify-content:space-between;padding:6px 8px;font-size:12.5px}
.v .cap button{font:inherit;font-size:12px;border:1px solid var(--line);background:var(--card);color:var(--ink);border-radius:5px;padding:1px 7px;cursor:pointer}
.v.failed{cursor:default;display:grid;place-items:center;min-height:120px;color:var(--warn);font-size:13px;padding:10px;text-align:center}
.actions{margin-top:10px;display:flex;gap:8px}.actions button{font:inherit;font-size:13px;border:1px solid var(--line);background:var(--card);color:var(--ink);border-radius:6px;padding:4px 10px;cursor:pointer}
.actions button:hover,.v .cap button:hover{border-color:var(--accent)}
.empty{color:var(--muted);padding:40px 0}
</style></head><body>
<header><h1>KontorRPG — pick models</h1><span id="summary"></span></header>
<main id="main"><p class="empty">Loading…</p></main>
<script>
const esc=s=>String(s??'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
let data;
async function load(){data=await (await fetch('/api/items')).json();render()}
async function post(url,body){await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});await load()}
function render(){
  const main=document.getElementById('main');
  if(!data.items.length){main.innerHTML='<p class="empty">No previews yet. Run <code>node models.mjs generate --category …</code> first.</p>';return}
  const picked=data.items.filter(i=>i.pick!=null).length;
  document.getElementById('summary').textContent=picked+' of '+data.items.length+' picked · click a picture to pick it, 3D to turn it around · changes save instantly · close with Ctrl+C in the terminal';
  let html='',cat='';
  for(const it of data.items){
    if(it.category!==cat){cat=it.category;html+='<h2>'+esc(cat)+'</h2>'}
    const st=it.done?'<span class="state picked">finished</span>':it.regenerate?'<span class="state regen">will regenerate on next generate</span>':it.pick!=null?'<span class="state picked">picked variant '+(it.pick+1)+'</span>':'<span class="state">not picked</span>';
    html+='<div class="item"><div class="top"><span class="name">'+esc(it.id)+'</span>'+st+'</div><div class="prompt">'+esc(it.subject)+'</div><div class="variants">';
    it.variants.forEach((v,n)=>{
      if(v.status!=='SUCCEEDED'){html+='<div class="v failed">Variant '+(n+1)+': '+esc(v.status==='FAILED'?(v.error||'failed'):'still generating')+'</div>';return}
      const key=it.id+'#'+n, media=spinning.has(key)&&v.preview
        ?'<model-viewer src="/'+esc(v.preview)+'" camera-controls auto-rotate interaction-prompt="none" shadow-intensity="0"></model-viewer>'
        :(v.thumb?'<img src="/'+esc(v.thumb)+'" alt="Variant '+(n+1)+' of '+esc(it.id)+'">':'<img alt="No picture; use 3D">');
      html+='<div class="v'+(it.pick===n?' on':'')+'" data-id="'+esc(it.id)+'" data-n="'+n+'">'+media+'<div class="cap"><span>Variant '+(n+1)+'</span><span>'
        +(v.preview?'<button data-spin="'+esc(key)+'">'+(spinning.has(key)?'Picture':'3D')+'</button> ':'')
        +'<button data-pick>'+(it.pick===n?'Unpick':'Pick')+'</button></span></div></div>';
    });
    html+='</div><div class="actions"><button data-regen="'+esc(it.id)+'">'+(it.regenerate?'Keep these instead':'None are good — regenerate')+'</button></div></div>';
  }
  main.innerHTML=html;
}
const spinning=new Set();let viewerLoaded=false;
document.addEventListener('click',e=>{
  const spin=e.target.closest('[data-spin]');
  if(spin){
    // The 3D viewer loads from a CDN only when first asked for, so the page works offline.
    if(!viewerLoaded){viewerLoaded=true;const s=document.createElement('script');s.type='module';s.src='https://cdn.jsdelivr.net/npm/@google/model-viewer@3/dist/model-viewer.min.js';document.head.appendChild(s)}
    const k=spin.dataset.spin;spinning.has(k)?spinning.delete(k):spinning.add(k);return render();
  }
  const regen=e.target.closest('[data-regen]');
  if(regen){const it=data.items.find(i=>i.id===regen.dataset.regen);return post('/api/regen',{id:it.id,on:!it.regenerate})}
  const card=e.target.closest('.v[data-id]');if(!card)return;
  if(e.target.closest('model-viewer')&&!e.target.closest('[data-pick]'))return; // dragging the 3D view
  const it=data.items.find(i=>i.id===card.dataset.id),n=Number(card.dataset.n);
  post('/api/pick',{id:it.id,index:it.pick===n?null:n});
});
load();
</script></body></html>`;
}

async function cmdPick() {
  const cfg = loadConfig();
  loadState();
  const byId = Object.fromEntries(cfg.items.map((i) => [i.id, i]));
  const order = cfg.items.map((i) => i.id);
  const readBody = (req) => new Promise((ok) => { let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => ok(b ? JSON.parse(b) : {})); });
  const types = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.glb': 'model/gltf-binary' };

  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://localhost');
      if (url.pathname === '/') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        return res.end(pickPage());
      }
      if (url.pathname === '/api/items') {
        const items = Object.entries(state.items)
          .filter(([id, st]) => byId[id] && st.variants?.length)
          .sort(([a], [b]) => order.indexOf(a) - order.indexOf(b))
          .map(([id, st]) => ({ id, category: byId[id].category, subject: byId[id].subject, ...st }));
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ items }));
      }
      if (req.method === 'POST' && (url.pathname === '/api/pick' || url.pathname === '/api/regen')) {
        const body = await readBody(req);
        const st = state.items[body.id];
        if (!st) { res.writeHead(404); return res.end(); }
        if (url.pathname === '/api/pick') {
          const n = body.index;
          const before = st.pick;
          st.pick = n === null || (Number.isInteger(n) && st.variants[n]?.status === 'SUCCEEDED') ? n : st.pick;
          if (st.pick != null) st.regenerate = false;
          if (st.pick !== before) st.done = false; // a new pick needs finishing again
        } else {
          st.regenerate = !!body.on;
          if (st.regenerate) st.pick = null;
        }
        await saveState();
        res.writeHead(204);
        return res.end();
      }
      // Static files: only thumbnails and previews inside the work folder.
      const file = path.resolve(HERE, '.' + decodeURIComponent(url.pathname));
      if (file.startsWith(WORK + path.sep) && fs.existsSync(file)) {
        res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream' });
        return fs.createReadStream(file).pipe(res);
      }
      res.writeHead(404);
      res.end();
    } catch (err) {
      res.writeHead(500);
      res.end(err.message);
    }
  });
  server.listen(PORT, '127.0.0.1', () => {
    console.log(`\nPick page: http://localhost:${PORT}\nClick the best variant for each item; it saves as you go. Press Ctrl+C here when done, then run: node models.mjs finish\n`);
  });
}

// ---------------------------------------------------------------- finish

function compress(input, output, textureSize) {
  const cli = path.join(HERE, 'node_modules', '@gltf-transform', 'cli', 'bin', 'cli.js');
  if (!fs.existsSync(cli)) throw new Error('gltf-transform is not installed. Run "npm install" in tools/model-batch first.');
  const args = [cli, 'optimize', input, output,
    '--compress', 'meshopt', '--texture-compress', 'webp', '--texture-size', String(textureSize),
    '--simplify', 'false', '--flatten', 'false', '--join', 'false', '--instance', 'false', '--palette', 'false'];
  return new Promise((ok, fail) => {
    const p = spawn(process.execPath, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let err = '';
    p.stderr.on('data', (d) => (err += d));
    p.on('close', (code) => (code === 0 ? ok(output) : fail(new Error(`gltf-transform failed: ${err.trim().split('\n').pop()}`))));
  });
}

async function cmdFinish() {
  const cfg = loadConfig();
  loadState();
  const picked = select(cfg).filter((i) => state.items[i.id]?.pick != null);
  const items = picked.filter((i) => !state.items[i.id].done || flags.redo);
  if (!picked.length) return console.log('\nNothing to finish: pick variants first with "node models.mjs pick".\n');
  if (!items.length) return console.log(`\nAll ${picked.length} picked item(s) are already finished. Add --redo to rebuild them.\n`);

  let credits = 0;
  for (const item of items) {
    const s = settings(cfg, item), st = state.items[item.id], c = PROVIDER.cost;
    if (!st.texture?.file) credits += c.texture;
    if (s.rig !== 'none' && !st.rig?.file) credits += c.rig;
    if (s.rig !== 'none' && !st.anims?.file) credits += c.anim * Math.min(c.maxAnims, s.animations.length);
  }
  await confirm(credits, `Finishing ${items.length} item(s)`);
  console.log('');

  await pool(items, CONCURRENCY, async (item) => {
    const s = settings(cfg, item);
    const st = state.items[item.id];
    const pickTask = st.variants[st.pick].taskId;
    try {
      // 1. Texture the picked preview.
      if (st.texture?.from !== pickTask) {
        st.texture = { from: pickTask }; // a different variant was picked: everything built on the old one is stale
        delete st.rig;
        delete st.anims;
      }
      if (!st.texture.file) {
        st.texture.taskId ??= await PROVIDER.texture(pickTask);
        await saveState();
        log(item.id, 'texturing');
        const task = await waitTask('texture', st.texture.taskId, item.id);
        if (!task.glb) throw new Error('textured model has no .glb link');
        st.texture.file = rel(await download(task.glb, path.join(WORK, 'textured', `${item.id}.glb`)));
        await saveState();
      }
      let main = path.join(HERE, st.texture.file);
      let extras = [];

      // 2. Rig and animate bodies, creatures and mounts.
      if (s.rig !== 'none') {
        st.rig ??= {};
        const rigged = st.rig.file ? true : await PROVIDER.rig(st, s, item);
        await saveState();
        if (rigged) {
          main = path.join(HERE, st.rig.file);
          const anim = await PROVIDER.animate(st, s, item, cfg);
          if (anim?.main) main = anim.main;
          extras = anim?.extras || [];
        }
      }

      // 3. Compress into out/<category>/.
      const outDir = path.join(OUT, item.category);
      await fsp.mkdir(outDir, { recursive: true });
      const size = s.textureSize || 1024;
      const outputs = [await compress(main, path.join(outDir, `${item.id}.glb`), size)];
      for (const x of extras) outputs.push(await compress(x.file, path.join(outDir, `${item.id}@${x.name}.glb`), size));
      st.outputs = outputs.map(rel);
      st.done = true;
      delete st.error;
      const kb = Math.round(fs.statSync(outputs[0]).size / 1024);
      log(item.id, `✓ ${rel(outputs[0])} (${kb} KB)${extras.length ? ` + ${extras.length} animation file(s)` : ''}`);
    } catch (err) {
      st.error = err.message;
      log(item.id, `✖ ${err.message}`);
    }
    await saveState();
  });
  await saving;
  const failed = items.filter((i) => state.items[i.id].error).length;
  console.log(failed ? `\n${failed} item(s) failed; run "finish" again to retry them.\n` : `\nAll done. Models are in ${rel(OUT)}/\n`);
}

// ---------------------------------------------------------------- status, balance, help

function cmdStatus() {
  const cfg = loadConfig();
  loadState();
  const counts = { new: 0, previewing: 0, previewed: 0, picked: 0, done: 0, failed: 0 };
  console.log('');
  for (const item of select(cfg)) {
    const st = state.items[item.id];
    let where = 'new';
    if (st?.done) where = 'done';
    else if (st?.error) where = 'failed';
    else if (st?.pick != null) where = 'picked';
    else if (st?.variants?.some((v) => v.status === 'SUCCEEDED')) where = 'previewed';
    else if (st?.variants?.length && st.variants.every((v) => v.status === 'FAILED')) where = 'failed';
    else if (st?.variants?.length) where = 'previewing';
    counts[where]++;
    const why = st?.error || (where === 'failed' && st?.variants?.[0]?.error) || '';
    if (where !== 'new' || flags.all) console.log(`  ${item.id.padEnd(30)} ${where}${why ? ` — ${why}` : ''}`);
  }
  console.log('\n  ' + Object.entries(counts).map(([k, v]) => `${k} ${v}`).join(' · ') + '\n');
}

async function cmdBalance() {
  console.log(`\n${PROVIDER.label} credits left: ${await PROVIDER.balance()}\n`);
}

function help() {
  console.log(`
KontorRPG model batch (provider: ${PROVIDER.label})

  node models.mjs plan      [--category c1,c2] [--only id] [--verbose]   prompts + credit estimate, free
  node models.mjs generate  --category c1,c2 | --only id1,id2 | --all    untextured previews
  node models.mjs pick      [--port 5179]                                pick the best variant in your browser
  node models.mjs finish    [--category ...] [--only ...]                texture, rig, animate, compress → out/
  node models.mjs status    [--all]                                      where each item is
  node models.mjs balance                                                credits left

Options: --variants 2  --concurrency 2  --yes (skip the credit question)  --redo (rebuild finished items)
         --provider tripo|meshy  --prompts file  --state file  --out dir

Categories: races, helmets, shoulders, weapons, enemies, bosses, mounts, npcs, weapon-fish
`);
}

const commands = { plan: cmdPlan, generate: cmdGenerate, pick: cmdPick, finish: cmdFinish, status: cmdStatus, balance: cmdBalance, help };
if (!commands[command]) die(`Unknown command "${command}". Run: node models.mjs help`);
Promise.resolve(commands[command]()).catch((err) => die(err.message));
