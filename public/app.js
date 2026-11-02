'use strict';

/* =========================================================
   听写小站 · 前端
   ========================================================= */

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
const app = $('#app');
const topbarTitle = $('#topbar-title');
const topbarSub = $('#topbar-sub');
const btnBack = $('#btn-back');

const MODES = {
  zh2en:        { label: '读汉语写英语', desc: '看中文提示，写英文', show: 'zh',   answer: 'en', audio: 'zh' },
  en2en:        { label: '读英语写英语', desc: '听英文发音，写单词', show: null,   answer: 'en', audio: 'en' },
  en2zh:        { label: '读英语写汉语', desc: '看/听英文，写中文', show: 'en',   answer: 'zh', audio: 'en' },
  zh_dictation: { label: '语文听写',     desc: '听读音，写生字词',   show: null,   answer: 'zh', audio: 'zh' },
  pinyin2hanzi: { label: '看拼音写词语', desc: '看拼音，写汉字',     show: 'pinyin', answer: 'zh', audio: null },
};

const POLYPHONES = new Set('行长征重乐还着得地了数少好发为相间中干空觉落差曲调和会都只种分难当应朝藏血削薄给系载转奔剥喝哄吓劲卷磨宁泡喷强塞散丧刹扇折挣症轴爪扎塞'.split(''));

// 小型、可审阅的词级读音表：只覆盖明确词义，不替代词典或教师校验。
const WORD_PINYIN = Object.freeze({
  '勉强': 'miǎn qiǎng',
  '长大': 'zhǎng dà',
  '音乐': 'yīn yuè',
});
function pinyinKey(value) {
  return String(value).normalize('NFC').toLowerCase().replace(/[\s’'·-]+/g, '');
}

const S = {
  view: 'home',
  batches: [],
  batch: null,
  audio: new Map(),     // `${lang}|${text}` -> url
  importDraft: null,
  player: null,
};

/* ---------- 基础工具 ---------- */
function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }
function toast(msg, ms = 2200) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toast._h);
  toast._h = setTimeout(() => t.classList.remove('show'), ms);
}
async function api(path, opts = {}) {
  const write = !['GET', 'HEAD'].includes((opts.method || 'GET').toUpperCase());
  const baseHeaders = Object.assign({ 'Content-Type': 'application/json' }, opts.headers);
  let retriedAuth = false;
  for (;;) {
    const headers = Object.assign({}, baseHeaders);
    if (write) {
      const token = sessionStorage.getItem('writeToken');
      if (token) headers.Authorization = `Bearer ${token}`;
    }
    const r = await fetch(path, Object.assign({}, opts, { headers }));
    // 仅当服务端确实要求口令（401）时才询问一次；未配置口令的服务端直接放行，不打扰用户。
    if (r.status === 401 && write && !retriedAuth) {
      sessionStorage.removeItem('writeToken');
      const entered = prompt('请输入管理口令（仅当前标签页保存，不会放入分享链接）');
      if (!entered) throw new Error('已取消操作');
      sessionStorage.setItem('writeToken', entered);
      retriedAuth = true;
      continue;
    }
    if (r.status === 401) sessionStorage.removeItem('writeToken');
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || `请求失败 (${r.status})`);
    return j;
  }
}
function fmtDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return `${d.getMonth() + 1}月${d.getDate()}日 ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}
function setTop(title, sub, back) {
  topbarTitle.textContent = title;
  topbarSub.textContent = sub || '';
  btnBack.hidden = !back;
  btnBack.onclick = back || null;
}

/* ---------- 词表：归一化与校验 ---------- */
function normalizeEntry(e, i) {
  const en = String(e.en || '').trim();
  const zh = String(e.zh || '').trim();
  const pinyin = String(e.pinyin || '').trim();
  let modes = Array.isArray(e.modes) ? e.modes.filter((m) => MODES[m]) : [];
  if (!modes.length) {
    if (en && zh) modes = ['zh2en', 'en2en', 'en2zh'];
    else if (zh) modes = pinyin ? ['zh_dictation', 'pinyin2hanzi'] : ['zh_dictation'];
  }
  return {
    id: String(e.id || `e${i}`),
    en, zh, pinyin,
    hint: String(e.hint || '').trim(),
    alt: Array.isArray(e.alt) ? e.alt.map((x) => String(x).trim()).filter(Boolean) : [],
    modes,
    grade: String(e.grade || '').trim(),
    unit: String(e.unit || '').trim(),
  };
}

function validateEntries(entries) {
  const issues = [];   // {i, field, level:'error'|'warn', msg}
  const seenEn = new Map();
  const seenZh = new Map();

  entries.forEach((e, i) => {
    const isEnglish = !!e.en;
    if (!e.en && !e.zh) {
      issues.push({ i, field: 'zh', level: 'error', msg: '英文和中文都为空' });
      return;
    }
    if (e.modes.includes('zh2en') && (!e.en || !e.zh)) {
      issues.push({ i, field: 'zh', level: 'error', msg: '「读汉语写英语」需要中英文都有' });
    }
    if (e.modes.includes('en2zh') && (!e.en || !e.zh)) {
      issues.push({ i, field: 'zh', level: 'error', msg: '「读英语写汉语」需要中英文都有' });
    }
    if (!isEnglish) {
      if (!e.pinyin) issues.push({ i, field: 'pinyin', level: 'warn', msg: '没有拼音：看拼音写词语模式不可用' });
      const expected = WORD_PINYIN[e.zh];
      if (expected && (!e.pinyin || pinyinKey(e.pinyin) !== pinyinKey(expected))) {
        issues.push({ i, field: 'pinyin', level: 'warn', msg: `词级读音核对：「${e.zh}」常用读音为 ${expected}，请确认当前拼音与语境（数字声调等其他写法需人工核对）；不会自动覆盖原词表` });
      }
      const ambiguous = [...new Set([...e.zh].filter(c => POLYPHONES.has(c)))];
      if (ambiguous.length) {
        issues.push({ i, field: 'pinyin', level: 'warn', msg: `含多音字「${ambiguous.join('、')}」：请按整个词语的语境核对拼音${e.pinyin ? `（当前：${e.pinyin}）` : '并补充拼音'}，必要时补语境提示；系统不会自动判定读音` });
      }
      if (!e.hint && e.pinyin && e.pinyin.split(/\s+/).length > 1) {
        // 双字词一般无需提示，不报
      }
    }
    const enKey = e.en.toLowerCase().replace(/\s+/g, ' ');
    if (e.en) {
      if (seenEn.has(enKey)) issues.push({ i, field: 'en', level: 'warn', msg: `与第 ${seenEn.get(enKey) + 1} 条英文重复` });
      else seenEn.set(enKey, i);
    }
    if (e.zh) {
      if (seenZh.has(e.zh)) issues.push({ i, field: 'zh', level: 'warn', msg: `与第 ${seenZh.get(e.zh) + 1} 条中文重复` });
      else seenZh.set(e.zh, i);
    }
  });
  return issues;
}

/* ---------- 词表：解析 ---------- */
// OCR（PaddleOCR-VL 等）遇到表格会返回 HTML，例如
// <table border=1 style='margin: auto; word-wrap: break-word;'><tr><td style='text-align: center;'>1. 豌豆</td>...
// 直接按行/分号切分会把 style 属性切碎，解析出 “<c”“">” 这类碎片。先还原成纯文本行再解析。
function htmlToLines(text) {
  let s = String(text || '');
  if (!/<[a-zA-Z!/]/.test(s)) return s;
  s = s
    .replace(/<\s*br\s*\/?\s*>/gi, '\n')
    .replace(/<\s*\/\s*(p|div|tr|li|h[1-6]|table|caption)\s*>/gi, '\n')
    .replace(/<\s*(td|th)\b[^>]*>/gi, '\t')
    .replace(/<[^>]*>/g, '');
  s = s
    .replace(/&nbsp;/gi, ' ')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&amp;/gi, '&');
  return s;
}

function parseList(text) {
  const raw = String(text || '').trim();
  if (!raw) throw new Error('没有可解析的内容');

  // 1) JSON
  if (raw.startsWith('{') || raw.startsWith('[')) {
    let obj;
    try { obj = JSON.parse(raw); } catch (e) {
      // 容忍 ```json 包裹
      const m = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
      if (!m) throw new Error('JSON 解析失败：' + e.message);
      obj = JSON.parse(m[1]);
    }
    const arr = Array.isArray(obj) ? obj : (obj.entries || obj.words || obj.list);
    if (!Array.isArray(arr)) throw new Error('JSON 里没有 entries 数组');
    return {
      meta: Array.isArray(obj) ? {} : { title: obj.title, stage: obj.stage, grade: obj.grade, textbook: obj.textbook, subject: obj.subject, unit: obj.unit },
      entries: arr.map(normalizeEntry),
    };
  }

  // 2) 逐行文本（先把 OCR 的 HTML 表格还原成文本）
  const entries = [];
  let title = '';
  for (const line0 of htmlToLines(raw).split('\n')) {
    let line = line0.trim();
    if (!line) continue;
    const hasSep = /\t|\s{2,}|[|｜]|[，,；;]/.test(line);
    const looksHeader = !hasSep && /(听写|默写|单词表|词语表|生字表|姓名|班级|日期|得分|^Unit\b|^第[一二三四五六七八九十]+[单元课]|[:：]$)/i.test(line);
    if (looksHeader) {
      if (!title && /(听写|默写|单词|词语|^Unit\b|^第)/i.test(line)) title = line.replace(/[:：]\s*$/, '');
      continue;
    }
    if (!hasSep && /^[\s:：。.、]+$/.test(line)) continue;

    line = line.replace(/^[\s#>*\-]*/, '').replace(/^[（(]?\d+[)）.、:：]?\s*/, '').trim();
    if (!line) continue;
    // 含制表符 = 表格单元格边界（OCR HTML 的 <td>/<th> 已转成制表符）：只按单元格切，
    // 不再把单元格内的「走；步行」「苹果，梨」当分隔符切开。
    const splitter = line.includes('\t') ? /\t+/ : /\t+|\s*[|｜]\s*|\s{2,}|\s*[，,；;]\s*/;
    const parts = line.split(splitter).map((x) => x.trim()).filter(Boolean);
    if (!parts.length) continue;

    const hasCJK = (s2) => /[一-鿿]/.test(s2);
    const isLatin = (s2) => /^[A-Za-z][A-Za-z'’.\- ]*$/.test(s2);
    const isPinyin = (s2) => /^[a-zA-ZüÜāáǎàēéěèīíǐìōóǒòūúǔùǖǘǚǜ\s]+$/.test(s2) && !isLatin(s2);

    let en = '', zh = '', pinyin = '';
    if (parts.length === 1) {
      const one = parts[0];
      const mZhEn = one.match(/^(.*[\u4e00-\u9fff].*?)\s+([A-Za-z][A-Za-z'’.\- ]*)$/);
      const mEnZh = one.match(/^([A-Za-z][A-Za-z'’.\- ]*?)\s+(.*[\u4e00-\u9fff].*)$/);
      const mJoin = one.match(/^(.*[\u4e00-\u9fff])([A-Za-z][A-Za-z'’.\- ]*)$/);
      const mZhPy = one.match(/^(.*[\u4e00-\u9fff].*?)\s+([a-zA-ZüÜāáǎàēéěèīíǐìōóǒòūúǔùǖǘǚǜ\s]+)$/);
      if (mZhEn) { zh = mZhEn[1].trim(); en = mZhEn[2].trim(); }
      else if (mEnZh) { en = mEnZh[1].trim(); zh = mEnZh[2].trim(); }
      else if (mJoin) { zh = mJoin[1].trim(); en = mJoin[2].trim(); }
      else if (mZhPy) { zh = mZhPy[1].trim(); pinyin = mZhPy[2].trim(); }
      else if (hasCJK(one)) zh = one;
      else en = one;
    } else if (parts.length === 2) {
      const [a, b] = parts;
      if (isLatin(a) && hasCJK(b)) { en = a; zh = b; }
      else if (hasCJK(a) && isLatin(b)) { zh = a; en = b; }
      else if (hasCJK(a) && isPinyin(b)) { zh = a; pinyin = b; }
      else if (hasCJK(a) && hasCJK(b)) { zh = a; }
      else { en = a; zh = b; }
    } else {
      const [a, b] = parts;
      const rest = parts.slice(1);
      if (isLatin(a) && hasCJK(b)) { en = a; zh = b; pinyin = parts.slice(2).join(' '); }
      else if (hasCJK(a) && rest.every(isPinyin)) { zh = a; pinyin = rest.join(' '); }
      else if (hasCJK(a) && isPinyin(b)) { zh = a; pinyin = rest.join(' '); }
      else { en = a; zh = b; pinyin = parts.slice(2).join(' '); }
    }
    if (!en && !zh) continue;
    // 丢掉 OCR/HTML 残片（如 “<c”“">”“•ㄏ”）：中文或英文至少要有一个像样的词。
    const NOISE = /[<>{}|\\^_=~•◆■□▲△◇○●★☆※§¶]/;
    const BOPOMOFO = /[\u3100-\u312f]/;
    if (!/[\u4e00-\u9fff]|[A-Za-z]{2,}/.test(en) && !/[\u4e00-\u9fff]|[A-Za-z]{2,}/.test(zh)) continue;
    if (NOISE.test(en) || NOISE.test(zh) || BOPOMOFO.test(en) || BOPOMOFO.test(zh)) continue;
    entries.push(normalizeEntry({ en, zh, pinyin }, entries.length));
  }
  if (!entries.length) throw new Error('没有解析出词条：请检查「作业原文」是不是词表；如果是表格/截图，识别可能不完整，建议重拍或手动修改');
  return { meta: title ? { title } : {}, entries };
}

/* ---------- 提示词（交给用户自己的 AI） ---------- */
function buildAgentPrompt(rawText) {
  return `你是听写词表整理助手。请把下面的作业原文整理成 JSON，只输出 JSON，不要解释。

输出格式：
{
  "title": "批次标题，如 Unit 3 单词听写",
  "subject": "english | chinese | mixed",
  "grade": "小学三年级 / 初中一年级 等，能判断就填",
  "unit": "单元，能判断就填",
  "entries": [
    {
      "en": "英文（语文词条留空字符串）",
      "zh": "中文意思 / 语文词语",
      "pinyin": "语文词条的拼音，带声调；英语留空",
      "hint": "歧义时的语境或组词提示，没有就空字符串",
      "alt": ["其他可接受的答案"],
      "modes": ["zh2en","en2en","en2zh","zh_dictation","pinyin2hanzi"]
    }
  ]
}

规则：
1. 一个英文对应多个中文意思时，拆成多条，不要合并。
2. 语文词条 modes 用 ["zh_dictation","pinyin2hanzi"]；英语词条用 ["zh2en","en2en","en2zh"]。
3. 多音字必须按课文语境给 hint（如「勉强 miǎn qiǎng」），不要只给一个读音。
4. 疑似 OCR 错字、看不清的词，在该条 hint 里写「原图不清，请确认」，不要自己编。
5. 不要添加原文里没有的词。

作业原文：
---
${rawText}
---`;
}

/* ---------- 首页 ---------- */
async function renderHome() {
  S.view = 'home';
  setTop('听写小站', '拍照导入，孩子用纸笔写，网页自动报听写', null);
  app.innerHTML = `<div class="empty muted">加载中…</div>`;
  try {
    const { batches } = await api('api/batches');
    S.batches = batches;
  } catch (e) {
    app.innerHTML = `<div class="empty"><span class="big">⚠️</span>${esc(e.message)}</div>`;
    return;
  }
  const list = S.batches.length
    ? S.batches.map((b) => `
      <div class="batch-card" data-id="${esc(b.id)}">
        <div class="meta">
          <h3>${esc(b.title)}</h3>
          <p>
            <span class="badge">${b.count} 词</span>
            ${b.grade ? `<span class="badge">${esc(b.grade)}</span>` : ''}
            <span>${esc(fmtDate(b.updatedAt))}</span>
          </p>
        </div>
        <button class="btn-ghost btn-sm" data-del="${esc(b.id)}">删除</button>
      </div>`).join('')
    : `<div class="empty"><span class="big">📝</span>还没有听写批次<br>点下面按钮，传一张作业照片开始</div>`;

  app.innerHTML = `
    <button class="btn-lg" id="new-batch">＋ 新建听写批次</button>
    <div id="sample-box"></div>
    <div class="mt"></div>
    ${list}
  `;

  $('#new-batch').onclick = () => renderImport();
  loadSamples();
  $$('.batch-card').forEach((el) => {
    el.onclick = (ev) => {
      if (ev.target.dataset.del) return;
      openBatch(el.dataset.id);
    };
  });
  $$('[data-del]').forEach((b) => {
    b.onclick = async (ev) => {
      ev.stopPropagation();
      if (!confirm('删除这个批次？词表和音频缓存不会被恢复。')) return;
      try {
        await api(`api/batches/${b.dataset.del}`, { method: 'DELETE' });
        toast('已删除');
        renderHome();
      } catch (e) { toast(e.message); }
    };
  });
}

async function openBatch(id) {
  try {
    const { batch } = await api(`api/batches/${id}`);
    S.batch = { ...batch, entries: (batch.entries || []).map(normalizeEntry) };
    renderBatch();
  } catch (e) { toast(e.message); }
}


async function loadSamples() {
  const box = $('#sample-box');
  if (!box) return;
  try {
    const r = await fetch('samples.json');
    const samples = await r.json();
    box.innerHTML = `<div class="card mt"><h2>没有照片？先用示例试试</h2>
      <p class="sub">点一下直接建批次；词表是示例，不是教材原表</p>
      <div class="row">${samples.map((x, i) => `<button class="btn-ghost" data-sample="${i}">${esc(x.title)}</button>`).join('')}</div></div>`;
    $$('#sample-box [data-sample]').forEach((b) => {
      b.onclick = async () => {
        b.disabled = true;
        try {
          const sample = samples[Number(b.dataset.sample)];
          const { batch } = await api('api/batches', { method: 'POST', body: JSON.stringify(sample) });
          S.batch = { ...batch, entries: (batch.entries || []).map(normalizeEntry) };
          toast('已创建示例批次');
          renderBatch();
        } catch (e) { toast(e.message); b.disabled = false; }
      };
    });
  } catch (_) { box.innerHTML = ''; }
}

/* ---------- 批次详情 ---------- */
function availableModes(entries) {
  const s = new Set();
  entries.forEach((e) => e.modes.forEach((m) => s.add(m)));
  return Object.keys(MODES).filter((m) => s.has(m));
}

function renderBatch() {
  const b = S.batch;
  S.view = 'batch';
  setTop(b.title, `${b.entries.length} 个词条${b.grade ? ' · ' + b.grade : ''}`, renderHome);
  const modes = availableModes(b.entries);
  const wrong = getWrong(b.id);

  app.innerHTML = `
    <div class="card">
      <h2>选择听写方式</h2>
      <p class="sub">同一份词表可以换着练</p>
      <div class="row" id="mode-row">
        ${modes.map((m) => `<button class="btn-soft mode-btn" data-mode="${m}">${MODES[m].label}</button>`).join('')}
      </div>
      ${wrong.length ? `<div class="switch-row"><span>上次错了 ${wrong.length} 个词</span><button class="btn-warn btn-sm" id="retry-wrong">只练错词</button></div>` : ''}
    </div>

    <div class="card">
      <h2>词表预览</h2>
      <p class="sub">共 ${b.entries.length} 条，导入后请对照原图确认</p>
      <table class="words">
        <thead><tr><th>#</th><th>英文</th><th>中文</th><th>拼音</th><th>提示</th></tr></thead>
        <tbody>
          ${b.entries.map((e, i) => `<tr>
            <td>${i + 1}</td><td>${esc(e.en)}</td><td>${esc(e.zh)}</td>
            <td>${esc(e.pinyin)}</td><td class="small muted">${esc(e.hint)}</td>
          </tr>`).join('')}
        </tbody>
      </table>
      <div class="row mt">
        <button class="btn-soft" id="share-batch">分享链接 / 二维码</button>
        <button class="btn-ghost" id="edit-words">编辑词表</button>
        <button class="btn-ghost" id="reimport">重新导入</button>
      </div>
    </div>
  `;

  $$('.mode-btn').forEach((btn) => {
    btn.onclick = () => startPlayer(btn.dataset.mode);
  });
  $('#share-batch').onclick = () => {
    const url = new URL(location.href);
    url.search = '';
    url.hash = `batch=${encodeURIComponent(b.id)}`;
    const panel = document.createElement('div');
    panel.className = 'card';
    panel.innerHTML = `<h2>分享听写</h2><p>任何持有链接的人均可读取词表，请勿分享隐私内容。播放使用设备语音，不携带管理口令。</p><input aria-label="分享链接" readonly><div class="qr-preview"></div><button class="btn-soft">复制链接</button><button class="btn-ghost">关闭</button>`;
    panel.querySelector('input').value = url.href;
    try {
      const qr = qrcode(0, 'M');
      qr.addData(url.href); qr.make();
      panel.querySelector('.qr-preview').innerHTML = qr.createSvgTag({cellSize: 4, margin: 16});
    } catch (_) { panel.querySelector('.qr-preview').textContent = '二维码生成失败，请复制链接'; }
    const buttons = panel.querySelectorAll('button');
    buttons[0].onclick = async () => {
      try { await navigator.clipboard.writeText(url.href); toast('链接已复制'); }
      catch (_) { panel.querySelector('input').select(); toast('请手动复制选中的链接'); }
    };
    buttons[1].onclick = () => panel.remove();
    app.prepend(panel);
    panel.querySelector('input').focus();
  };
  $('#edit-words').onclick = () => renderEditor(b.entries, false);
  $('#reimport').onclick = () => renderImport();
  const rw = $('#retry-wrong');
  if (rw) rw.onclick = () => startPlayer(null, wrong);
}

/* ---------- 导入 ---------- */
function renderImport() {
  S.view = 'import';
  setTop('新建听写批次', '拍照或粘贴 → 整理词表 → 确认', () => { S.batch ? renderBatch() : renderHome(); });
  const d = S.importDraft || (S.importDraft = { raw: '', listText: '', parsed: null, issues: [] });

  app.innerHTML = `
    <div class="card">
      <h2>① 上传作业图片</h2>
      <p class="sub">可以多张，也可以直接把文字粘在下面</p>
      <input type="file" id="file-input" accept="image/*" multiple>
      <div class="row mt">
        <button class="btn-soft" id="btn-ocr">识别图片</button>
      </div>
      <label class="field mt">
        <span>作业原文（识别结果可直接修改）</span>
        <textarea id="raw-text" placeholder="例：&#10;Unit 3 单词听写&#10;1. 苹果 apple&#10;2. 图书馆 library">${esc(d.raw)}</textarea>
      </label>
    </div>

    <div class="card">
      <h2>② 交给你的 AI 整理</h2>
      <p class="sub">复制下面这段话，连同原文发给你常用的 AI（豆包 / ChatGPT / 通义都行），把它返回的 JSON 粘到第 ③ 步。不想用 AI 也可以直接手改原文。</p>
      <button class="btn-soft" id="btn-copy-prompt">复制整理提示词 + 原文</button>
    </div>

    <div class="card">
      <h2>③ 粘贴词表并预览</h2>
      <p class="sub">支持 AI 返回的 JSON，也支持「英语 + 中文」逐行文本</p>
      <textarea id="list-text" placeholder='{"entries":[{"en":"apple","zh":"苹果"}]}&#10;或&#10;apple  苹果&#10;library  图书馆'>${esc(d.listText)}</textarea>
      <div class="row mt">
        <button id="btn-parse">解析并预览</button>
      </div>
    </div>

    <div id="preview"></div>
  `;

  const rawEl = $('#raw-text');
  const listEl = $('#list-text');
  rawEl.oninput = () => { d.raw = rawEl.value; };
  listEl.oninput = () => { d.listText = listEl.value; };

  $('#btn-ocr').onclick = async () => {
    const files = Array.from($('#file-input').files || []);
    if (!files.length) { toast('先选择图片'); return; }
    const btn = $('#btn-ocr');
    btn.disabled = true;
    const texts = [];
    try {
      for (let i = 0; i < files.length; i++) {
        btn.textContent = `识别中 ${i + 1}/${files.length}…`;
        const b64 = await fileToBase64(files[i]);
        const r = await api('api/ocr', {
          method: 'POST',
          body: JSON.stringify({ image: { name: files[i].name, type: files[i].type, data: b64 } }),
        });
        texts.push(r.text);
      }
      const merged = texts.filter(Boolean).map(htmlToLines).join('\n\n').trim();
      rawEl.value = (rawEl.value ? rawEl.value + '\n\n' : '') + merged;
      d.raw = rawEl.value;
      toast('识别完成，请对照原图检查');
    } catch (e) {
      toast('识别失败：' + e.message, 4000);
    } finally {
      btn.disabled = false;
      btn.textContent = '识别图片';
    }
  };

  $('#btn-copy-prompt').onclick = async () => {
    const text = buildAgentPrompt(rawEl.value.trim());
    if (!rawEl.value.trim()) { toast('先上传图片或粘贴原文'); return; }
    try {
      await navigator.clipboard.writeText(text);
      toast('已复制，发给你的 AI 即可');
    } catch (_) {
      // 降级：弹窗选择
      const w = window.open('', '_blank');
      if (w) { w.document.write(`<pre style="white-space:pre-wrap;font-size:14px">${esc(text)}</pre>`); }
      else toast('复制失败，请手动选择原文');
    }
  };

  $('#btn-parse').onclick = () => {
    try {
      const parsed = parseList(listEl.value || rawEl.value);
      d.parsed = parsed.entries;
      d.meta = parsed.meta || {};
      d.issues = validateEntries(d.parsed);
      renderPreview();
    } catch (e) {
      toast(e.message, 3500);
    }
  };

  function renderPreview() {
    const wrap = $('#preview');
    const entries = d.parsed;
    const issues = d.issues;
    const errCount = issues.filter((x) => x.level === 'error').length;
    const warnCount = issues.filter((x) => x.level === 'warn').length;
    const issueOf = (i) => issues.filter((x) => x.i === i);

    wrap.innerHTML = `
      <div class="card">
        <h2>确认词表</h2>
        <p class="sub">
          共 ${entries.length} 条 ·
          ${errCount ? `<span class="issue">${errCount} 处需修改</span>` : '无错误'}
          ${warnCount ? ` · <span class="issue warn">${warnCount} 处提醒</span>` : ''}
        </p>
        <label class="field"><span>批次标题</span><input type="text" id="batch-title" value="${esc(d.meta.title || '')}" placeholder="例：Unit 3 单词听写"></label>
        <div class="row">
          <label class="field" style="flex:1"><span>学段/年级</span><input type="text" id="batch-grade" value="${esc(d.meta.grade || '')}" placeholder="例：小学三年级"></label>
          <label class="field" style="flex:1"><span>单元</span><input type="text" id="batch-unit" value="${esc(d.meta.unit || '')}" placeholder="例：Unit 3"></label>
        </div>
        <div class="row">
          <label class="field" style="flex:1"><span>学段</span><input id="batch-stage" value="${esc(d.meta.stage || '')}" placeholder="小学 / 初中"></label>
          <label class="field" style="flex:1"><span>教材 / 来源</span><input id="batch-textbook" value="${esc(d.meta.textbook || '')}" placeholder="自建词表或教材名称"></label>
        </div>
        <table class="words">
          <thead><tr><th>#</th><th>英文</th><th>中文</th><th>拼音</th><th>提示</th><th></th></tr></thead>
          <tbody>
            ${entries.map((e, i) => `
              <tr class="${issueOf(i).length ? 'has-issue' : ''}">
                <td>${i + 1}</td>
                <td><input type="text" data-i="${i}" data-f="en" value="${esc(e.en)}"></td>
                <td><input type="text" data-i="${i}" data-f="zh" value="${esc(e.zh)}"></td>
                <td><input type="text" data-i="${i}" data-f="pinyin" value="${esc(e.pinyin)}"></td>
                <td><input type="text" data-i="${i}" data-f="hint" value="${esc(e.hint)}"></td>
                <td><button class="btn-danger btn-sm" data-rm="${i}">删</button></td>
              </tr>
              ${issueOf(i).length ? `<tr><td></td><td colspan="5">${issueOf(i).map((x) => `<div class="issue ${x.level}">· ${esc(x.msg)}</div>`).join('')}</td></tr>` : ''}
            `).join('')}
          </tbody>
        </table>
        <div class="row mt">
          <button class="btn-ghost" id="add-row">＋ 加一条</button>
          <button class="btn-ghost" id="btn-revalidate">重新校验</button>
        </div>
        <button class="btn-lg mt" id="btn-save" ${errCount ? 'disabled' : ''}>保存这个批次</button>
        ${errCount ? '<p class="sub mt">先把红色错误改完才能保存</p>' : ''}
      </div>
    `;

    $$('#preview input[data-i]').forEach((inp) => {
      inp.oninput = () => {
        const i = Number(inp.dataset.i);
        d.parsed[i][inp.dataset.f] = inp.value;
      };
    });
    $$('#preview [data-rm]').forEach((b) => {
      b.onclick = () => {
        d.parsed.splice(Number(b.dataset.rm), 1);
        d.issues = validateEntries(d.parsed);
        renderPreview();
      };
    });
    $('#add-row').onclick = () => {
      d.parsed.push(normalizeEntry({ en: '', zh: '', pinyin: '' }, d.parsed.length));
      d.issues = validateEntries(d.parsed);
      renderPreview();
    };
    $('#btn-revalidate').onclick = () => {
      d.parsed = d.parsed.map((e, i) => normalizeEntry(e, i));
      d.issues = validateEntries(d.parsed);
      renderPreview();
    };
    $('#btn-save').onclick = () => saveBatch(d);
  }

  if (d.parsed && d.parsed.length) renderPreview();
}

async function saveBatch(d) {
  const entries = d.parsed;
  const issues = validateEntries(entries);
  if (issues.some((x) => x.level === 'error')) { toast('还有错误没改'); return; }
  const subject = entries.some((e) => e.en) && entries.some((e) => !e.en) ? 'mixed' : (entries.some((e) => e.en) ? 'english' : 'chinese');
  const payload = {
    title: ($('#batch-title') && $('#batch-title').value.trim()) || d.meta.title || '未命名听写',
    grade: ($('#batch-grade') && $('#batch-grade').value.trim()) || d.meta.grade || '',
    unit: ($('#batch-unit') && $('#batch-unit').value.trim()) || d.meta.unit || '',
    subject,
    stage: ($('#batch-stage') && $('#batch-stage').value.trim()) || d.meta.stage || '',
    textbook: ($('#batch-textbook') && $('#batch-textbook').value.trim()) || d.meta.textbook || '',
    sourceText: d.raw || '',
    entries,
  };
  try {
    const { batch } = await api('api/batches', { method: 'POST', body: JSON.stringify(payload) });
    S.batch = { ...batch, entries: (batch.entries || []).map(normalizeEntry) };
    S.importDraft = null;
    toast('已保存');
    renderBatch();
  } catch (e) { toast(e.message); }
}

/* ---------- 词表编辑 ---------- */
function renderEditor(entries, isNew) {
  S.view = 'editor';
  setTop('编辑词表', `${entries.length} 条`, () => renderBatch());
  const draft = entries.map((e, i) => normalizeEntry(e, i));

  function draw() {
    app.innerHTML = `
      <div class="card">
        <table class="words">
          <thead><tr><th>#</th><th>英文</th><th>中文</th><th>拼音</th><th>提示</th><th></th></tr></thead>
          <tbody>
            ${draft.map((e, i) => `
              <tr>
                <td>${i + 1}</td>
                <td><input type="text" data-i="${i}" data-f="en" value="${esc(e.en)}"></td>
                <td><input type="text" data-i="${i}" data-f="zh" value="${esc(e.zh)}"></td>
                <td><input type="text" data-i="${i}" data-f="pinyin" value="${esc(e.pinyin)}"></td>
                <td><input type="text" data-i="${i}" data-f="hint" value="${esc(e.hint)}"></td>
                <td><button class="btn-danger btn-sm" data-rm="${i}">删</button></td>
              </tr>`).join('')}
          </tbody>
        </table>
        <div class="row mt">
          <button class="btn-ghost" id="add-row">＋ 加一条</button>
          <button id="save-edit">保存</button>
        </div>
      </div>
    `;
    $$('#app input[data-i]').forEach((inp) => {
      inp.oninput = () => { draft[Number(inp.dataset.i)][inp.dataset.f] = inp.value; };
    });
    $$('#app [data-rm]').forEach((b) => {
      b.onclick = () => { draft.splice(Number(b.dataset.rm), 1); draw(); };
    });
    $('#add-row').onclick = () => { draft.push(normalizeEntry({}, draft.length)); draw(); };
    $('#save-edit').onclick = async () => {
      const normalized = draft.map((e, i) => normalizeEntry(e, i));
      const issues = validateEntries(normalized);
      const errs = issues.filter((x) => x.level === 'error');
      if (errs.length) { toast(`第 ${errs[0].i + 1} 条：${errs[0].msg}`); return; }
      const { batch } = await api(`api/batches/${S.batch.id}`, { method: 'PUT', body: JSON.stringify({ entries: normalized }) });
      S.batch = { ...batch, entries: (batch.entries || []).map(normalizeEntry) };
      toast('已保存');
      renderBatch();
    };
  }
  draw();
}

/* ---------- 播放器 ---------- */
function audioKey(lang, text) { return `${lang}|${text}`; }

async function ensureAudio(items) {
  const need = [];
  const seen = new Set();
  for (const it of items) {
    if (!it.lang || !it.text) continue;
    const k = audioKey(it.lang, it.text);
    if (S.audio.has(k) || seen.has(k)) continue;
    seen.add(k);
    need.push({ ...it, key: k });
  }
  if (!need.length || !sessionStorage.getItem('writeToken')) return;

  const chunkSize = 6;
  let done = 0;
  for (let i = 0; i < need.length; i += chunkSize) {
    const chunk = need.slice(i, i + chunkSize);
    const r = await api('api/tts', {
      method: 'POST',
      body: JSON.stringify({ items: chunk.map((c) => ({ text: c.text, lang: c.lang })) }),
    });
    (r.items || []).forEach((x, j) => {
      const c = chunk[j];
      if (c) S.audio.set(c.key, x.url || null);
    });
    done += chunk.length;
    if (S.player && S.player.progressEl) {
      S.player.progressEl.textContent = `准备语音 ${Math.min(done, need.length)}/${need.length}`;
    }
  }
}

let cancelPendingAudio = null;
function speakFallback(text, lang) {
  return new Promise((resolve, reject) => {
    if (!('speechSynthesis' in window)) { reject(new Error('设备不支持朗读')); return; }
    const u = new SpeechSynthesisUtterance(text);
    u.lang = lang === 'en' ? 'en-US' : 'zh-CN';
    u.rate = 0.9;
    let done = false;
    const finish = (error) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      if (cancelPendingAudio === cancel) cancelPendingAudio = null;
      if (error) reject(error); else resolve();
    };
    const cancel = () => finish();
    const timer = setTimeout(() => finish(new Error('设备朗读超时')), 30000);
    cancelPendingAudio = cancel;
    u.onend = () => finish();
    u.onerror = (e) => finish(new Error(e.error || '设备朗读失败'));
    speechSynthesis.speak(u);
  });
}

const sharedAudio = new Audio();
sharedAudio.preload = 'auto';
function cancelCurrentAudio() {
  if (cancelPendingAudio) cancelPendingAudio();
  try {
    sharedAudio.pause();
    sharedAudio.currentTime = 0;
    sharedAudio.removeAttribute('src');
    sharedAudio.load();
  } catch (_) {}
  if ('speechSynthesis' in window) speechSynthesis.cancel();
}
function playUrl(url) {
  return new Promise((resolve, reject) => {
    let done = false;
    const finish = (error) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      if (cancelPendingAudio === cancel) cancelPendingAudio = null;
      if (error) reject(error); else resolve();
    };
    const cancel = () => finish();
    cancelPendingAudio = cancel;
    const timer = setTimeout(() => finish(new Error('音频播放超时')), 30000);
    sharedAudio.onended = () => finish();
    sharedAudio.onerror = () => finish(new Error('音频加载失败'));
    sharedAudio.src = url;
    sharedAudio.play().catch(finish);
  });
}

async function startPlayer(mode, onlyIds) {
  const b = S.batch;
  let entries = b.entries;
  if (onlyIds && onlyIds.length) entries = entries.filter((e) => onlyIds.includes(e.id));
  if (!entries.length) { toast('没有可用的词条'); return; }

  if (!mode) {
    // 从错词进入：选一个这些词都支持的模式
    const ms = availableModes(entries);
    mode = ms[0];
  }

  if (!MODES[mode]) { toast('没有可用的听写模式'); return; }
  entries = entries.map((e, i) => Object.assign({}, e, { id: e.id || `idx${i}` }));
  const queue = entries.filter((e) => Array.isArray(e.modes) && e.modes.includes(mode)).map((e) => {
    const m = MODES[mode];
    let prompt = '';
    if (m.show === 'zh') prompt = e.zh;
    else if (m.show === 'en') prompt = e.en;
    else if (m.show === 'pinyin') prompt = e.pinyin;
    const audioText = m.audio === 'zh' ? e.zh : (m.audio === 'en' ? e.en : '');
    const answer = m.answer === 'en' ? e.en : e.zh;
    return { entry: e, prompt, audioText, audioLang: m.audio, answer };
  }).filter((q) => q.audioText || q.prompt || q.answer);

  if (!queue.length) { toast('这个模式下没有可用词条'); return; }

  S.view = 'player';
  setTop(MODES[mode].label, `${queue.length} 个`, () => { stopPlay(); renderBatch(); });

  S.player = {
    mode, queue, idx: 0, repeat: 2, interval: 4, auto: true, order: 'seq',
    revealed: false, results: {}, token: 0, playing: false, progressEl: null,
  };

  app.innerHTML = `
    <div class="player-wrap">
      <div class="progress-line"><i id="bar"></i></div>
      <div class="prompt-card" id="prompt-card">
        <div class="prompt-label" id="prompt-label">准备中…</div>
        <div class="prompt-main" id="prompt-main"></div>
        <div class="prompt-hint" id="prompt-hint"></div>
        <div class="prompt-answer hidden" id="prompt-answer"></div>
      </div>
      <div class="controls">
        <button class="btn-ghost" id="btn-prev">上一个</button>
        <button class="play" id="btn-play">播放</button>
        <button class="btn-ghost" id="btn-next">下一个</button>
      </div>
      <div class="card">
        <div class="settings">
          <label>重复次数<input type="number" id="set-repeat" min="1" max="5" value="2"></label>
          <label>间隔(秒)<input type="number" id="set-interval" min="1" max="30" value="4"></label>
          <label>顺序<select id="set-order"><option value="seq">按顺序</option><option value="shuffle">打乱</option></select></label>
        </div>
        <div class="switch-row">
          <span>自动播放（播完自动下一个）</span>
          <button class="switch on" id="set-auto" aria-label="自动播放"></button>
        </div>
        <div class="switch-row">
          <span>显示答案</span>
          <button class="switch" id="set-reveal" aria-label="显示答案"></button>
        </div>
      </div>
      <button class="btn-ghost btn-lg" id="btn-finish">结束并看答案</button>
      <div class="muted small mt" id="prep-status"></div>
    </div>
  `;

  const P = S.player;
  P.progressEl = $('#prep-status');

  $('#set-repeat').onchange = (e) => { P.repeat = Math.max(1, Math.min(5, Number(e.target.value) || 1)); };
  $('#set-interval').onchange = (e) => { P.interval = Math.max(1, Math.min(30, Number(e.target.value) || 4)); };
  $('#set-order').onchange = (e) => {
    P.order = e.target.value;
    stopPlay();
    if (P.order === 'shuffle') shuffleQueue();
    P.idx = 0; drawPrompt(); syncPlayButton();
  };
  $('#set-auto').onclick = (e) => { P.auto = !P.auto; e.target.classList.toggle('on', P.auto); };
  $('#set-reveal').onclick = (e) => { P.revealed = !P.revealed; e.target.classList.toggle('on', P.revealed); drawPrompt(); };

  $('#btn-play').onclick = () => { if (P.playing) stopPlay(); else playCurrent(true); };
  $('#btn-prev').onclick = () => { stopPlay(); P.idx = Math.max(0, P.idx - 1); drawPrompt(); syncPlayButton(); };
  $('#btn-next').onclick = () => { stopPlay(); P.idx = Math.min(P.queue.length - 1, P.idx + 1); drawPrompt(); };
  $('#btn-finish').onclick = () => { stopPlay(); renderResult(); };

  function shuffleQueue() {
    for (let i = P.queue.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [P.queue[i], P.queue[j]] = [P.queue[j], P.queue[i]];
    }
  }

  $('#prompt-card').onclick = () => $('#btn-play').click();

  drawPrompt();
  updateBar();

  // 听音模式在模式按钮的用户手势内开始，不等待付费语音准备。
  // 已缓存音频优先，否则直接设备朗读；无音频模式不启动空播放。
  syncPlayButton();
  if (mode === 'en2en' || mode === 'zh_dictation') playCurrent(true);

  function drawPrompt() {
    const q = P.queue[P.idx];
    if (!q) return;
    const m = MODES[P.mode];
    $('#bar').style.width = `${((P.idx + 1) / P.queue.length) * 100}%`;

    let label = '';
    if (P.mode === 'zh2en') label = '读汉语，写英语';
    else if (P.mode === 'en2en') label = '听发音，写单词';
    else if (P.mode === 'en2zh') label = '读英语，写汉语';
    else if (P.mode === 'zh_dictation') label = '听读音，写词语';
    else if (P.mode === 'pinyin2hanzi') label = '看拼音，写词语';
    $('#prompt-label').textContent = `${label} · ${P.idx + 1} / ${P.queue.length}`;

    const mainEl = $('#prompt-main');
    if (q.prompt) {
      mainEl.textContent = q.prompt;
      mainEl.classList.remove('hidden', 'icon');
      mainEl.classList.toggle('smallish', q.prompt.length > 10);
    } else {
      mainEl.textContent = '🔊';
      mainEl.classList.remove('hidden', 'smallish');
      mainEl.classList.add('icon');
    }
    const hintText = q.entry.hint ? `提示：${q.entry.hint}` : (q.prompt ? '' : '点下面的「播放」听读音');
    $('#prompt-hint').textContent = hintText;
    const ansEl = $('#prompt-answer');
    if (P.revealed) {
      ansEl.textContent = q.answer;
      ansEl.classList.remove('hidden');
    } else {
      ansEl.textContent = '';
      ansEl.classList.add('hidden');
    }
  }

  function updateBar() {
    $('#bar').style.width = `${((P.idx + 1) / P.queue.length) * 100}%`;
  }

  function syncPlayButton() {
    if (S.player !== P || S.view !== 'player') return;
    const button = $('#btn-play');
    if (!button) return;
    button.textContent = P.playing ? '播放中…（点击停止）' : '播放';
    button.setAttribute('aria-pressed', String(P.playing));
    button.disabled = !P.queue[P.idx]?.audioText;
    button.setAttribute('aria-label', P.playing ? '播放中，点击停止' : '播放');
  }

  function stopPlay() {
    P.token++;
    P.playing = false;
    cancelCurrentAudio();
    syncPlayButton();
  }

  async function playCurrent(manual) {
    if (S.player !== P || S.view !== 'player') return;
    const q = P.queue[P.idx];
    if (!q?.audioText) return;
    cancelCurrentAudio();
    const token = ++P.token;
    const active = () => token === P.token && S.player === P && S.view === 'player';
    P.playing = true;
    syncPlayButton();
    try {
      for (let r = 0; r < P.repeat; r++) {
        if (!active()) return;
        const url = S.audio.get(audioKey(q.audioLang, q.audioText));
        if (url) await playUrl(url);
        else await speakFallback(q.audioText, q.audioLang);
        if (!active()) return;
        await sleep(320);
      }
      if (P.auto && P.idx < P.queue.length - 1) {
        await sleep(P.interval * 1000);
        if (!active()) return;
        P.idx++;
        drawPrompt();
        playCurrent(false);
      } else if (P.auto) {
        toast('本批最后一个');
      }
    } catch (e) {
      if (active()) toast('无法播放，请点击播放重试：' + e.message);
    } finally {
      if (active()) { P.playing = false; syncPlayButton(); }
    }
  }
}

/* ---------- 结果页 ---------- */
function getWrong(batchId) {
  try {
    return JSON.parse(localStorage.getItem(`dictation.wrong.${batchId}`) || '[]');
  } catch (_) { return []; }
}
function setWrong(batchId, ids) {
  localStorage.setItem(`dictation.wrong.${batchId}`, JSON.stringify(ids));
}

function renderResult() {
  const P = S.player;
  const b = S.batch;
  S.view = 'result';
  setTop('对答案', `${P.queue.length} 个`, () => renderBatch());

  app.innerHTML = `
    <div class="card">
      <h2>逐个核对</h2>
      <p class="sub">对的点 ✓，错的点 ✗，错词可以只练那些</p>
      <div class="row"><button class="btn-soft" id="mark-all-ok">全部正确</button><button class="btn-warn" id="mark-all-no">全部错误</button><button class="btn-ghost" id="mark-clear">清空标记</button></div>
      <p id="mark-summary" role="status" aria-live="polite"></p>
      <div id="result-list">
        ${P.queue.map((q, i) => `
          <div class="result-row" data-i="${i}">
            <div class="q">
              <b>${esc(q.answer)}</b>
              <span>${q.prompt ? esc(q.prompt) : (q.entry.hint ? esc(q.entry.hint) : '听音题')}${q.entry.pinyin ? ' · ' + esc(q.entry.pinyin) : ''}</span>
            </div>
            <div class="mark">
              <button class="ok" data-mark="ok" data-i="${i}">✓</button>
              <button class="no" data-mark="no" data-i="${i}">✗</button>
            </div>
          </div>`).join('')}
      </div>
    </div>
    <div class="row">
      <button class="btn-ghost" id="again">再听一遍</button>
      <button class="btn-warn" id="wrong-only">只练错词</button>
    </div>
  `;

  const syncMarks = () => {
    const ids = P.queue.filter((q, i) => P.results[i] === false).map(q => q.entry.id);
    const currentIds = new Set(P.queue.map(q => q.entry.id));
    setWrong(b.id, [...new Set([...getWrong(b.id).filter(id => !currentIds.has(id)), ...ids])]);
    $$('#result-list [data-mark]').forEach(btn => {
      const value = P.results[Number(btn.dataset.i)];
      const selected = value !== undefined && value === (btn.dataset.mark === 'ok');
      btn.classList.toggle('on', selected);
      btn.setAttribute('aria-pressed', String(selected));
    });
    const marked = Object.keys(P.results).length;
    $('#mark-summary').textContent = `已核对 ${marked}/${P.queue.length}，正确 ${Object.values(P.results).filter(v => v === true).length}，错误 ${ids.length}`;
  };
  $('#mark-all-ok').onclick = () => { P.queue.forEach((q, i) => { P.results[i] = true; }); syncMarks(); };
  $('#mark-all-no').onclick = () => { P.queue.forEach((q, i) => { P.results[i] = false; }); syncMarks(); };
  $('#mark-clear').onclick = () => { P.results = {}; syncMarks(); };
  syncMarks();
  $$('#result-list [data-mark]').forEach((btn) => {
    btn.onclick = () => {
      const i = Number(btn.dataset.i);
      P.results[i] = btn.dataset.mark === 'ok';
      const row = $(`.result-row[data-i="${i}"]`);
      row.querySelectorAll('.mark button').forEach((x) => x.classList.remove('on'));
      btn.classList.add('on');
      syncMarks();
    };
  });

  $('#again').onclick = () => startPlayer(P.mode);
  $('#wrong-only').onclick = () => {
    const wrongIds = [];
    Object.entries(P.results).forEach(([i, ok]) => {
      if (!ok) wrongIds.push(P.queue[Number(i)].entry.id);
    });
    if (!wrongIds.length) { toast('还没有标记错词'); return; }
    setWrong(b.id, wrongIds);
    startPlayer(P.mode, wrongIds);
  };
}

/* ---------- 启动 ---------- */
btnBack.onclick = () => renderHome();
window.addEventListener('keydown', (e) => {
  if (S.view !== 'player' || !S.player) return;
  if (e.key === 'ArrowLeft') $('#btn-prev')?.click();
  if (e.key === 'ArrowRight') $('#btn-next')?.click();
  if (e.key === ' ') { e.preventDefault(); $('#btn-play')?.click(); }
});

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(String(fr.result).split(',')[1]);
    fr.onerror = reject;
    fr.readAsDataURL(file);
  });
}

async function openInitialView() {
  const id = new URLSearchParams(location.hash.slice(1)).get('batch');
  if (!id) return renderHome();
  if (!/^[A-Za-z0-9_-]{4,20}$/.test(id)) { toast('分享链接无效'); return renderHome(); }
  try {
    const data = await api(`api/batches/${encodeURIComponent(id)}`);
    S.batch = { ...data.batch, entries: (data.batch.entries || []).map(normalizeEntry) };
    renderBatch();
  } catch (e) { toast(`无法打开分享：${e.message}`); renderHome(); }
}
window.addEventListener('hashchange', () => { if (S.player) { S.player.token++; S.player.playing = false; } cancelCurrentAudio(); openInitialView(); });
openInitialView();
