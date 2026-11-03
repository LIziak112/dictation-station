import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import {
  type LocalAudioEntry,
  localAudioEntrySchema,
  type PronunciationInput,
  type Voice,
} from "../../../packages/contract/src/index";

const dictionarySchema = z.array(
  z.object({
    phonetics: z
      .array(
        z.object({
          text: z.string().optional(),
          audio: z.string().optional(),
          sourceUrl: z.string().optional(),
        }),
      )
      .default([]),
  }),
);
const field = z.object({ value: z.string() }).optional();
const commonsSchema = z.object({
  query: z.object({
    pages: z.record(
      z.string(),
      z.object({
        title: z.string().optional(),
        imageinfo: z
          .array(
            z.object({
              url: z.url(),
              timestamp: z.string().optional(),
              extmetadata: z.object({
                Artist: field,
                LicenseShortName: field,
                LicenseUrl: field,
                ImageDescription: field,
                Categories: field,
              }),
            }),
          )
          .optional(),
      }),
    ),
  }),
});
type Candidate = { voice: Voice; assetUrl?: string; file?: string; timestamp?: string };
interface Options {
  dir: string;
  fetcher?: typeof fetch;
  publicDictionary?: boolean;
  tts?: (input: {
    text: string;
    lang: "en" | "zh";
    rate: string;
    accent: "us" | "uk";
  }) => Promise<string>;
  localDirectory?: string;
  localEntries?: LocalAudioEntry[];
}
const empty = (input: PronunciationInput): Voice => ({
  id: `device:${input.lang}:${input.accent}`,
  kind: "device",
  url: null,
  source: "设备合成语音",
  sourceUrl: "",
  author: "",
  licenseName: "",
  licenseUrl: "",
  title: input.text,
  reading: "",
  accent: input.lang === "zh" ? "zh" : input.accent,
  warning: input.reading ? "指定读音未命中，请试听并确认合成兜底" : "",
});

export class Pronunciation {
  private fetcher: typeof fetch;
  private local: LocalAudioEntry[];
  constructor(private options: Options) {
    mkdirSync(options.dir, { recursive: true });
    this.fetcher = options.fetcher ?? fetch;
    const index = options.localDirectory ? join(options.localDirectory, "index.json") : "";
    this.local =
      options.localEntries ??
      (index && existsSync(index)
        ? z.array(localAudioEntrySchema).parse(JSON.parse(readFileSync(index, "utf8")))
        : []);
  }
  private async candidates(input: PronunciationInput): Promise<Candidate[]> {
    const local = this.local
      .filter(
        (entry) =>
          entry.text === input.text &&
          entry.lang === input.lang &&
          (entry.lang === "zh" || entry.accent === input.accent || entry.id === input.reading) &&
          (!input.reading || entry.reading === input.reading || entry.id === input.reading),
      )
      .map(
        (entry): Candidate => ({
          file: entry.file,
          voice: {
            ...empty(input),
            id: entry.id,
            kind: "human",
            source: entry.source,
            sourceUrl: entry.sourceUrl,
            author: entry.author,
            licenseName: entry.licenseName,
            licenseUrl: entry.licenseUrl,
            reading: entry.reading,
            accent: entry.accent,
            warning: "",
          },
        }),
      );
    if (local.length || this.options.publicDictionary === false) return local;
    if (input.lang === "zh") {
      const pageId = input.reading.match(/^commons:(\d+)$/)?.[1];
      const pinyin = (input.pinyin || input.reading).normalize("NFC").replace(/\s+/g, "");
      if (!pageId && !/^[a-züāáǎàēéěèīíǐìōóǒòūúǔùǖǘǚǜ]+$/i.test(pinyin)) return [];
      const candidate = await this.commons(
        input,
        pageId ? `pageids=${pageId}` : `titles=${encodeURIComponent(`File:Zh-${pinyin}.ogg`)}`,
        pinyin,
        "zh",
      );
      return candidate ? [candidate] : [];
    }
    const response = await this.fetcher(
      `https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(input.text)}`,
      { signal: AbortSignal.timeout(10000) },
    );
    if (!response.ok) return [];
    const entries = dictionarySchema.parse(await response.json());
    const candidates: Candidate[] = [],
      seen = new Set<string>();
    for (const phonetic of entries.flatMap((entry) => entry.phonetics)) {
      if (!phonetic.sourceUrl || !phonetic.audio) continue;
      const source = new URL(phonetic.sourceUrl);
      const pageId = source.searchParams.get("curid");
      const accent = phonetic.audio.match(/-(uk|us|au)\.(?:mp3|ogg)$/)?.[1];
      if (
        source.hostname !== "commons.wikimedia.org" ||
        !pageId ||
        !/^\d+$/.test(pageId) ||
        (accent !== input.accent && input.reading !== `commons:${pageId}`)
      )
        continue;
      const id = `commons:${pageId}`;
      if (
        seen.has(id) ||
        (input.reading && input.reading !== id && input.reading !== phonetic.text)
      )
        continue;
      seen.add(id);
      const candidate = await this.commons(
        input,
        `pageids=${pageId}`,
        phonetic.text ?? "",
        accent ?? "other",
      );
      if (candidate) candidates.push(candidate);
    }
    return candidates;
  }
  private async commons(
    input: PronunciationInput,
    query: string,
    reading: string,
    accent: string,
  ): Promise<Candidate | null> {
    const response = await this.fetcher(
      `https://commons.wikimedia.org/w/api.php?action=query&${query}&prop=imageinfo&iiprop=extmetadata%7Curl%7Ctimestamp&format=json`,
      { signal: AbortSignal.timeout(10000) },
    );
    if (!response.ok) return null;
    const pages = commonsSchema.parse(await response.json()).query.pages;
    const found = Object.entries(pages).find(([, page]) => page.imageinfo?.length);
    if (!found) return null;
    const [pageId, page] = found,
      info = page.imageinfo?.[0];
    if (!info) return null;
    if (
      input.lang === "zh" &&
      (!(info.extmetadata.Categories?.value ?? "").includes("Chinese pronunciation") ||
        !(info.extmetadata.ImageDescription?.value ?? "").includes(input.text))
    )
      return null;
    const licenseUrl = info.extmetadata.LicenseUrl?.value.replace(/^http:/, "https:") ?? "";
    if (
      !/^https:\/\/creativecommons\.org\/(?:licenses\/by(?:-sa)?\/|publicdomain\/(?:zero|mark)\/)/.test(
        licenseUrl,
      ) ||
      new URL(info.url).hostname !== "upload.wikimedia.org"
    )
      return null;
    return {
      assetUrl: info.url,
      timestamp: info.timestamp,
      voice: {
        ...empty(input),
        id: `commons:${pageId}`,
        kind: "human",
        source:
          input.lang === "zh"
            ? "维基词典 / Wikimedia Commons"
            : "Free Dictionary API / Wikimedia Commons",
        sourceUrl: `https://commons.wikimedia.org/w/index.php?curid=${pageId}`,
        author: (info.extmetadata.Artist?.value ?? "详见来源页").replace(/<[^>]*>/g, ""),
        title: page.title ?? input.text,
        reading,
        licenseName: info.extmetadata.LicenseShortName?.value ?? "Creative Commons",
        licenseUrl,
        accent,
        warning: "",
      },
    };
  }
  async voices(input: PronunciationInput) {
    return (await this.candidates(input)).map((candidate) => candidate.voice);
  }
  async prepare(input: PronunciationInput, forceSynthetic = false): Promise<Voice> {
    let warning = "";
    if (!forceSynthetic) {
      try {
        const [candidate] = await this.candidates(input);
        if (candidate) {
          const localPath =
            candidate.file && this.options.localDirectory
              ? join(this.options.localDirectory, candidate.file)
              : null;
          const extension = localPath
            ? candidate.file?.split(".").at(-1)
            : new URL(candidate.assetUrl as string).pathname.split(".").at(-1);
          if (!["mp3", "ogg", "wav"].includes(extension ?? "")) throw new Error("音频格式暂不支持");
          const key = createHash("sha1")
            .update(
              JSON.stringify([
                candidate.voice.id,
                input.lang,
                input.text,
                input.accent,
                input.reading,
                candidate.timestamp,
                candidate.voice.licenseUrl,
              ]),
            )
            .digest("hex");
          const filename = `${key}.${extension}`,
            target = join(this.options.dir, filename);
          if (!existsSync(target)) {
            if (localPath) copyFileSync(localPath, target);
            else {
              const response = await this.fetcher(candidate.assetUrl as string, {
                signal: AbortSignal.timeout(15000),
              });
              if (
                !response.ok ||
                !/(?:audio\/|application\/ogg)/.test(response.headers.get("content-type") ?? "")
              )
                throw new Error("真人音频暂不可播放");
              writeFileSync(target, Buffer.from(await response.arrayBuffer()));
            }
          }
          return { ...candidate.voice, url: `audio/${filename}` };
        }
      } catch {
        warning = "真人音频暂不可用，本项采用合成兜底";
      }
    }
    const voice = {
      ...empty(input),
      warning: [empty(input).warning, warning].filter(Boolean).join("；"),
    };
    if (this.options.tts) {
      try {
        return {
          ...voice,
          id: `server:${input.lang}:${input.accent}`,
          kind: "server",
          source: "服务端合成语音",
          url: await this.options.tts({
            text: input.text,
            lang: input.lang,
            rate: "+0%",
            accent: input.accent,
          }),
        };
      } catch {
        return {
          ...voice,
          warning: `${voice.warning}${voice.warning ? "；" : ""}服务端合成失败，改用设备语音`,
        };
      }
    }
    return voice;
  }
}
