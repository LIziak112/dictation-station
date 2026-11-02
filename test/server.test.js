'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { once } = require('node:events');

async function start(t, env = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dictation-test-'));
  fs.copyFileSync(path.join(__dirname, '..', 'server.js'), path.join(dir, 'server.js'));
  const child = spawn(process.execPath, ['server.js'], {
    cwd: dir, env: { ...process.env, PORT: '0', WRITE_TOKEN: '', ALLOW_UNSAFE_WRITES: 'false', ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  t.after(async () => {
    if (child.exitCode === null) { const exited = once(child, 'exit'); child.kill(); await exited; }
    fs.rmSync(dir, { recursive: true, force: true });
  });
  const base = await new Promise((resolve, reject) => {
    let text = '';
    const timer = setTimeout(() => reject(new Error('startup timeout')), 5000);
    child.once('error', reject);
    child.once('exit', () => { clearTimeout(timer); reject(new Error('early exit')); });
    child.stdout.on('data', d => {
      text += d;
      const m = text.match(/listening on (127\.0\.0\.1:\d+)/);
      if (m) { clearTimeout(timer); resolve(`http://${m[1]}`); }
    });
  });
  return async (route, method = 'GET', body, token, extraHeaders = {}) => fetch(base + route, {
    method, headers: { 'Content-Type': 'application/json', ...extraHeaders, ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    ...(body === undefined ? {} : { body: typeof body === 'string' ? body : JSON.stringify(body) }),
  });
}

test('unconfigured deployment fails closed but public reads work', async t => {
  const req = await start(t);
  assert.equal((await req('/api/health')).status, 200);
  assert.equal((await req('/api/batches')).status, 200);
  for (const route of ['/api/batches', '/api/ocr', '/api/ocr/url', '/api/tts']) {
    assert.equal((await req(route, 'POST', {})).status, 503, route);
  }
});

test('configured authentication protects every mutation; authorized CRUD works', async t => {
  const req = await start(t, { WRITE_TOKEN: 'synthetic-test-only' });
  for (const [route, method] of [['/api/batches', 'POST'], ['/api/batches/test1', 'PUT'],
    ['/api/batches/test1', 'DELETE'], ['/api/ocr', 'POST'], ['/api/ocr/url', 'POST'], ['/api/tts', 'POST']]) {
    assert.equal((await req(route, method, {})).status, 401, route);
    assert.equal((await req(route, method, {}, 'wrong')).status, 401, route);
  }
  let r = await req('/api/batches', 'POST', { id: 'test1', title: '合成回归', entries: [{ zh: '测试' }] }, 'synthetic-test-only');
  assert.equal(r.status, 200);
  assert.equal((await r.json()).batch.entries[0].id, 'e1');
  r = await req('/api/batches/test1', 'PUT', { title: '已修改' }, 'synthetic-test-only');
  assert.equal(r.status, 200);
  assert.equal((await r.json()).batch.title, '已修改');
  assert.equal((await req('/api/tts', 'POST', { items: [] }, 'synthetic-test-only')).status, 200);
  assert.equal((await req('/api/batches/test1', 'DELETE', undefined, 'synthetic-test-only')).status, 200);
  assert.equal((await req('/api/batches/test1')).status, 404);
});

test('malformed input returns client errors and server remains healthy', async t => {
  const req = await start(t, { WRITE_TOKEN: 'synthetic-test-only' });
  assert.equal((await req('/%E0%A4%A')).status, 400);
  assert.equal((await req('/api/batches', 'POST', '{', 'synthetic-test-only')).status, 400);
  for (const body of [null, [], {id: '__proto__'}, {id:'constructor'}, {id: {}}, {entries:[null]}, {entries:{}}]) {
    assert.equal((await req('/api/batches', 'POST', body, 'synthetic-test-only')).status, 400, JSON.stringify(body));
  }
  assert.equal((await req('/api/batches/constructor')).status, 404);
  assert.equal((await req('/api/health')).status, 200);
});

test('explicit local demonstration opt-in works', async t => {
  const req = await start(t, { ALLOW_UNSAFE_WRITES: 'true' });
  assert.equal((await req('/api/batches', 'POST', { entries: [] })).status, 200);
});

test('write rate limit cannot be bypassed by spoofing forwarded IP', async t => {
  const req = await start(t, { WRITE_TOKEN: 'synthetic-test-only', TRUST_PROXY: 'false' });
  for (let i = 0; i < 120; i++) assert.equal((await req('/api/batches', 'POST', {}, undefined, { 'X-Forwarded-For': `192.0.2.${i}`, 'X-Real-IP': `192.0.2.${i}` })).status, 401);
  assert.equal((await req('/api/batches', 'POST', {}, undefined, { 'X-Forwarded-For': '198.51.100.1' })).status, 429);
  assert.equal((await req('/api/health')).status, 200);
});
