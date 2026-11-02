'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// public/app.js 是浏览器脚本（无构建步骤）。这里按标记截出纯解析函数，在 Node 里直接跑。
function loadParse() {
  const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');
  const normStart = src.indexOf('function normalizeEntry');
  const parseStart = src.indexOf('/* ---------- 词表：解析 ---------- */');
  const parseEnd = src.indexOf('/* ---------- 提示词');
  const normEnd = src.indexOf('/* ---------- 词表：解析 ---------- */');
  assert.ok(normStart >= 0 && parseStart > normStart && parseEnd > parseStart, 'source markers');
  const code = src.slice(normStart, normEnd) + src.slice(parseStart, parseEnd);
  const MODES = { zh2en: 1, en2en: 1, en2zh: 1, zh_dictation: 1, pinyin2hanzi: 1 };
  return new Function('MODES', code + '\nreturn { parseList, htmlToLines };')(MODES);
}

const { parseList, htmlToLines } = loadParse();

const OCR_TABLE_ZH = `<div style="text-align: center;">六年级下册 词语表</div>



<table border=1 style='margin: auto; word-wrap: break-word;'><tr><td style='text-align: center; word-wrap: break-word;'>1. 豌豆</td><td style='text-align: center; word-wrap: break-word;'>wān dòu</td></tr><tr><td style='text-align: center; word-wrap: break-word;'>2. 僵硬</td><td style='text-align: center; word-wrap: break-word;'>jiāng yìng</td></tr><tr><td style='text-align: center; word-wrap: break-word;'>3. 蚊子</td><td style='text-align: center; word-wrap: break-word;'>wén zi</td></tr></table>`;

test('PaddleOCR HTML 表格 → 正常中文词条（不再解析出 <c/"> 碎片）', () => {
  const r = parseList(OCR_TABLE_ZH);
  assert.equal(r.meta.title, '六年级下册 词语表');
  assert.equal(r.entries.length, 3);
  assert.deepEqual([r.entries[0].zh, r.entries[0].pinyin], ['豌豆', 'wān dòu']);
  assert.deepEqual([r.entries[2].zh, r.entries[2].pinyin], ['蚊子', 'wén zi']);
  for (const e of r.entries) assert.ok(!/[<>]/.test(e.en + e.zh), JSON.stringify(e));
});

test('HTML 表格的英文词表也能解析', () => {
  const html = `<table border=1 style='margin: auto;'><tr><td style='text-align: center;'>1. healthy</td><td style='text-align: center;'>健康的</td></tr><tr><td style='text-align: center;'>2. walk</td><td style='text-align: center;'>走；步行</td></tr></table>`;
  const r = parseList(html);
  assert.equal(r.entries.length, 2);
  assert.deepEqual([r.entries[0].en, r.entries[0].zh], ['healthy', '健康的']);
  assert.deepEqual([r.entries[1].en, r.entries[1].zh], ['walk', '走；步行']);
});

test('纯文本词表回归：双空格 / 制表符 / 一行一条都不受影响', () => {
  const r = parseList('apple  苹果\nlibrary  图书馆\nUnit 单词听写\n1. pear 梨');
  assert.equal(r.entries.length, 3);
  assert.deepEqual([r.entries[0].en, r.entries[0].zh], ['apple', '苹果']);
  assert.deepEqual([r.entries[2].en, r.entries[2].zh], ['pear', '梨']);
});

test('符号碎片被丢弃：全是噪声时给出明确报错', () => {
  assert.throws(() => parseList('<c ">\n">\n•ㄏ\n•v'), /没有解析出词条/);
});

test('htmlToLines 保留普通文本、还原实体', () => {
  assert.equal(htmlToLines('a &amp; b'), 'a &amp; b'); // 无标签不处理
  assert.equal(htmlToLines('<div>x &amp; y</div>').trim(), 'x & y');
});
