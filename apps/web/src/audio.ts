import type { AudioDriver } from "../../../packages/core/src/player";

export class BrowserAudio implements AudioDriver {
  private audio = new Audio();
  private pending: (() => void) | null = null;
  private urls = new Map<string, string>();
  constructor(private accent: "us" | "uk" = "us") {}
  setAccent(accent: "us" | "uk") {
    this.accent = accent;
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
      const finish = (error?: string) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        this.pending = null;
        if (error) reject(new Error(error));
        else resolve();
      };
      this.pending = () => finish();
      const timer = setTimeout(() => finish("朗读超时，请重试或切换语音方式"), 60000);
      const url = this.urls.get(audioKey ?? `${lang}|${text}`);
      if (url) {
        this.audio.src = url;
        this.audio.playbackRate = speed;
        this.audio.onended = () => finish();
        this.audio.onerror = () => finish("音频加载失败，请重试");
        this.audio.play().catch(() => finish("播放被浏览器阻止，请点击播放重试"));
      } else {
        if (!("speechSynthesis" in window)) {
          finish("当前设备不支持朗读，请使用服务器语音或其他浏览器");
          return;
        }
        const u = new SpeechSynthesisUtterance(text);
        u.lang = lang === "en" ? (this.accent === "uk" ? "en-GB" : "en-US") : "zh-CN";
        u.rate = 0.9 * speed;
        u.onend = () => finish();
        u.onerror = () => finish("设备朗读失败，请点击播放重试");
        speechSynthesis.speak(u);
      }
    });
  }
}
