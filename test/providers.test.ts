import { EventEmitter } from "node:events";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";

const spawn = vi.hoisted(() => vi.fn());
vi.mock("node:child_process", () => ({ spawn }));

import { createTts } from "../apps/server/src/providers";

afterEach(() => {
  vi.unstubAllEnvs();
  spawn.mockReset();
});

it("服务器语音显式启用，同请求合并且完成后才发布缓存", async () => {
  vi.stubEnv("ENABLE_SERVER_TTS", "true");
  const dir = mkdtempSync(join(tmpdir(), "dictation-audio-"));
  let finish = () => {};
  let output = "";
  spawn.mockImplementation((_python: string, args: string[]) => {
    const child = new EventEmitter();
    output = args[args.length - 1];
    finish = () => {
      writeFileSync(output, "synthetic audio");
      child.emit("close", 0);
    };
    return child;
  });
  const tts = createTts(dir);
  const item = { text: "sun", lang: "en" as const, rate: "+0%" };
  const one = tts(item);
  const two = tts(item);
  expect(spawn).toHaveBeenCalledTimes(1);
  expect(existsSync(output)).toBe(false);
  finish();
  const url = await one;
  expect(await two).toBe(url);
  expect(readFileSync(join(dir, url.slice(6)), "utf8")).toBe("synthetic audio");
  expect(existsSync(output)).toBe(false);
  expect(await tts(item)).toBe(url);
  expect(spawn).toHaveBeenCalledTimes(1);
});
it("关闭服务器语音时不启动 Python，也不请求外部服务", async () => {
  vi.stubEnv("ENABLE_SERVER_TTS", "false");
  const tts = createTts(mkdtempSync(join(tmpdir(), "dictation-audio-")));
  await expect(tts({ text: "sun", lang: "en", rate: "+0%" })).rejects.toThrow("未启用");
  expect(spawn).not.toHaveBeenCalled();
});
