import {
  defaultSettings,
  type Settings,
  settingsSchema,
} from "../../../packages/contract/src/index";
import { localKey } from "./storage";

export function loadSettings(batchId: string, accountId: string): Settings {
  try {
    const saved =
      localStorage.getItem(localKey(`settings:${batchId}`, accountId)) ??
      localStorage.getItem(localKey("settings:last", accountId));
    if (saved) {
      const parsed = settingsSchema.safeParse(JSON.parse(saved));
      if (parsed.success) return parsed.data;
    }
    return defaultSettings;
  } catch {
    return defaultSettings;
  }
}
export function rememberSettings(batchId: string, settings: Settings, accountId: string) {
  try {
    const value = JSON.stringify(settingsSchema.parse(settings));
    localStorage.setItem(localKey(`settings:${batchId}`, accountId), value);
    localStorage.setItem(localKey("settings:last", accountId), value);
  } catch {
    /* 偏好写失败不影响词表草稿与正式进度的保存保护。 */
  }
}
