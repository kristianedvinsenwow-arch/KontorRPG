#!/usr/bin/env node
// A small stand-in for Meshy's API, for trying meshy.mjs without an API key or credits.
//
//   node mock-meshy.mjs                     (terminal 1, listens on http://localhost:4010)
//   MESHY_BASE_URL=http://localhost:4010 MESHY_API_KEY=mock node meshy.mjs generate --category helmets
//
// Every model it returns is the same textured placeholder cube. Prompts containing "FAILME"
// fail, so you can see how errors are reported. The first POST answers 429 once to exercise retries.

import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { Document, NodeIO } from '@gltf-transform/core';
import sharp from 'sharp';

const PORT = Number(process.env.PORT || 4010);
const BASE = `http://localhost:${PORT}`;
const tasks = new Map();
let throttled = false;

// Placeholder assets, built once.
const png = await sharp({ create: { width: 256, height: 256, channels: 3, background: { r: 138, g: 154, b: 91 } } })
  .composite([{ input: Buffer.from('<svg width="256" height="256"><rect x="40" y="40" width="176" height="176" rx="18" fill="#3e6a85"/><text x="128" y="150" font-size="44" text-anchor="middle" fill="#e6e1d3" font-family="sans-serif">MOCK</text></svg>') }])
  .png().toBuffer();
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
  const node = doc.createNode('mock').setMesh(doc.createMesh('mock').addPrimitive(prim));
  doc.createScene('scene').addChild(node);
  return Buffer.from(await new NodeIO().writeBinary(doc));
})();

const LIBRARY = [
  { action_id: 1, name: 'Idle', category: 'DailyActions' },
  { action_id: 2, name: 'Walk Forward', category: 'WalkAndRun' },
  { action_id: 3, name: 'Sword Attack', category: 'Fighting' },
  { action_id: 4, name: 'Hit Reaction', category: 'Fighting' },
  { action_id: 5, name: 'Death Fall', category: 'Fighting' },
  { action_id: 6, name: 'Talk Gesture', category: 'DailyActions' },
];

function newTask(kind, body) {
  const id = randomUUID();
  const fail = JSON.stringify(body).includes('FAILME');
  tasks.set(id, { id, kind, body, polls: 0, fail });
  return id;
}

function view(t) {
  t.polls++;
  const done = t.polls >= 3;
  const status = !done ? (t.polls === 1 ? 'PENDING' : 'IN_PROGRESS') : t.fail ? 'FAILED' : 'SUCCEEDED';
  const base = { id: t.id, status, progress: done ? 100 : t.polls * 40, task_error: t.fail && done ? { message: 'mock failure (prompt contained FAILME)' } : { message: '' } };
  if (status !== 'SUCCEEDED') return base;
  const file = `${BASE}/files/${t.id}.glb`;
  if (t.kind === 'text-to-3d') return { ...base, model_urls: { glb: file }, thumbnail_url: `${BASE}/files/${t.id}.png`, consumed_credits: t.body.mode === 'refine' ? 10 : 20 };
  if (t.kind === 'rigging') return { ...base, result: { rigged_character_glb_url: file, basic_animations: { walking_glb_url: `${BASE}/files/${t.id}-walk.glb`, running_glb_url: `${BASE}/files/${t.id}-run.glb` } } };
  if (t.kind === 'animations') return { ...base, result: { animation_glb_url: file } };
  return base;
}

function send(res, code, obj, headers = {}) {
  res.writeHead(code, { 'Content-Type': 'application/json', ...headers });
  res.end(JSON.stringify(obj));
}

http.createServer((req, res) => {
  const url = new URL(req.url, BASE);
  const parts = url.pathname.split('/').filter(Boolean); // openapi, v2, text-to-3d, :id
  if (parts[0] === 'files') {
    const isPng = url.pathname.endsWith('.png');
    res.writeHead(200, { 'Content-Type': isPng ? 'image/png' : 'model/gltf-binary' });
    return res.end(isPng ? png : glb);
  }
  if (!req.headers.authorization?.startsWith('Bearer ')) return send(res, 401, { message: 'Missing API key' });
  if (parts[0] !== 'openapi') return send(res, 404, { message: 'Not found' });
  const kind = parts[2];

  if (kind === 'balance') return send(res, 200, { balance: 9999 });
  if (kind === 'animations' && parts[3] === 'library') {
    const q = (url.searchParams.get('search') || '').toLowerCase();
    return send(res, 200, { result: LIBRARY.filter((a) => a.name.toLowerCase().includes(q)) });
  }

  if (req.method === 'POST' && ['text-to-3d', 'rigging', 'animations'].includes(kind)) {
    if (!throttled) { throttled = true; return send(res, 429, { message: 'slow down' }, { 'Retry-After': '1' }); }
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      const body = JSON.parse(raw || '{}');
      if (kind === 'text-to-3d' && body.mode === 'preview' && (!body.prompt || body.prompt.length > 800)) return send(res, 400, { message: 'prompt missing or over 800 characters' });
      if (kind === 'text-to-3d' && body.mode === 'refine' && !tasks.has(body.preview_task_id)) return send(res, 400, { message: 'unknown preview_task_id' });
      if (kind === 'rigging' && !tasks.has(body.input_task_id)) return send(res, 400, { message: 'unknown input_task_id' });
      if (kind === 'animations' && !tasks.has(body.rig_task_id)) return send(res, 400, { message: 'unknown rig_task_id' });
      console.log(`POST ${kind}${body.mode ? ' ' + body.mode : ''}${body.action_id ? ' action ' + body.action_id : ''}`);
      send(res, 202, { result: newTask(kind, body) });
    });
    return;
  }
  if (req.method === 'GET' && parts[3] && tasks.has(parts[3])) return send(res, 200, view(tasks.get(parts[3])), { 'Retry-After': '1' });
  send(res, 404, { message: 'Not found' });
}).listen(PORT, () => console.log(`Mock Meshy API on ${BASE}`));
