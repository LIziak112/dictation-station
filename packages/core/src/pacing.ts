export function writingSeconds(text: string, lang: "en" | "zh" | null, base: number) {
  const characters = Array.from(text.replace(/\s/g, "")).length;
  const extra =
    lang === "zh"
      ? Math.max(0, characters - 2) * 0.8
      : Math.max(0, text.trim().split(/\s+/).length - 1) * 1.5 + Math.max(0, characters - 6) * 0.3;
  return Math.min(60, base + extra);
}
export class ActiveTime {
  private total = 0;
  private started: number | null = null;
  resume(now = Date.now()) {
    this.started ??= now;
  }
  pause(now = Date.now()) {
    if (this.started !== null) this.total += now - this.started;
    this.started = null;
  }
  shouldRest(now = Date.now()) {
    return this.total + (this.started === null ? 0 : now - this.started) >= 20 * 60 * 1000;
  }
  reset(now = Date.now()) {
    this.total = 0;
    this.started = this.started === null ? null : now;
  }
}
