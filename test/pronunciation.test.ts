import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import { Pronunciation } from "../apps/server/src/pronunciation";

const phonetics = [
  {
    word: "apple",
    phonetics: [
      {
        text: "/apple/",
        audio: "https://api.dictionaryapi.dev/media/pronunciations/en/apple-uk.mp3",
        sourceUrl: "https://commons.wikimedia.org/w/index.php?curid=12",
      },
    ],
  },
];
const commons = {
  query: {
    pages: {
      "12": {
        title: "File:apple.ogg",
        imageinfo: [
          {
            url: "https://upload.wikimedia.org/wikipedia/commons/a/apple.ogg",
            timestamp: "2026-01-01T00:00:00Z",
            extmetadata: {
              Artist: { value: "合成测试作者" },
              LicenseShortName: { value: "CC BY 3.0" },
              LicenseUrl: { value: "https://creativecommons.org/licenses/by/3.0/" },
            },
          },
        ],
      },
    },
  },
};

it("词典匹配使用原始真人音频并保留作者与许可，不访问失效的中转媒体", async () => {
  const fetcher = vi.fn(async (url: string | URL | Request) => {
    const value = String(url);
    if (value.startsWith("https://api.dictionaryapi.dev/api/")) return Response.json(phonetics);
    if (value.startsWith("https://commons.wikimedia.org/w/api.php")) return Response.json(commons);
    if (value.startsWith("https://upload.wikimedia.org/"))
      return new Response("synthetic audio", { headers: { "Content-Type": "audio/ogg" } });
    throw new Error("不应访问未知地址");
  });
  const dir = mkdtempSync(join(tmpdir(), "dictation-voice-"));
  const provider = new Pronunciation({ dir, fetcher });
  const voice = await provider.prepare({ text: "apple", lang: "en", accent: "uk", reading: "" });
  expect(voice.kind).toBe("human");
  expect(voice.author).toBe("合成测试作者");
  expect(voice.licenseUrl).toContain("creativecommons.org");
  expect(voice.url).toMatch(/^audio\/[a-f0-9]{40}\.ogg$/);
  expect(fetcher.mock.calls.some(([url]) => String(url).includes("/media/pronunciations"))).toBe(
    false,
  );
});
it("缺音频、缺许可或指定读音未命中时明确降级，不假报真人", async () => {
  const provider = new Pronunciation({
    dir: mkdtempSync(join(tmpdir(), "dictation-missing-")),
    fetcher: async () => Response.json([]),
    tts: async () => "audio/test.mp3",
  });
  expect(
    (await provider.prepare({ text: "自定义句子", lang: "zh", accent: "us", reading: "" })).kind,
  ).toBe("server");
  const missing = await provider.prepare({
    text: "read",
    lang: "en",
    accent: "us",
    reading: "unknown-reading",
  });
  expect(missing.kind).toBe("server");
  expect(missing.warning).toContain("指定读音");
});
it("部署者本地索引按语言、口音与读音匹配，不拼接中文单字", async () => {
  const dir = mkdtempSync(join(tmpdir(), "dictation-local-")),
    assets = join(dir, "book");
  mkdirSync(assets);
  writeFileSync(join(assets, "music.mp3"), "synthetic local audio");
  const provider = new Pronunciation({
    dir,
    localDirectory: assets,
    localEntries: [
      {
        id: "music-zh",
        text: "音乐",
        lang: "zh",
        accent: "zh",
        reading: "yīn yuè",
        file: "music.mp3",
        source: "测试词书",
        sourceUrl: "https://example.org/book",
        author: "测试作者",
        licenseName: "测试许可",
        licenseUrl: "https://example.org/license",
      },
    ],
  });
  expect(
    (await provider.prepare({ text: "音乐", lang: "zh", accent: "us", reading: "yīn yuè" })).kind,
  ).toBe("human");
  expect(
    (await provider.prepare({ text: "音乐课", lang: "zh", accent: "us", reading: "" })).kind,
  ).toBe("device");
});
it("中文按拼音和来源描述同时核对，多音字不匹配时不采用同音的其他词", async () => {
  const metadata = structuredClone(commons);
  Object.assign(metadata.query.pages["12"].imageinfo[0].extmetadata, {
    Categories: { value: "Chinese pronunciation" },
    ImageDescription: { value: "Pronunciation of yīnyuè (音乐) in Chinese" },
  });
  const fetcher = vi.fn(async (url: string | URL | Request) =>
    String(url).startsWith("https://upload.wikimedia.org/")
      ? new Response("synthetic audio", { headers: { "Content-Type": "audio/ogg" } })
      : Response.json(metadata),
  );
  const provider = new Pronunciation({
    dir: mkdtempSync(join(tmpdir(), "dictation-zh-")),
    fetcher,
  });
  expect(
    (
      await provider.prepare({
        text: "音乐",
        lang: "zh",
        accent: "us",
        reading: "",
        pinyin: "yīn yuè",
      })
    ).kind,
  ).toBe("human");
  expect(
    (
      await provider.prepare({
        text: "音悦",
        lang: "zh",
        accent: "us",
        reading: "",
        pinyin: "yīn yuè",
      })
    ).kind,
  ).toBe("device");
  expect(fetcher.mock.calls.every(([url]) => !String(url).includes("dictionaryapi.dev"))).toBe(
    true,
  );
});
