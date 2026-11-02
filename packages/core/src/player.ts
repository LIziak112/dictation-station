import { type Entry, MODES, type Mode, type Settings } from "../../contract/src/index";
import { writingSeconds } from "./pacing";

export function createQueue(entries: Entry[], mode: Mode) {
  const m = MODES[mode];
  return entries
    .filter((e) => e.modes.includes(mode))
    .map((entry) => ({
      entry,
      prompt: m.show ? entry[m.show] : "",
      answer: entry[m.answer],
      audioText: m.audio ? entry[m.audio] : "",
      lang: m.audio,
    }));
}
export interface AudioDriver {
  speak(text: string, lang: "en" | "zh", speed: number, audioKey?: string): Promise<void>;
  cancel(): void;
}
export class Playback {
  private generation = 0;
  constructor(
    private driver: AudioDriver,
    private state: (playing: boolean, error?: string) => void,
    private wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms)),
  ) {}
  stop() {
    this.generation++;
    this.driver.cancel();
    this.state(false);
  }
  async play(
    queue: { audioText: string; lang: "en" | "zh" | null; audioKey?: string }[],
    start: number,
    settings: Settings,
    onIndex: (index: number) => unknown,
    options?: { intro?: string; groupGuide?: string; onBreak?: (index: number) => void },
  ) {
    this.stop();
    const generation = this.generation;
    const active = () => generation === this.generation;
    if (!queue[start]?.audioText) return;
    this.state(true);
    try {
      if (options?.intro) await this.driver.speak(options.intro, "zh", 1);
      for (let index = start; index < queue.length; index++) {
        const q = queue[index];
        if (!active()) return;
        if (index !== start) await onIndex(index);
        if (!active()) return;
        for (let n = 0; n < settings.repeat; n++) {
          if (!active()) return;
          if (q.lang) await this.driver.speak(q.audioText, q.lang, settings.speed, q.audioKey);
          if (!active()) return;
          if (n < settings.repeat - 1) await this.wait(320);
        }
        if (!settings.auto || index === queue.length - 1) break;
        if (settings.groupSize && (index + 1) % settings.groupSize === 0 && options?.onBreak) {
          await onIndex(index + 1);
          if (!active()) return;
          if (options.groupGuide) await this.driver.speak(options.groupGuide, "zh", 1);
          if (!active()) return;
          options.onBreak(index + 1);
          break;
        }
        await this.wait(
          (settings.adaptiveInterval
            ? writingSeconds(q.audioText, q.lang, settings.interval)
            : settings.interval) * 1000,
        );
      }
    } catch (error) {
      if (active()) this.state(false, error instanceof Error ? error.message : "朗读失败，请重试");
    } finally {
      if (active()) this.state(false);
    }
  }
}
