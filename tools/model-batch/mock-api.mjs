#!/usr/bin/env node
// A small stand-in for the Tripo and Meshy APIs, for trying models.mjs without a key or credits.
//
//   node mock-api.mjs                                  (terminal 1, listens on http://localhost:4010)
//
//   Tripo (terminal 2):
//     TRIPO_BASE_URL=http://localhost:4010/v3 TRIPO_API_KEY=mock node models.mjs generate --category helmets
//   Meshy (terminal 2):
//     MESHY_BASE_URL=http://localhost:4010 MESHY_API_KEY=mock node models.mjs generate --category helmets --provider meshy
//
// Every model is the same textured placeholder cube. Prompts containing "FAILME" fail, "BANME" are
// blocked by the "content filter", and "NORIG" can't be rigged. The first request that creates a
// task answers 429 once, to exercise retries.

import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { Document, NodeIO } from '@gltf-transform/core';
import sharp from 'sharp';

const PORT = Number(process.env.PORT || 4010);
const BASE = `http://localhost:${PORT}`;
const tasks = new Map();
let throttled = false;

// Placeholder assets, built once.
const art = sharp({ create: { width: 256, height: 256, channels: 3, background: { r: 138, g: 154, b: 91 } } })
  .composite([{ input: Buffer.from('<svg width="256" height="256"><rect x="40" y="40" width="176" height="176" rx="18" fill="#3e6a85"/><text x="128" y="150" font-size="44" text-anchor="middle" fill="#e6e1d3" font-family="sans-serif">MOCK</text></svg>') }]);
const png = await art.clone().png().toBuffer();
const webp = await art.clone().webp().toBuffer();
const glb = await (async () => {
  const doc = new Document();
  const buf = doc.createBuffer();
  const p = [-.5,-.5,.5, .5,-.5,.5, .5,.5,.5, -.5,.5,.5, -.5,-.5,-.5, -.5,.5,-.5, .5,.5,-.5, .5,-.5,-.5];
  const uv = [0,0, 1,0, 1,1, 0,1, 1,0, 1,1, 0,1, 0,0];
  const idx = [0,1,2, 0,2,3, 4,5,6, 4,6,7, 3,2,6, 3,6,5, 0,4,7, 0,7,1, 1,7,6, 1,6,2, 0,3,5, 0,5,4];
  const tex = doc.createTexture('base').setImage(png).setMimeType('image/png');
  const mat = doc.createMaterial('mat').setBaseColorTexture(tex).setRoughnessFactor(1).setMetallicFactor(0);
  const prim = doc.createPrimitive()
    .setAttribute('POSITION', doc.createAccessor().setType('VEC3').setArray(new Float32Array(p)).setBuffer(buf))
    .setAttribute('TEXCOORD_0', doc.createAccessor().setType('VEC2').setArray(new Float32Array(uv)).setBuffer(buf))
    .setIndices(doc.createAccessor().setType('SCALAR').setArray(new Uint16Array(idx)).setBuffer(buf))
    .setMaterial(mat);
  doc.createScene('scene').addChild(doc.createNode('mock').setMesh(doc.createMesh('mock').addPrimitive(prim)));
  return Buffer.from(await new NodeIO().writeBinary(doc));
})();

function send(res, code, obj, headers = {}) {
  res.writeHead(code, { 'Content-Type': 'application/json', ...headers });
  res.end(JSON.stringify(obj));
}
const readJson = (req) => new Promise((ok) => { let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => ok(b ? JSON.parse(b) : {})); });

// A task's prompt flags travel down the chain (preview → texture → rig → animation).
function newTask(kind, body, parentId) {
  const parent = tasks.get(parentId);
  const text = JSON.stringify(body) + (parent?.text || '');
  const id = (kind.startsWith('tripo') ? 'task_' : '') + randomUUID();
  tasks.set(id, { id, kind, body, text, polls: 0 });
  return id;
}
const phase = (t) => { t.polls++; return t.polls >= 3 ? 'done' : t.polls === 1 ? 'queued' : 'running'; };

// ---------------------------------------------------------------- Tripo v3

const TRIPO_TYPES = {
  '/v3/generation/text-to-model': 'text_to_model',
  '/v3/models/texture': 'texture_model',
  '/v3/animations/rig-check': 'animate_prerigcheck',
  '/v3/animations/rig': 'animate_rig',
  '/v3/animations/retarget': 'animate_retarget',
};

async function tripo(req, res, url) {
  if (url.pathname === '/v3/account/balance') return send(res, 200, { code: 0, data: { balance: 2000, frozen: 0 } });
  const type = TRIPO_TYPES[url.pathname];
  if (req.method === 'POST' && type) {
    if (!throttled) { throttled = true; return send(res, 429, { code: 2000, status: 'error', message: 'Too many requests' }, { 'Retry-After': '1' }); }
    const body = await readJson(req);
    const bad = (message) => send(res, 400, { code: 1004, status: 'error', message, suggestion: 'Check the request body.' });
    if (type === 'text_to_model') {
      if (!body.prompt || body.prompt.length > 1024) return bad('prompt missing or over 1024 characters');
      if (body.negative_prompt?.length > 255) return bad('negative_prompt over 255 characters');
      if (body.smart_low_poly && (body.face_limit < 500 || body.face_limit > 20000)) return bad('face_limit must be 500-20000 with smart_low_poly');
    } else if (!tasks.has(body.input)) return bad('unknown input task');
    if (type === 'animate_retarget') {
      const names = body.animations || [body.animation];
      if (names.length > 5) return bad('at most 5 animations');
      // The mock only accepts names without "preset:", answering with an error code on HTTP 200,
      // so the client's spelling fallback gets exercised.
      if (names.some((n) => n.startsWith('preset:'))) return send(res, 200, { code: 2004, status: 'error', message: 'invalid animation name' });
    }
    console.log(`tripo POST ${type}${body.animations ? ' ' + body.animations.join(',') : ''}${body.rig_type ? ' ' + body.rig_type : ''}`);
    return send(res, 200, { code: 0, data: { task_id: newTask(`tripo:${type}`, body, body.input) } });
  }
  const m = url.pathname.match(/^\/v3\/tasks\/(.+)$/);
  if (req.method === 'GET' && m && tasks.has(m[1])) {
    const t = tasks.get(m[1]);
    const p = phase(t);
    const type = t.kind.slice(6);
    let status = p === 'done' ? 'success' : p;
    if (p === 'done' && t.text.includes('FAILME')) status = 'failed';
    if (p === 'done' && t.text.includes('BANME')) status = 'banned';
    const output = status !== 'success' ? undefined
      : type === 'animate_prerigcheck' ? { riggable: !t.text.includes('NORIG'), rig_type: 'biped' }
      : { model_url: `${BASE}/files/${t.id}.glb`, rendered_image_url: `${BASE}/files/${t.id}.webp` };
    return send(res, 200, { code: 0, data: {
      task_id: t.id, type, status, progress: p === 'done' ? 100 : p === 'running' ? 50 : 0,
      error_code: status === 'failed' ? 1000 : null, error_message: status === 'failed' ? 'mock failure (prompt contained FAILME)' : null,
      output, credits_consumed: 10,
    } });
  }
  send(res, 404, { code: 1001, status: 'error', message: 'Not found' });
}

// ---------------------------------------------------------------- Meshy

const LIBRARY = [
  { action_id: 1, name: 'Idle' }, { action_id: 3, name: 'Sword Attack' }, { action_id: 4, name: 'Hit Reaction' },
  { action_id: 5, name: 'Death Fall' }, { action_id: 6, name: 'Talk Gesture' },
];

async function meshy(req, res, url) {
  const parts = url.pathname.split('/').filter(Boolean); // openapi, v2, text-to-3d, :id
  const kind = parts[2];
  if (kind === 'balance') return send(res, 200, { balance: 9999 });
  if (kind === 'animations' && parts[3] === 'library') {
    const q = (url.searchParams.get('search') || '').toLowerCase();
    return send(res, 200, { result: LIBRARY.filter((a) => a.name.toLowerCase().includes(q)) });
  }
  if (req.method === 'POST' && ['text-to-3d', 'rigging', 'animations'].includes(kind)) {
    if (!throttled) { throttled = true; return send(res, 429, { message: 'slow down' }, { 'Retry-After': '1' }); }
    const body = await readJson(req);
    const parent = body.preview_task_id || body.input_task_id || body.rig_task_id;
    if (parent && !tasks.has(parent)) return send(res, 400, { message: 'unknown parent task' });
    if (kind === 'text-to-3d' && body.mode === 'preview' && (!body.prompt || body.prompt.length > 800)) return send(res, 400, { message: 'prompt missing or over 800 characters' });
    console.log(`meshy POST ${kind}${body.mode ? ' ' + body.mode : ''}${body.action_id ? ' action ' + body.action_id : ''}`);
    return send(res, 202, { result: newTask(`meshy:${kind}`, body, parent) });
  }
  if (req.method === 'GET' && parts[3] && tasks.has(parts[3])) {
    const t = tasks.get(parts[3]);
    const p = phase(t);
    const status = p !== 'done' ? (p === 'queued' ? 'PENDING' : 'IN_PROGRESS') : t.text.includes('FAILME') ? 'FAILED' : 'SUCCEEDED';
    const base = { id: t.id, status, progress: p === 'done' ? 100 : 40, task_error: { message: status === 'FAILED' ? 'mock failure (prompt contained FAILME)' : '' } };
    if (status !== 'SUCCEEDED') return send(res, 200, base, { 'Retry-After': '1' });
    const file = `${BASE}/files/${t.id}.glb`;
    if (t.kind === 'meshy:text-to-3d') return send(res, 200, { ...base, model_urls: { glb: file }, thumbnail_url: `${BASE}/files/${t.id}.png` });
    if (t.kind === 'meshy:rigging') return send(res, 200, { ...base, result: { rigged_character_glb_url: file, basic_animations: { walking_glb_url: `${BASE}/files/${t.id}-walk.glb`, running_glb_url: `${BASE}/files/${t.id}-run.glb` } } });
    return send(res, 200, { ...base, result: { animation_glb_url: file } });
  }
  send(res, 404, { message: 'Not found' });
}

// ---------------------------------------------------------------- server

http.createServer((req, res) => {
  const url = new URL(req.url, BASE);
  if (url.pathname.startsWith('/files/')) {
    const ext = url.pathname.split('.').pop();
    res.writeHead(200, { 'Content-Type': { png: 'image/png', webp: 'image/webp' }[ext] || 'model/gltf-binary' });
    return res.end(ext === 'png' ? png : ext === 'webp' ? webp : glb);
  }
  if (!req.headers.authorization?.startsWith('Bearer ')) return send(res, 401, { code: 1002, message: 'Missing API key' });
  if (url.pathname.startsWith('/v3/')) return tripo(req, res, url).catch((e) => send(res, 500, { message: e.message }));
  if (url.pathname.startsWith('/openapi/')) return meshy(req, res, url).catch((e) => send(res, 500, { message: e.message }));
  send(res, 404, { message: 'Not found' });
}).listen(PORT, () => console.log(`Mock Tripo + Meshy API on ${BASE} (Tripo base: ${BASE}/v3)`));
