import {
  defaultSettings,
  type Settings,
  settingsSchema,
} from "../../../packages/contract/src/index";
import { localKey } from "./storage";

export function loadSettings(batchId: string): Settings {
  try {
    const saved =
      localStorage.getItem(localKey(`settings:${batchId}`)) ??
      localStorage.getItem(localKey("settings:last"));
    if (saved) {
      const parsed = settingsSchema.safeParse(JSON.parse(saved));
      if (parsed.success) return parsed.data;
    }
    // 迁入旧版按批次与上次选择保存的语速，不删除旧值。
    const speed = Number(
      localStorage.getItem(`dictation.speed.${batchId}`) ?? localStorage.getItem("dictation.speed"),
    );
    return { ...defaultSettings, speed: [0.5, 0.75, 1, 1.25, 1.5, 2].includes(speed) ? speed : 1 };
  } catch {
    return defaultSettings;
  }
}
export function rememberSettings(batchId: string, settings: Settings) {
  try {
    const value = JSON.stringify(settingsSchema.parse(settings));
    localStorage.setItem(localKey(`settings:${batchId}`), value);
    localStorage.setItem(localKey("settings:last"), value);
  } catch {
    /* 偏好写失败不影响词表草稿与正式进度的保存保护。 */
  }
}
