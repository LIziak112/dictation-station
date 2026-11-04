import { type Entry, entryErrors } from "../../contract/src/index";

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
export function buildAgentPrompt(
  raw: string,
  metadata: { title: string; grade: string; unit: string; textbook: string } = {
    title: "",
    grade: "",
    unit: "",
    textbook: "",
  },
) {
  const titleHint = metadata.title.trim() || "未填写，请从原文识别（原文没有则留空串）";
  const gradeHint = metadata.grade.trim() || "未填写，请从原文识别（原文没有则留空串）";
  const unitHint = metadata.unit.trim() || "未填写，请从原文识别（原文没有则留空串）";
  const textbookHint = metadata.textbook.trim() || "未填写，请从原文识别（原文没有则留空串）";
  return [
    "请将下方【作业原文】整理成听写词表 JSON，只输出合法 JSON，不要附带额外解释。",
    "",
    "【一、词表基本信息】（请逐项写入 JSON 顶层字段；原文没有的字段留空串，不要凭记忆编造教材信息，也不要把这些信息混入 entries 词条）：",
    `- 词表名称 ("title")：${titleHint}`,
    `- 年级 ("grade")：${gradeHint}`,
    `- 单元 ("unit")：${unitHint}`,
    `- 教材或来源 ("textbook")：${textbookHint}`,
    "",
    "【二、输出 JSON 格式模板】：",
    "{",
    '  "version": 1,',
    `  "title": ${JSON.stringify(metadata.title.trim() || "词表名称")},`,
    `  "grade": ${JSON.stringify(metadata.grade.trim() || "年级")},`,
    `  "unit": ${JSON.stringify(metadata.unit.trim() || "单元")},`,
    `  "textbook": ${JSON.stringify(metadata.textbook.trim() || "教材或来源")},`,
    '  "entries": [',
    "    {",
    '      "kind": "word",',
    '      "en": "英文或空串",',
    '      "zh": "中文",',
    '      "pinyin": "带调拼音或空串",',
    '      "hint": "歧义语境或空串"',
    "    }",
    "  ]",
    "}",
    "",
    "【三、词条整理规范】：",
    "1. 保持原作业顺序和词义，不遗漏、不添加原文没有的内容。",
    "2. kind 仅限：character（生字）、word（词语）、phrase（短语）、sentence（句子）；短语和句子保持完整，不要拆散。",
    "3. 中文词条须提供按语境核对的带调拼音（如 píng guǒ），以便查询整词真人发音（拼音不直接控制合成语音）。",
    "4. 多音字、一词多义请保留语境，不确定之处写入 hint 并提醒人工核对，不猜测。",
    "5. 不提供任意外部音频 URL。若使用 MCP 工具，只调用 create_wordlist_draft 创建待确认草稿并返回核对链接，不自动发布，不修改学习状态。",
    "",
    "【四、作业原文】：",
    raw || "（在此粘贴老师布置的作业原文）",
  ].join("\n");
}
