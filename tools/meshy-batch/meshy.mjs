#!/usr/bin/env node
// KontorRPG Meshy batch pipeline.
//
//   node meshy.mjs plan      --category helmets      show prompts and credit estimate, no API calls
//   node meshy.mjs generate  --category helmets      make untextured previews (2 variants each)
//   node meshy.mjs pick                              open a local page, pick the best variant
//   node meshy.mjs finish                            texture, rig, animate, download and compress picks
//   node meshy.mjs status                            show where every item is
//   node meshy.mjs anims walk                        search Meshy's animation library
//   node meshy.mjs balance                           show remaining credits
//
// Needs MESHY_API_KEY (Meshy Pro or higher). Every step saves to state.json, so a run that
// stops halfway can simply be run again and carries on where it left off.

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
const TEST_KEY = 'msy_dummy_api_key_for_test_mode_12345678';
const MAX_PROMPT = 800;
const COST = { preview: 20, refine: 10, rig: 5, anim: 3 };

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

const BASE = (process.env.MESHY_BASE_URL || 'https://api.meshy.ai').replace(/\/$/, '');
const API_KEY = flags.test ? TEST_KEY : process.env.MESHY_API_KEY;
const PROMPTS_FILE = path.resolve(flags.prompts || path.join(HERE, 'prompts.json'));
const STATE_FILE = path.resolve(flags.state || path.join(HERE, 'state.json'));
const WORK = path.resolve(flags.work || path.join(HERE, 'work'));
const OUT = path.resolve(flags.out || path.join(HERE, 'out'));
const VARIANTS = Math.max(1, Number(flags.variants || 2));
const CONCURRENCY = Math.max(1, Number(flags.concurrency || 3));
const PORT = Number(flags.port || 5179);

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
  s.animations = item.animations ?? cat.animations ?? [];
  s.rig = s.rig || 'none';
  return s;
}

let state = { items: {}, animationIds: {} };
function loadState() {
  if (fs.existsSync(STATE_FILE)) state = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
  state.items ??= {};
  state.animationIds ??= {};
}
let saving = Promise.resolve();
function saveState() {
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
  if (requireFilter && !cats.length && !only.length && !flags.all) {
    die('Say what to generate: --category helmets,shoulders   --only helm-nasal   or --all');
  }
  return cfg.items.filter((i) => (!cats.length || cats.includes(i.category)) && (!only.length || only.includes(i.id)));
}

// ---------------------------------------------------------------- helpers

function die(msg) {
  console.error(`\n✖ ${msg}\n`);
  process.exit(1);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (id, msg) => console.log(`  ${id.padEnd(28)} ${msg}`);

async function pool(items, n, fn) {
  const queue = [...items];
  const workers = Array.from({ length: Math.min(n, queue.length) }, async () => {
    while (queue.length) await fn(queue.shift());
  });
  await Promise.all(workers);
}

async function confirm(credits, what) {
  const real = API_KEY !== TEST_KEY && !process.env.MESHY_BASE_URL;
  console.log(`\n  ${what}: about ${credits} credits${real ? '' : ' (test/mock, nothing is spent)'}`);
  if (!real || flags.yes || credits === 0) return;
  if (!process.stdin.isTTY) die('Add --yes to spend credits in a non-interactive run.');
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const answer = (await rl.question('  Go ahead? [y/N] ')).trim().toLowerCase();
  rl.close();
  if (answer !== 'y' && answer !== 'yes') die('Stopped, nothing was sent.');
}

// ---------------------------------------------------------------- Meshy API

async function api(method, route, body) {
  if (!API_KEY) die('Set MESHY_API_KEY first (or add --test to try Meshy test mode).');
  for (let attempt = 0; ; attempt++) {
    let res;
    try {
      res = await fetch(BASE + route, {
        method,
        headers: { Authorization: `Bearer ${API_KEY}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch (err) {
      if (attempt < 4) { await sleep(2000 * (attempt + 1)); continue; }
      throw new Error(`Network error on ${method} ${route}: ${err.message}`);
    }
    if (res.status === 429 || res.status >= 500) {
      if (attempt < 6) {
        const wait = Number(res.headers.get('retry-after')) || 2 ** attempt;
        await sleep(wait * 1000);
        continue;
      }
    }
    const text = await res.text();
    let data;
    try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }
    if (!res.ok) {
      const detail = data.message || data.error || data.raw || res.statusText;
      if (res.status === 401) throw new Error('Meshy rejected the API key (401). Check MESHY_API_KEY.');
      if (res.status === 402) throw new Error('Not enough credits, or the key is on the free plan (402). The API needs Meshy Pro or higher.');
      throw new Error(`Meshy ${res.status} on ${method} ${route}: ${detail}`);
    }
    return { data, retryAfter: Number(res.headers.get('retry-after')) || 0 };
  }
}

async function createTask(route, body) {
  const { data } = await api('POST', route, body);
  const id = data.result;
  if (!id) throw new Error(`No task id from POST ${route}: ${JSON.stringify(data).slice(0, 200)}`);
  return id;
}

async function waitTask(route, id, label) {
  let last = -1;
  for (;;) {
    const { data, retryAfter } = await api('GET', `${route}/${id}`);
    if (data.status === 'SUCCEEDED') return data;
    if (data.status === 'FAILED' || data.status === 'CANCELED') {
      throw new Error(`${data.status.toLowerCase()}: ${data.task_error?.message || 'no reason given'}`);
    }
    const p = data.progress ?? 0;
    if (label && p !== last && p % 25 === 0) { log(label, `${p}%`); last = p; }
    await sleep(Math.max(retryAfter, Number(process.env.MESHY_POLL_SECONDS || 4)) * 1000);
  }
}

// Meshy returns result files under different keys per task type; look in the known places.
function glbUrl(task, preferredKeys = []) {
  for (const k of preferredKeys) {
    const v = k.split('.').reduce((o, p) => o?.[p], task);
    if (typeof v === 'string' && v) return v;
  }
  if (task.model_urls?.glb) return task.model_urls.glb;
  const stack = [task];
  while (stack.length) {
    const o = stack.pop();
    for (const [k, v] of Object.entries(o || {})) {
      if (typeof v === 'string' && (k.endsWith('glb_url') || (k === 'glb' && v.startsWith('http')))) return v;
      if (v && typeof v === 'object') stack.push(v);
    }
  }
  return null;
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

const rel = (p) => path.relative(HERE, p).split(path.sep).join('/');

// ---------------------------------------------------------------- plan

function cmdPlan() {
  const cfg = loadConfig();
  loadState();
  const items = select(cfg);
  let preview = 0, finish = 0, tooLong = 0;
  const byCat = {};
  for (const item of items) {
    const s = settings(cfg, item);
    const len = s.prompt.length;
    if (len > MAX_PROMPT) tooLong++;
    const f = COST.refine + (s.rig !== 'none' ? COST.rig + COST.anim * s.animations.length : 0);
    preview += VARIANTS * COST.preview;
    finish += f;
    (byCat[item.category] ??= []).push({ item, s, len, f });
  }
  console.log(`\nKontorRPG Meshy batch — ${items.length} items, ${VARIANTS} preview variants each\n`);
  for (const [cat, rows] of Object.entries(byCat)) {
    const c = cfg.categories[cat];
    console.log(`${cat}  (${c.polycount} tris, ${c.textureSize} px, rig: ${c.rig}${c.animations?.length ? ', anims: ' + c.animations.join('/') : ''})`);
    for (const { item, s, len } of rows) {
      const st = state.items[item.id];
      const where = st?.done ? 'done' : st?.pick != null ? 'picked' : st?.variants?.some((v) => v.status === 'SUCCEEDED') ? 'previewed' : 'new';
      console.log(`  ${item.id.padEnd(30)} ${String(len).padStart(3)} chars${len > MAX_PROMPT ? ' ✖ TOO LONG' : ''}  ${where}`);
    }
  }
  console.log(`\nCredits, roughly:  previews ${preview}  +  finishing ${finish}  =  ${preview + finish}`);
  console.log('(preview 20 each, texture 10, rig 5 incl. walk/run, extra animation 3 each; retries cost extra)');
  if (tooLong) console.log(`\n✖ ${tooLong} prompt(s) are over Meshy's ${MAX_PROMPT}-character limit. Shorten the subject or the style block.`);
  if (flags.verbose) for (const item of items) console.log(`\n${item.id}:\n${settings(cfg, item).prompt}`);
  console.log('');
}

// ---------------------------------------------------------------- generate

async function cmdGenerate() {
  const cfg = loadConfig();
  loadState();
  const items = select(cfg, { requireFilter: true });
  const jobs = [];
  for (const item of items) {
    const s = settings(cfg, item);
    if (s.prompt.length > MAX_PROMPT) die(`Prompt for "${item.id}" is ${s.prompt.length} characters; Meshy allows ${MAX_PROMPT}.`);
    const st = itemState(item.id);
    if (st.done && !flags.redo) continue;
    if (st.regenerate) { st.variants = []; st.pick = null; st.regenerate = false; }
    st.variants = st.variants.filter((v) => v.taskId); // drop slots that never got a task (crash mid-request)
    const usable = st.variants.filter((v) => v.status !== 'FAILED');
    for (let n = usable.length; n < VARIANTS; n++) jobs.push({ item, s, slot: null });
    for (const v of st.variants) if (v.taskId && v.status !== 'SUCCEEDED' && v.status !== 'FAILED') jobs.push({ item, s, slot: v });
  }
  const fresh = jobs.filter((j) => !j.slot).length;
  if (!jobs.length) return console.log('\nNothing to generate: every selected item already has its previews. Run "pick" next.\n');
  await confirm(fresh * COST.preview, `${fresh} new preview(s) for ${new Set(jobs.map((j) => j.item.id)).size} item(s)`);
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
        v.taskId = await createTask('/openapi/v2/text-to-3d', {
          mode: 'preview',
          prompt: s.prompt,
          ai_model: s.aiModel || cfg.aiModel || 'meshy-6',
          should_remesh: true,
          topology: 'triangle',
          target_polycount: s.polycount,
          ...(s.pose ? { pose_mode: s.pose } : {}),
          target_formats: ['glb'],
        });
        await saveState();
        log(item.id, `preview ${v.n} started`);
      }
      const task = await waitTask('/openapi/v2/text-to-3d', v.taskId, item.id);
      const n = v.n ?? st.variants.indexOf(v) + 1;
      if (task.thumbnail_url) v.thumb = rel(await download(task.thumbnail_url, path.join(WORK, 'thumbs', `${item.id}-${n}.png`)));
      const url = glbUrl(task);
      if (url) v.preview = rel(await download(url, path.join(WORK, 'previews', `${item.id}-${n}.glb`)));
      v.status = 'SUCCEEDED';
      log(item.id, `preview ${n} ready`);
    } catch (err) {
      if (v) { v.status = 'FAILED'; v.error = err.message; }
      log(item.id, `✖ ${err.message}`);
    }
    await saveState();
  });
  await saving;
  console.log('\nDone. Next: node meshy.mjs pick\n');
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
  if(!data.items.length){main.innerHTML='<p class="empty">No previews yet. Run <code>node meshy.mjs generate --category …</code> first.</p>';return}
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
        :'<img src="/'+esc(v.thumb||'')+'" alt="Variant '+(n+1)+' of '+esc(it.id)+'">';
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
  const types = { '.png': 'image/png', '.jpg': 'image/jpeg', '.glb': 'model/gltf-binary' };

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
    console.log(`\nPick page: http://localhost:${PORT}\nClick the best variant for each item; it saves as you go. Press Ctrl+C here when done, then run: node meshy.mjs finish\n`);
  });
}

// ---------------------------------------------------------------- finish

async function resolveAnimation(cfg, entry) {
  if (typeof entry === 'number') return { name: `action${entry}`, id: entry };
  const name = typeof entry === 'string' ? entry : entry.name;
  const fixed = typeof entry === 'object' && entry.id != null ? entry.id : cfg.animationIds?.[name] ?? state.animationIds[name];
  if (fixed != null) return { name, id: Number(fixed) };
  const found = await searchLibrary(name);
  if (!found.length) throw new Error(`No animation found for "${name}". Set "animationIds": {"${name}": <id>} in prompts.json (find ids with: node meshy.mjs anims ${name}).`);
  state.animationIds[name] = found[0].id;
  console.log(`  animation "${name}" → #${found[0].id} ${found[0].name} (saved; override with "animationIds" in prompts.json)`);
  await saveState();
  return { name, id: found[0].id };
}

async function searchLibrary(term) {
  const { data } = await api('GET', `/openapi/v1/animations/library?search=${encodeURIComponent(term)}`);
  const arr = Array.isArray(data) ? data : data.result || data.data || data.items || data.animations || [];
  return (Array.isArray(arr) ? arr : [])
    .map((a) => ({ id: a.action_id ?? a.id, name: a.name ?? a.action_name ?? a.title ?? '', category: a.category ?? '' }))
    .filter((a) => a.id != null);
}

function compress(input, output, textureSize) {
  const cli = path.join(HERE, 'node_modules', '@gltf-transform', 'cli', 'bin', 'cli.js');
  if (!fs.existsSync(cli)) throw new Error('gltf-transform is not installed. Run "npm install" in tools/meshy-batch first.');
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
  if (!picked.length) return console.log('\nNothing to finish: pick variants first with "node meshy.mjs pick".\n');
  if (!items.length) return console.log(`\nAll ${picked.length} picked item(s) are already finished. Add --redo to rebuild them.\n`);

  let credits = 0;
  for (const item of items) {
    const s = settings(cfg, item), st = state.items[item.id];
    if (!st.refine?.downloaded) credits += COST.refine;
    if (s.rig !== 'none' && !st.rig?.downloaded) credits += COST.rig;
    if (s.rig !== 'none') credits += COST.anim * s.animations.filter((a) => !st.anims?.[typeof a === 'string' ? a : a.name ?? `action${a}`]?.downloaded).length;
  }
  await confirm(credits, `Finishing ${items.length} item(s)`);
  console.log('');

  await pool(items, CONCURRENCY, async (item) => {
    const s = settings(cfg, item);
    const st = state.items[item.id];
    const pickTask = st.variants[st.pick].taskId;
    const outDir = path.join(OUT, item.category);
    try {
      // 1. Texture the picked preview.
      st.refine ??= {};
      if (st.refine.from !== pickTask) {
        // A different variant was picked: everything built on the old one is stale.
        st.refine = { from: pickTask };
        delete st.rig;
        delete st.anims;
      }
      if (!st.refine.downloaded) {
        st.refine.taskId ??= await createTask('/openapi/v2/text-to-3d', {
          mode: 'refine', preview_task_id: pickTask, enable_pbr: false, remove_lighting: true, target_formats: ['glb'],
        });
        await saveState();
        log(item.id, 'texturing');
        const task = await waitTask('/openapi/v2/text-to-3d', st.refine.taskId, item.id);
        const url = glbUrl(task);
        if (!url) throw new Error('textured model has no .glb link');
        st.refine.file = rel(await download(url, path.join(WORK, 'textured', `${item.id}.glb`)));
        st.refine.downloaded = true;
        await saveState();
      }
      let main = path.join(HERE, st.refine.file);

      // 2. Rig, then the extra animations.
      const extras = [];
      if (s.rig !== 'none') {
        st.rig ??= {};
        if (!st.rig.downloaded) {
          st.rig.taskId ??= await createTask('/openapi/v1/rigging', {
            input_task_id: st.refine.taskId, height_meters: s.height || 1.7, animation_type: s.rig,
          });
          await saveState();
          log(item.id, `rigging (${s.rig})`);
          const task = await waitTask('/openapi/v1/rigging', st.rig.taskId, item.id);
          const url = glbUrl(task, ['result.rigged_character_glb_url']);
          if (!url) throw new Error('rigged model has no .glb link');
          st.rig.file = rel(await download(url, path.join(WORK, 'rigged', `${item.id}.glb`)));
          st.rig.basic = {};
          for (const [key, name] of [['walking_glb_url', 'walk'], ['running_glb_url', 'run']]) {
            const u = task.result?.basic_animations?.[key];
            if (u) st.rig.basic[name] = rel(await download(u, path.join(WORK, 'anims', `${item.id}@${name}.glb`)));
          }
          st.rig.downloaded = true;
          await saveState();
        }
        main = path.join(HERE, st.rig.file);
        for (const [name, f] of Object.entries(st.rig.basic || {})) extras.push({ name, file: path.join(HERE, f) });

        st.anims ??= {};
        for (const entry of s.animations) {
          const { name, id } = await resolveAnimation(cfg, entry);
          const a = (st.anims[name] ??= {});
          if (a.actionId !== id) Object.assign(a, { actionId: id, taskId: undefined, downloaded: false });
          if (!a.downloaded) {
            a.taskId ??= await createTask('/openapi/v1/animations', { rig_task_id: st.rig.taskId, action_id: id });
            await saveState();
            log(item.id, `animating: ${name}`);
            const task = await waitTask('/openapi/v1/animations', a.taskId, item.id);
            const url = glbUrl(task, ['result.animation_glb_url']);
            if (!url) throw new Error(`animation "${name}" has no .glb link`);
            a.file = rel(await download(url, path.join(WORK, 'anims', `${item.id}@${name}.glb`)));
            a.downloaded = true;
            await saveState();
          }
          extras.push({ name, file: path.join(HERE, a.file) });
        }
      }

      // 3. Compress into out/<category>/.
      await fsp.mkdir(outDir, { recursive: true });
      const outputs = [await compress(main, path.join(outDir, `${item.id}.glb`), s.textureSize || 1024)];
      for (const x of extras) outputs.push(await compress(x.file, path.join(outDir, `${item.id}@${x.name}.glb`), s.textureSize || 1024));
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

// ---------------------------------------------------------------- status, anims, balance, help

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

async function cmdAnims() {
  const term = positional.join(' ');
  if (!term) die('Give a search word, e.g.: node meshy.mjs anims attack');
  const found = await searchLibrary(term);
  if (!found.length) return console.log(`\nNo animations match "${term}".\n`);
  console.log('');
  for (const a of found.slice(0, 40)) console.log(`  #${String(a.id).padEnd(6)} ${a.name}${a.category ? `  (${a.category})` : ''}`);
  console.log(`\nUse one in prompts.json:  "animationIds": { "${term}": ${found[0].id} }\n`);
}

async function cmdBalance() {
  const { data } = await api('GET', '/openapi/v1/balance');
  console.log(`\nCredits left: ${data.balance ?? JSON.stringify(data)}\n`);
}

function help() {
  console.log(`
KontorRPG Meshy batch

  node meshy.mjs plan      [--category c1,c2] [--only id] [--verbose]   prompts + credit estimate, free
  node meshy.mjs generate  --category c1,c2 | --only id1,id2 | --all    untextured previews
  node meshy.mjs pick      [--port 5179]                                pick the best variant in your browser
  node meshy.mjs finish    [--category ...] [--only ...]                texture, rig, animate, compress → out/
  node meshy.mjs status    [--all]                                      where each item is
  node meshy.mjs anims <word>                                           search Meshy's animation library
  node meshy.mjs balance                                                credits left

Options: --variants 2  --concurrency 3  --yes (skip the credit prompt)  --test (Meshy test-mode key)
         --redo (rerun finished items)  --prompts file  --state file  --out dir

Categories: races, helmets, shoulders, weapons, enemies, bosses, mounts, npcs, weapon-fish
`);
}

const commands = { plan: cmdPlan, generate: cmdGenerate, pick: cmdPick, finish: cmdFinish, status: cmdStatus, anims: cmdAnims, balance: cmdBalance, help };
if (!commands[command]) die(`Unknown command "${command}". Run: node meshy.mjs help`);
Promise.resolve(commands[command]()).catch((err) => die(err.message));
