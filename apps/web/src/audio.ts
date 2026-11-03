import type { AudioDriver } from "../../../packages/core/src/player";
import { childHeaders } from "./api";

export class BrowserAudio implements AudioDriver {
  private audio = new Audio();
  utterance: SpeechSynthesisUtterance | null = null;
  private pending: (() => void) | null = null;
  private urls = new Map<string, string>();
  private sources = new Map<string, string>();
  constructor(private accent: "us" | "uk" = "us") {}
  setAccent(accent: "us" | "uk") {
    this.accent = accent;
  }
  setSources(sources: { key: string; url: string }[]) {
    this.sources = new Map(sources.map(({ key, url }) => [key, url]));
  }
  cache(text: string, lang: string, blob: Blob, audioKey?: string) {
    const key = audioKey ?? `${lang}|${text}`;
    const old = this.urls.get(key);
    if (old) URL.revokeObjectURL(old);
    this.urls.set(key, URL.createObjectURL(blob));
  }
  cancel() {
    this.pending?.();
    this.pending = null;
    this.utterance = null;
    this.audio.pause();
    this.audio.removeAttribute("src");
    this.audio.load();
    if ("speechSynthesis" in window) speechSynthesis.cancel();
  }
  dispose() {
    this.cancel();
    this.clearCache();
  }
  clearCache() {
    for (const url of this.urls.values()) URL.revokeObjectURL(url);
    this.urls.clear();
  }
  speak(text: string, lang: "en" | "zh", speed: number, audioKey?: string): Promise<void> {
    this.cancel();
    return new Promise((resolve, reject) => {
      let done = false;
      let usingDevice = false;
      let loadingTimer: ReturnType<typeof setTimeout> | undefined;
      const finish = (error?: string) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        clearTimeout(loadingTimer);
        this.pending = null;
        this.utterance = null;
        this.audio.onended = null;
        this.audio.onerror = null;
        if (error) reject(new Error(error));
        else resolve();
      };
      this.pending = () => finish();
      const timer = setTimeout(() => finish("朗读超时，请重试或切换语音方式"), 60000);
      const url =
        (audioKey ? (this.urls.get(audioKey) ?? this.sources.get(audioKey)) : undefined) ??
        this.urls.get(`${lang}|${text}`);
      const speakDevice = () => {
        if (done || usingDevice) return;
        usingDevice = true;
        clearTimeout(loadingTimer);
        this.audio.pause();
        this.audio.onended = null;
        this.audio.onerror = null;
        if (!("speechSynthesis" in window)) {
          finish("当前设备不支持朗读，请使用服务器语音或其他浏览器");
          return;
        }
        if (speechSynthesis.paused) speechSynthesis.resume();
        const u = new SpeechSynthesisUtterance(text);
        this.utterance = u;
        u.lang = lang === "en" ? (this.accent === "uk" ? "en-GB" : "en-US") : "zh-CN";
        u.rate = 0.9 * speed;
        u.onend = () => finish();
        u.onerror = (event: SpeechSynthesisErrorEvent) => {
          const code = event?.error;
          if (code === "canceled" || code === "interrupted") finish();
          else finish("设备朗读失败，请点击播放重试");
        };
        speechSynthesis.speak(u);
      };
      if (url) {
        const fallback = () => {
          if (done || usingDevice) return;
          if (audioKey) this.sources.delete(audioKey);
          const key = audioKey ?? `${lang}|${text}`;
          const cached = this.urls.get(key);
          if (cached) URL.revokeObjectURL(cached);
          this.urls.delete(key);
          speakDevice();
        };
        const playFile = (src: string) => {
          if (done || usingDevice) return;
          this.audio.src = src;
          this.audio.playbackRate = speed;
          this.audio.onended = () => finish();
          this.audio.onerror = fallback;
          this.audio
            .play()
            .then(() => clearTimeout(loadingTimer))
            .catch(fallback);
        };
        loadingTimer = setTimeout(fallback, 3000);
        if (url.startsWith("blob:")) playFile(url);
        else
          void fetch(url, { headers: childHeaders(), signal: AbortSignal.timeout(3000) })
            .then((response) => {
              if (!response.ok) throw new Error("声音读取失败");
              return response.blob();
            })
            .then((blob) => {
              if (done || usingDevice) return;
              this.cache(text, lang, blob, audioKey);
              const cached = this.urls.get(audioKey ?? `${lang}|${text}`);
              if (cached) playFile(cached);
            })
            .catch(fallback);
      } else {
        speakDevice();
      }
    });
  }
}
