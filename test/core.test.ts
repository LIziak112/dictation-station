import { describe, expect, it } from "vitest";
import { batchInputSchema, defaultSettings, normalizeEntry } from "../packages/contract/src/index";
import { buildAgentPrompt, parseList, validateEntries } from "../packages/core/src/import";
import { createQueue, Playback } from "../packages/core/src/player";
import samples from "../public/samples.json";

describe("词表契约与导入", () => {
  it("旧示例全部兼容，纯文本超限和重复 ID 显式报错", () => {
    for (const sample of samples) expect(batchInputSchema.safeParse(sample).success).toBe(true);
    expect(() =>
      parseList(Array.from({ length: 501 }, (_, i) => `word${i}  词语`).join("\n")),
    ).toThrow("500");
    expect(() =>
      parseList('{"entries":[{"id":"same","zh":"太阳"},{"id":"same","zh":"月亮"}]}'),
    ).toThrow("ID");
  });
  it("AI 提示词的元信息字段能与核对表单对应", () => {
    const prompt = buildAgentPrompt("Unit 3 单词听写\napple 苹果");
    for (const field of ["title", "grade", "unit", "textbook"])
      expect(prompt).toContain(`"${field}"`);
    const meta = parseList(
      '{"version":1,"title":"Unit 3 单词听写","grade":"小学三年级","unit":"Unit 3","textbook":"人教版 PEP","entries":[{"en":"apple","zh":"苹果"}]}',
    ).meta;
    expect(meta).toMatchObject({
      title: "Unit 3 单词听写",
      grade: "小学三年级",
      unit: "Unit 3",
      textbook: "人教版 PEP",
    });
  });
  it("保留 OCR 表格单元格内的分号并解析拼音", () => {
    const result = parseList(
      `<table style='margin:auto;'><tr><td>1. healthy</td><td>健康的</td></tr><tr><td>2. walk</td><td>走；步行</td></tr></table>`,
    );
    expect(result.entries.map((e) => [e.en, e.zh])).toEqual([
      ["healthy", "健康的"],
      ["walk", "走；步行"],
    ]);
    expect(
      parseList(
        "<div>六年级下册 词语表</div><table><tr><td>1. 豌豆</td><td>wān dòu</td></tr></table>",
      ).entries[0].pinyin,
    ).toBe("wān dòu");
  });
  it("接受 AI 代码围栏与普通文本，不把噪声变成词条", () => {
    expect(parseList('```json\n{"entries":[{"en":"apple","zh":"苹果"}]}\n```').entries[0].en).toBe(
      "apple",
    );
    expect(
      parseList("apple  苹果\nlibrary  图书馆\nUnit 单词听写\n1. pear 梨").entries,
    ).toHaveLength(3);
    expect(() => parseList('<c ">\n">\n•ㄏ\n•v')).toThrow("没有解析出词条");
    expect(() => parseList('{"entries":[null]}')).toThrow();
  });
  it("纯中文多词拆分并自动注音，保留 AI 指定的拼音", () => {
    const entries = parseList("1. 温暖 舒适 敬佩 掩护\n荷花，聚拢，仿佛").entries;
    expect(entries.map((e) => e.zh)).toEqual([
      "温暖",
      "舒适",
      "敬佩",
      "掩护",
      "荷花",
      "聚拢",
      "仿佛",
    ]);
    expect(entries[0].pinyin).toBe("wēn nuǎn");
    expect(entries.every((e) => !e.en && e.modes.includes("pinyin2hanzi"))).toBe(true);
    expect(parseList('{"entries":[{"zh":"行","pinyin":"háng"}]}').entries[0].pinyin).toBe("háng");
  });
  it("拒绝错误模式、重复 ID、超长词条和超额词表，不静默截断", () => {
    const entry = normalizeEntry({ en: "apple", zh: "苹果" }, 0);
    expect(batchInputSchema.safeParse({ entries: [entry, entry] }).success).toBe(false);
    expect(
      batchInputSchema.safeParse({ entries: [{ ...entry, en: "x".repeat(301) }] }).success,
    ).toBe(false);
    expect(
      batchInputSchema.safeParse({ entries: [{ ...entry, modes: ["pinyin2hanzi"] }] }).success,
    ).toBe(false);
    expect(
      batchInputSchema.safeParse({
        entries: Array.from({ length: 501 }, (_, i) => ({ ...entry, id: `e${i}` })),
      }).success,
    ).toBe(false);
  });
  it("多音字只提醒，不修改词表；缺字段阻止保存", () => {
    const entries = [normalizeEntry({ zh: "勉强", pinyin: "miǎn qiáng" }, 0)];
    const before = JSON.stringify(entries);
    expect(validateEntries(entries).some((x) => x.message.includes("miǎn qiǎng"))).toBe(true);
    expect(JSON.stringify(entries)).toBe(before);
    expect(
      validateEntries([{ ...entries[0], en: "", zh: "" }]).some((x) => x.level === "error"),
    ).toBe(true);
  });
});

describe("播放生命周期", () => {
  it("停止后陈旧音频结束回调不能切题或继续朗读", async () => {
    let finish = () => {};
    let spoken = 0;
    const player = new Playback(
      {
        speak: () => {
          spoken++;
          return new Promise<void>((r) => {
            finish = r;
          });
        },
        cancel: () => {},
      },
      () => {},
      () => Promise.resolve(),
    );
    const queue = createQueue(
      [normalizeEntry({ en: "sun", zh: "太阳" }, 0), normalizeEntry({ en: "moon", zh: "月亮" }, 1)],
      "en2en",
    );
    const pending = player.play(
      queue,
      0,
      {
        ...defaultSettings,
        accent: "us",
        repeat: 1,
        interval: 0,
        speed: 1,
        auto: true,
        shuffle: false,
      },
      () => {},
    );
    player.stop();
    finish();
    await pending;
    expect(spoken).toBe(1);
  });
  it("自然播放顺序与重复准确，静音模式不调用音频", async () => {
    const spoken: string[] = [];
    const changes: number[] = [];
    const player = new Playback(
      {
        speak: async (text) => {
          spoken.push(text);
        },
        cancel: () => {},
      },
      () => {},
      () => Promise.resolve(),
    );
    const entries = [
      normalizeEntry({ zh: "太阳", pinyin: "tài yáng" }, 0),
      normalizeEntry({ zh: "月亮", pinyin: "yuè liang" }, 1),
    ];
    await player.play(
      createQueue(entries, "zh_dictation"),
      0,
      {
        ...defaultSettings,
        accent: "us",
        repeat: 2,
        interval: 0,
        speed: 1,
        auto: true,
        shuffle: false,
      },
      (i) => changes.push(i),
    );
    expect(spoken).toEqual(["太阳", "太阳", "月亮", "月亮"]);
    expect(changes).toEqual([1]);
    await player.play(
      createQueue(entries, "pinyin2hanzi"),
      0,
      {
        ...defaultSettings,
        accent: "us",
        repeat: 1,
        interval: 0,
        speed: 1,
        auto: true,
        shuffle: false,
      },
      () => {},
    );
    expect(spoken).toHaveLength(4);
  });
  it("朗读词语后朗读语境提示", async () => {
    const spoken: string[] = [];
    const player = new Playback(
      {
        speak: async (text) => {
          spoken.push(text);
        },
        cancel: () => {},
      },
      () => {},
    );
    await player.play(
      createQueue([normalizeEntry({ zh: "升", hint: "上升的升" }, 0)], "zh_dictation"),
      0,
      { ...defaultSettings, repeat: 1 },
      () => {},
    );
    expect(spoken).toEqual(["升", "上升的升"]);
  });
});
