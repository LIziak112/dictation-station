import { expect } from "@playwright/test";
import { test } from "./fixtures";

test("纯听中英交替；跟读录音只留本机并释放麦克风，不写听写记录", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, "speechSynthesis", {
      configurable: true,
      value: {
        speak: (u: SpeechSynthesisUtterance) =>
          setTimeout(() => u.onend?.call(u, new Event("end") as SpeechSynthesisEvent), 0),
        cancel: () => {},
      },
    });
    Object.defineProperty(navigator.mediaDevices, "getUserMedia", {
      configurable: true,
      value: async () => ({
        getTracks: () => [
          {
            stop: () => {
              document.documentElement.dataset.micStopped = "true";
            },
          },
        ],
      }),
    });
    class Capture {
      state = "inactive";
      mimeType = "audio/wav";
      ondataavailable: ((event: { data: Blob }) => void) | null = null;
      onstop: (() => void) | null = null;
      start() {
        this.state = "recording";
      }
      stop() {
        this.state = "inactive";
        // 合成静音 WAV，不访问测试机器的真实麦克风。
        const bytes = new ArrayBuffer(1644),
          view = new DataView(bytes);
        const text = (offset: number, value: string) => {
          [...value].forEach((char, i) => {
            view.setUint8(offset + i, char.charCodeAt(0));
          });
        };
        text(0, "RIFF");
        view.setUint32(4, 1636, true);
        text(8, "WAVEfmt ");
        view.setUint32(16, 16, true);
        view.setUint16(20, 1, true);
        view.setUint16(22, 1, true);
        view.setUint32(24, 8000, true);
        view.setUint32(28, 16000, true);
        view.setUint16(32, 2, true);
        view.setUint16(34, 16, true);
        text(36, "data");
        view.setUint32(40, 1600, true);
        this.ondataavailable?.({ data: new Blob([bytes], { type: this.mimeType }) });
        setTimeout(() => this.onstop?.(), 0);
      }
    }
    Object.defineProperty(window, "MediaRecorder", { configurable: true, value: Capture });
  });
  const batch = (
    await (
      await page.request.post("api/batches", {
        data: {
          title: "听读词表",
          entries: [
            { en: "sun", zh: "太阳" },
            { en: "moon", zh: "月亮" },
          ],
        },
      })
    ).json()
  ).batch;
  await page.goto(`./#batch=${batch.id}`);
  await page.getByRole("button", { name: "纯听这份词表" }).click();
  await expect(page.getByRole("button", { name: "开始播放", exact: true })).toBeEnabled();
  await page.getByRole("button", { name: "开始播放", exact: true }).click();
  await expect(page.locator(".practice-word")).toHaveText("太阳");
  await page.getByRole("button", { name: "暂停播放" }).click();
  await page.getByRole("button", { name: "返回词表", exact: true }).click();
  await page.goto(`./#batch=${batch.id}`);
  await page.getByRole("button", { name: "跟读练口语" }).click();
  await expect(page.getByRole("button", { name: "播放示范" })).toBeEnabled();
  const writes: string[] = [];
  page.on("request", (request) => {
    if (["POST", "PUT", "PATCH"].includes(request.method())) writes.push(request.url());
  });
  await page.getByRole("button", { name: "录下我的跟读" }).click();
  await expect(page.getByRole("status")).toContainText("正在录音");
  await page.getByRole("button", { name: "结束录音" }).click();
  await expect(page.getByRole("button", { name: "回放我的录音" })).toBeEnabled();
  await expect(page.locator("html")).toHaveAttribute("data-mic-stopped", "true");
  await page.getByRole("button", { name: "回放我的录音" }).click();
  await page.getByRole("button", { name: "下一个", exact: true }).click();
  await expect(page.getByRole("button", { name: "回放我的录音" })).toBeDisabled();
  expect(writes).toEqual([]);
  expect((await (await page.request.get("api/history")).json()).items).toEqual([]);
});

test("麦克风拒绝后仍可听示范", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator.mediaDevices, "getUserMedia", {
      configurable: true,
      value: async () => {
        throw new DOMException("denied", "NotAllowedError");
      },
    });
  });
  const batch = (
    await (await page.request.post("api/batches", { data: { entries: [{ en: "school" }] } })).json()
  ).batch;
  await page.goto(`./#batch=${batch.id}`);
  await page.getByRole("button", { name: "跟读练口语" }).click();
  await page.getByRole("button", { name: "录下我的跟读" }).click();
  await expect(page.getByRole("alert")).toContainText("未能开启麦克风");
  await expect(page.getByRole("button", { name: "播放示范" })).toBeEnabled();
});
