#!/usr/bin/env node
'use strict';

/**
 * 听写小站 — 服务端
 * 零 npm 依赖（只用 Node 内置模块），部署即用。
 * 职责：
 *  1. 静态前端
 *  2. 批次词表存取（JSON 文件，原子写）
 *  3. OCR 代理（飞桨 PaddleOCR-VL / MinerU），token 只在服务端
 *  4. TTS 预生成与缓存（edge-tts，python 子进程）
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');

const ROOT = __dirname;
const PUBLIC = path.join(ROOT, 'public');
const DATA = path.join(ROOT, 'data');
const AUDIO = path.join(DATA, 'audio');
const DB_FILE = path.join(DATA, 'batches.json');
const PORT = Number(process.env.PORT || 8083);

/* ---------- .env ---------- */
function loadEnv(file) {
  try {
    const txt = fs.readFileSync(file, 'utf8');
    for (const line of txt.split('\n')) {
      const s = line.trim();
      if (!s || s.startsWith('#')) continue;
      const i = s.indexOf('=');
      if (i < 0) continue;
      const k = s.slice(0, i).trim();
      let v = s.slice(i + 1).trim();
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
      if (!(k in process.env)) process.env[k] = v;
    }
  } catch (_) { /* no .env is fine */ }
}
loadEnv(path.join(ROOT, '.env'));

const CFG = {
  paddleUrl: process.env.PADDLEOCR_URL || 'https://paddleocr.aistudio-app.com/api/v2/ocr/jobs',
  paddleToken: process.env.PADDLEOCR_TOKEN || '',
  paddleModel: process.env.PADDLEOCR_MODEL || 'PaddleOCR-VL-1.6',
  mineruUrl: process.env.MINERU_URL || 'https://mineru.net/api/v4/extract/task',
  mineruToken: process.env.MINERU_TOKEN || '',
  python: process.env.EDGE_TTS_PYTHON || 'python3',
  pythonPath: process.env.EDGE_TTS_PYTHONPATH || '',
  voiceZh: process.env.VOICE_ZH || 'zh-CN-XiaoxiaoNeural',
  voiceEn: process.env.VOICE_EN || 'en-US-AriaNeural',
};

fs.mkdirSync(AUDIO, { recursive: true });

/* ---------- 小工具 ---------- */
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.mp3': 'audio/mpeg',
  '.md': 'text/markdown; charset=utf-8',
};

function json(res, code, obj) {
  const body = Buffer.from(JSON.stringify(obj));
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': body.length,
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

function readBody(req, limit = 60 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) { reject(new Error('payload too large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

async function readJson(req, limit) {
  const buf = await readBody(req, limit);
  if (!buf.length) return {};
  return JSON.parse(buf.toString('utf8'));
}

function serveStatic(res, filePath, cache = 'no-cache') {
  fs.readFile(filePath, (err, buf) => {
    if (err) { res.writeHead(404); res.end('Not found'); return; }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream',
      'Content-Length': buf.length,
      'Cache-Control': cache,
    });
    res.end(buf);
  });
}

function newId() {
  return crypto.randomBytes(8).toString('base64url').replace(/[-_]/g, '').slice(0, 10);
}

/* ---------- 数据存取 ---------- */
const db = { batches: {} };
try {
  Object.assign(db, JSON.parse(fs.readFileSync(DB_FILE, 'utf8')));
  if (!db.batches) db.batches = {};
} catch (_) { /* first run */ }

let saveTimer = null;
function saveDb() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    const tmp = DB_FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(db, null, 2));
    fs.renameSync(tmp, DB_FILE);
  }, 120);
}

/* ---------- TTS 队列 ---------- */
const ttsQueue = [];
let ttsRunning = 0;
const TTS_CONCURRENCY = Number(process.env.TTS_CONCURRENCY || 3);

function ttsKey(text, voice, rate) {
  return crypto.createHash('sha1').update(`${voice}|${rate}|${text}`).digest('hex');
}

function fileExists(p) {
  try { return fs.statSync(p).size > 0; } catch (_) { return false; }
}

function runTts(text, voice, rate, out) {
  return new Promise((resolve, reject) => {
    const py = [
      'import asyncio,sys,edge_tts',
      'asyncio.run(edge_tts.Communicate(sys.argv[1],sys.argv[2],rate=sys.argv[3]).save(sys.argv[4]))',
    ].join('\n');
    const env = Object.assign({}, process.env);
    if (CFG.pythonPath) env.PYTHONPATH = CFG.pythonPath;
    const p = spawn(CFG.python, ['-c', py, text, voice, rate, out], { env });
    let err = '';
    const timer = setTimeout(() => { p.kill('SIGKILL'); reject(new Error('tts timeout')); }, 45000);
    p.stderr.on('data', (d) => { err += d.toString(); });
    p.on('error', (e) => { clearTimeout(timer); reject(e); });
    p.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0 && fileExists(out)) resolve();
      else reject(new Error(`tts failed(${code}): ${err.slice(-300)}`));
    });
  });
}

function enqueueTts(text, voice, rate) {
  const key = ttsKey(text, voice, rate);
  const out = path.join(AUDIO, key + '.mp3');
  if (fileExists(out)) return Promise.resolve(`audio/${key}.mp3`);
  return new Promise((resolve, reject) => {
    ttsQueue.push({ text, voice, rate, out, key, resolve, reject });
    pumpTts();
  });
}

function pumpTts() {
  while (ttsRunning < TTS_CONCURRENCY && ttsQueue.length) {
    const job = ttsQueue.shift();
    ttsRunning++;
    runTts(job.text, job.voice, job.rate, job.out)
      .then(() => job.resolve(`audio/${job.key}.mp3`))
      .catch(job.reject)
      .finally(() => { ttsRunning--; pumpTts(); });
  }
}

/* ---------- OCR ---------- */
async function paddleOcr(buffer, filename, mime) {
  if (!CFG.paddleToken) throw new Error('服务端未配置 PADDLEOCR_TOKEN');
  const form = new FormData();
  form.append('file', new Blob([buffer], { type: mime || 'image/png' }), filename || 'upload.png');
  form.append('model', CFG.paddleModel);

  const r = await fetch(CFG.paddleUrl, {
    method: 'POST',
    headers: { Authorization: `Bearer ${CFG.paddleToken}` },
    body: form,
    signal: AbortSignal.timeout(60000),
  });
  const j = await r.json();
  if (!r.ok || j.code !== 0) throw new Error(`OCR 提交失败: ${j.msg || r.status}`);
  const jobId = j.data.jobId;

  const deadline = Date.now() + 180000;
  while (Date.now() < deadline) {
    await new Promise((s) => setTimeout(s, 2000));
    const s = await fetch(`${CFG.paddleUrl}/${jobId}`, {
      headers: { Authorization: `Bearer ${CFG.paddleToken}` },
      signal: AbortSignal.timeout(30000),
    });
    const sj = await s.json();
    if (sj.code !== 0) throw new Error(`OCR 查询失败: ${sj.msg}`);
    const st = sj.data && sj.data.state;
    if (st === 'done') {
      const url = sj.data.resultUrl && sj.data.resultUrl.jsonUrl;
      if (!url) return '';
      const rr = await fetch(url, { signal: AbortSignal.timeout(30000) });
      const rj = await rr.json();
      const results = (rj.result && rj.result.layoutParsingResults) || [];
      return results.map((x) => (x.markdown && x.markdown.text) || '').join('\n\n').trim();
    }
    if (st === 'failed' || st === 'error') throw new Error('OCR 识别失败');
  }
  throw new Error('OCR 超时（3 分钟）');
}

/* ---------- 路由 ---------- */
const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://localhost');
  const p = decodeURIComponent(u.pathname);

  try {
    if (req.method === 'GET' && (p === '/' || p === '/index.html')) {
      return serveStatic(res, path.join(PUBLIC, 'index.html'));
    }
    if (req.method === 'GET' && p.startsWith('/audio/')) {
      const f = path.join(AUDIO, path.basename(p));
      return serveStatic(res, f, 'public, max-age=31536000, immutable');
    }
    if (req.method === 'GET' && (p === '/app.js' || p === '/style.css' || p === '/favicon.svg' || p === '/samples.json')) {
      return serveStatic(res, path.join(PUBLIC, path.basename(p)));
    }

    if (p === '/api/health') {
      return json(res, 200, { ok: true, ocr: !!CFG.paddleToken, mineru: !!CFG.mineruToken, zh: CFG.voiceZh, en: CFG.voiceEn, ts: Date.now() });
    }

    if (p === '/api/batches' && req.method === 'GET') {
      const list = Object.values(db.batches)
        .map((b) => ({
          id: b.id, title: b.title, subject: b.subject, grade: b.grade, unit: b.unit,
          count: (b.entries || []).length, createdAt: b.createdAt, updatedAt: b.updatedAt,
        }))
        .sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
      return json(res, 200, { batches: list });
    }

    if (p === '/api/batches' && req.method === 'POST') {
      const body = await readJson(req);
      const id = body.id || newId();
      const now = new Date().toISOString();
      const prev = db.batches[id];
      const batch = {
        id,
        title: String(body.title || '未命名听写').slice(0, 80),
        subject: body.subject || 'mixed',
        grade: String(body.grade || '').slice(0, 40),
        textbook: String(body.textbook || '').slice(0, 60),
        unit: String(body.unit || '').slice(0, 60),
        sourceText: String(body.sourceText || '').slice(0, 20000),
        entries: Array.isArray(body.entries) ? body.entries.slice(0, 500) : [],
        createdAt: prev ? prev.createdAt : now,
        updatedAt: now,
      };
      db.batches[id] = batch;
      saveDb();
      return json(res, 200, { batch });
    }

    const mBatch = p.match(/^\/api\/batches\/([A-Za-z0-9_-]{4,20})$/);
    if (mBatch) {
      const id = mBatch[1];
      const b = db.batches[id];
      if (!b) return json(res, 404, { error: '批次不存在' });
      if (req.method === 'GET') return json(res, 200, { batch: b });
      if (req.method === 'DELETE') { delete db.batches[id]; saveDb(); return json(res, 200, { ok: true }); }
      if (req.method === 'PUT') {
        const body = await readJson(req);
        Object.assign(b, {
          title: String(body.title ?? b.title).slice(0, 80),
          subject: body.subject ?? b.subject,
          grade: String(body.grade ?? b.grade).slice(0, 40),
          textbook: String(body.textbook ?? b.textbook).slice(0, 60),
          unit: String(body.unit ?? b.unit).slice(0, 60),
          entries: Array.isArray(body.entries) ? body.entries.slice(0, 500) : b.entries,
          updatedAt: new Date().toISOString(),
        });
        saveDb();
        return json(res, 200, { batch: b });
      }
    }

    if (p === '/api/tts' && req.method === 'POST') {
      const body = await readJson(req, 2 * 1024 * 1024);
      const items = Array.isArray(body.items) ? body.items.slice(0, 200) : [];
      const out = [];
      for (const it of items) {
        const text = String(it.text || '').trim();
        if (!text) { out.push({ text, url: null, error: '空文本' }); continue; }
        const voice = it.lang === 'en' ? CFG.voiceEn : CFG.voiceZh;
        const rate = String(it.rate || '+0%');
        try {
          const url = await enqueueTts(text, voice, rate);
          out.push({ text, lang: it.lang || 'zh', url });
        } catch (e) {
          out.push({ text, lang: it.lang || 'zh', url: null, error: String(e.message || e) });
        }
      }
      return json(res, 200, { items: out });
    }

    if (p === '/api/ocr' && req.method === 'POST') {
      const body = await readJson(req, 60 * 1024 * 1024);
      const img = body.image || {};
      if (!img.data) return json(res, 400, { error: '缺少图片数据' });
      const buf = Buffer.from(img.data, 'base64');
      if (buf.length > 20 * 1024 * 1024) return json(res, 400, { error: '图片过大（>20MB）' });
      const text = await paddleOcr(buf, img.name || 'upload.png', img.type);
      return json(res, 200, { text });
    }

    if (p === '/api/ocr/url' && req.method === 'POST') {
      const body = await readJson(req);
      if (!CFG.mineruToken) return json(res, 400, { error: '服务端未配置 MINERU_TOKEN' });
      const r = await fetch(CFG.mineruUrl, {
        method: 'POST',
        headers: { Authorization: `Bearer ${CFG.mineruToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: body.url, is_ocr: true, enable_formula: false, language: 'ch' }),
        signal: AbortSignal.timeout(60000),
      });
      const j = await r.json();
      if (j.code !== 0) return json(res, 400, { error: j.msg || 'MinerU 提交失败' });
      return json(res, 200, { taskId: j.data.task_id });
    }

    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Not found');
  } catch (e) {
    console.error('[error]', req.method, p, e && e.message);
    json(res, 500, { error: String((e && e.message) || e) });
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`[dictation] listening on 127.0.0.1:${PORT}`);
});
