import { z } from "zod";
import { type Entry, entryErrors, normalizeEntry } from "../../contract/src/index";

const importSchema = z.object({
  version: z.literal(1).optional(),
  title: z.string().max(80).optional(),
  grade: z.string().max(40).optional(),
  unit: z.string().max(60).optional(),
  stage: z.string().max(20).optional(),
  textbook: z.string().max(60).optional(),
  entries: z.array(z.unknown()).min(1).max(500).optional(),
  words: z.array(z.unknown()).min(1).max(500).optional(),
  list: z.array(z.unknown()).min(1).max(500).optional(),
});
export function htmlToLines(text: string) {
  let s = String(text || "");
  if (!/<[a-zA-Z!/]/.test(s)) return s;
  s = s
    .replace(/<\s*br\s*\/?\s*>/gi, "\n")
    .replace(/<\s*\/\s*(p|div|tr|li|h[1-6]|table|caption)\s*>/gi, "\n")
    .replace(/<\s*(td|th)\b[^>]*>/gi, "\t")
    .replace(/<[^>]*>/g, "");
  s = s
    .replace(/&nbsp;/gi, " ")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&amp;/gi, "&");
  return s;
}

export function parseList(text: string) {
  const raw = String(text || "").trim();
  if (!raw) throw new Error("没有可解析的内容");

  const jsonText = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  if (jsonText.startsWith("{") || jsonText.startsWith("[")) {
    const value: unknown = JSON.parse(jsonText);
    const parsed = importSchema.parse(Array.isArray(value) ? { entries: value } : value);
    const entries = (
      parsed.entries ??
      parsed.words ??
      parsed.list ??
      z.array(z.unknown()).min(1).parse([])
    ).map(normalizeEntry);
    if (new Set(entries.map((e) => e.id)).size !== entries.length)
      throw new Error("词条 ID 重复，请修正 JSON 后重试");
    return {
      meta: {
        title: parsed.title,
        grade: parsed.grade,
        unit: parsed.unit,
        stage: parsed.stage,
        textbook: parsed.textbook,
      },
      entries,
    };
  }
  // 2) 逐行文本（先把 OCR 的 HTML 表格还原成文本）
  const entries: Entry[] = [];
  let title = "";
  for (const line0 of htmlToLines(raw).split("\n")) {
    let line = line0.trim();
    if (!line) continue;
    const hasSep = /\t|\s{2,}|[|｜]|[，,；;]/.test(line);
    const looksHeader =
      !hasSep &&
      /(听写|默写|单词表|词语表|生字表|姓名|班级|日期|得分|^Unit\b|^第[一二三四五六七八九十]+[单元课]|[:：]$)/i.test(
        line,
      );
    if (looksHeader) {
      if (!title && /(听写|默写|单词|词语|^Unit\b|^第)/i.test(line))
        title = line.replace(/[:：]\s*$/, "");
      continue;
    }
    if (!hasSep && /^[\s:：。.、]+$/.test(line)) continue;

    line = line
      .replace(/^[\s#>*-]*/, "")
      .replace(/^[（(]?\d+[)）.、:：]?\s*/, "")
      .trim();
    if (!line) continue;
    // 含制表符 = 表格单元格边界（OCR HTML 的 <td>/<th> 已转成制表符）：只按单元格切，
    // 不再把单元格内的「走；步行」「苹果，梨」当分隔符切开。
    const splitter = line.includes("\t") ? /\t+/ : /\t+|\s*[|｜]\s*|\s{2,}|\s*[，,；;]\s*/;
    const parts = line
      .split(splitter)
      .map((x) => x.trim())
      .filter(Boolean);
    if (!parts.length) continue;

    const hasCJK = (s2: string) => /[一-鿿]/.test(s2);
    const isLatin = (s2: string) => /^[A-Za-z][A-Za-z'’.\- ]*$/.test(s2);
    const isPinyin = (s2: string) =>
      /^[a-zA-ZüÜāáǎàēéěèīíǐìōóǒòūúǔùǖǘǚǜ\s]+$/.test(s2) && !isLatin(s2);

    let en = "",
      zh = "",
      pinyin = "";
    if (parts.length === 1) {
      const one = parts[0];
      const mZhEn = one.match(/^(.*[\u4e00-\u9fff].*?)\s+([A-Za-z][A-Za-z'’.\- ]*)$/);
      const mEnZh = one.match(/^([A-Za-z][A-Za-z'’.\- ]*?)\s+(.*[\u4e00-\u9fff].*)$/);
      const mJoin = one.match(/^(.*[\u4e00-\u9fff])([A-Za-z][A-Za-z'’.\- ]*)$/);
      const mZhPy = one.match(/^(.*[\u4e00-\u9fff].*?)\s+([a-zA-ZüÜāáǎàēéěèīíǐìōóǒòūúǔùǖǘǚǜ\s]+)$/);
      if (mZhEn) {
        zh = mZhEn[1].trim();
        en = mZhEn[2].trim();
      } else if (mEnZh) {
        en = mEnZh[1].trim();
        zh = mEnZh[2].trim();
      } else if (mJoin) {
        zh = mJoin[1].trim();
        en = mJoin[2].trim();
      } else if (mZhPy) {
        zh = mZhPy[1].trim();
        pinyin = mZhPy[2].trim();
      } else if (hasCJK(one)) zh = one;
      else en = one;
    } else if (parts.length === 2) {
      const [a, b] = parts;
      if (isLatin(a) && hasCJK(b)) {
        en = a;
        zh = b;
      } else if (hasCJK(a) && isLatin(b)) {
        zh = a;
        en = b;
      } else if (hasCJK(a) && isPinyin(b)) {
        zh = a;
        pinyin = b;
      } else if (hasCJK(a) && hasCJK(b)) {
        zh = a;
      } else {
        en = a;
        zh = b;
      }
    } else {
      const [a, b] = parts;
      const rest = parts.slice(1);
      if (isLatin(a) && hasCJK(b)) {
        en = a;
        zh = b;
        pinyin = parts.slice(2).join(" ");
      } else if (hasCJK(a) && rest.every(isPinyin)) {
        zh = a;
        pinyin = rest.join(" ");
      } else if (hasCJK(a) && isPinyin(b)) {
        zh = a;
        pinyin = rest.join(" ");
      } else {
        en = a;
        zh = b;
        pinyin = parts.slice(2).join(" ");
      }
    }
    if (!en && !zh) continue;
    // 丢掉 OCR/HTML 残片（如 “<c”“">”“•ㄏ”）：中文或英文至少要有一个像样的词。
    const NOISE = /[<>{}|\\^_=~•◆■□▲△◇○●★☆※§¶]/;
    const BOPOMOFO = /[\u3100-\u312f]/;
    if (!/[\u4e00-\u9fff]|[A-Za-z]{2,}/.test(en) && !/[\u4e00-\u9fff]|[A-Za-z]{2,}/.test(zh))
      continue;
    if (NOISE.test(en) || NOISE.test(zh) || BOPOMOFO.test(en) || BOPOMOFO.test(zh)) continue;
    entries.push(normalizeEntry({ en, zh, pinyin }, entries.length));
  }
  if (!entries.length)
    throw new Error(
      "没有解析出词条：请检查「作业原文」是不是词表；如果是表格/截图，识别可能不完整，建议重拍或手动修改",
    );
  if (entries.length > 500) throw new Error("词表最多 500 词，请分批导入");
  return { meta: title ? { title } : {}, entries };
}

const POLYPHONES = new Set(
  "行长征重乐还着得地了数少好发为相间中干空觉落差曲调和会都只种分难当应朝藏血削薄给系载转奔剥喝哄吓劲卷磨宁泡喷强塞散丧刹扇折挣症轴爪扎".split(
    "",
  ),
);
const READINGS: Record<string, string> = { 勉强: "miǎn qiǎng", 长大: "zhǎng dà", 音乐: "yīn yuè" };
export function validateEntries(entries: Entry[]) {
  const issues: { id: string; level: "error" | "warn"; message: string }[] = [];
  const seen = new Set<string>();
  for (const e of entries) {
    for (const message of entryErrors(e)) issues.push({ id: e.id, level: "error", message });
    const key = e.en ? e.en.toLowerCase().replace(/\s+/g, " ") : e.zh;
    if (seen.has(key))
      issues.push({ id: e.id, level: "warn", message: "发现重复词条，请核对是否为一词多义" });
    seen.add(key);
    if (!e.en) {
      if (!e.pinyin)
        issues.push({ id: e.id, level: "warn", message: "没有拼音，看拼音写词语模式不可用" });
      if ([...e.zh].some((c) => POLYPHONES.has(c)))
        issues.push({
          id: e.id,
          level: "warn",
          message: "含多音字，请核对语境与实际朗读，不会自动修改读音",
        });
      const expected = READINGS[e.zh];
      if (expected && e.pinyin.normalize("NFC").replace(/\s/g, "") !== expected.replace(/\s/g, ""))
        issues.push({
          id: e.id,
          level: "warn",
          message: `常用词级读音为 ${expected}，请按语境核对`,
        });
    }
  }
  return issues;
}
export function buildAgentPrompt(raw: string) {
  return `请将下方原文整理成听写 JSON，只输出 JSON。格式：{"version":1,"title":"词表名称","grade":"年级","unit":"单元","textbook":"教材或来源","entries":[{"kind":"word","en":"英文或空串","zh":"中文","pinyin":"带调拼音或空串","hint":"歧义语境或空串"}]}。词表名称、年级、单元、教材或来源从原文中读取；原文没有的字段留空串，不要凭记忆编造教材信息。保持原作业顺序和词义，不添加原文没有的内容。kind 使用 character（生字）、word（词语）、phrase（短语）、sentence（句子）；短语和句子保持完整。中文提供按语境核对的带调拼音，以便查询整词真人发音，但拼音不直接控制合成语音。多音字、一词多义保留语境，不确定之处写入 hint 并提醒人工核对，不猜测。不提供任意音频 URL。若使用 MCP，只建草稿并返回核对链接，不自动发布，不修改学习状态。\n原文：\n${raw}`;
}
