import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Pronunciation } from "../apps/server/src/pronunciation";

// 独立手动验证，不接入 CI，不使用用户词表或服务端凭据。
const dir = mkdtempSync(join(tmpdir(), "ownclass-audio-probe-"));
const provider = new Pronunciation({ dir });
const samples = [
  "apple",
  "school",
  "beautiful",
  "read",
  "record",
  "look after",
  "I go to school on foot.",
  "太阳",
  "音乐",
  "长大",
  "银行",
  "行走",
];
const pinyin: Record<string, string> = {
  太阳: "tài yáng",
  音乐: "yīn yuè",
  长大: "zhǎng dà",
  银行: "yín háng",
  行走: "xíng zǒu",
};
const results = [];
for (const text of samples) {
  const begin = Date.now();
  const voice = await provider.prepare({
    text,
    pinyin: pinyin[text],
    lang: /[一-鿿]/.test(text) ? "zh" : "en",
    accent: "uk",
    reading: "",
  });
  results.push({ text, ...voice, elapsedMs: Date.now() - begin });
  console.log(JSON.stringify(results.at(-1)));
}
const report = join(dir, "report.json");
writeFileSync(report, JSON.stringify({ checkedAt: new Date().toISOString(), results }, null, 2));
console.log(`验证报告与获准缓存的音频：${report}`);
