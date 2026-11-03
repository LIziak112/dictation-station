import { expect, it } from "vitest";
import { defaultSettings } from "../packages/contract/src/index";
import { ActiveTime, writingSeconds } from "../packages/core/src/pacing";
import { Playback } from "../packages/core/src/player";

it("长词与句子自动多留时间，且不超过一分钟", () => {
  expect(writingSeconds("sun", "en", 4)).toBe(4);
  expect(writingSeconds("look after", "en", 4)).toBeGreaterThan(4);
  expect(writingSeconds("中华人民共和国", "zh", 4)).toBeGreaterThan(4);
  expect(writingSeconds("a ".repeat(300), "en", 30)).toBe(60);
});
it("暂停不累计练习时长，继续后达到二十分钟才提醒", () => {
  const clock = new ActiveTime();
  clock.resume(0);
  clock.pause(600000);
  expect(clock.shouldRest(3600000)).toBe(false);
  clock.resume(3600000);
  expect(clock.shouldRest(4200000)).toBe(true);
  clock.reset(4200000);
  expect(clock.shouldRest(4200000)).toBe(false);
});
it("自动播放每五项停在组间，保存下一项游标但不提前念出来", async () => {
  const spoken: string[] = [],
    breaks: number[] = [],
    indexes: number[] = [];
  const player = new Playback(
    {
      speak: async (text) => {
        spoken.push(text);
      },
      cancel: () => {},
    },
    () => {},
    async () => {},
  );
  const queue = Array.from({ length: 6 }, (_, i) => ({
    audioText: `word ${i + 1}`,
    lang: "en" as const,
  }));
  await player.play(
    queue,
    0,
    { ...defaultSettings, auto: true, repeat: 1, groupSize: 5 },
    (index) => {
      indexes.push(index);
    },
    {
      onBreak: (next) => {
        breaks.push(next);
      },
    },
  );
  expect(spoken).toHaveLength(5);
  expect(breaks).toEqual([5]);
  expect(indexes.at(-1)).toBe(5);
});
