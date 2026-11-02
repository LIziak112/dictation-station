import { type PronunciationInput, voiceResponseSchema } from "../../../packages/contract/src/index";
import { loadAudio } from "./AudioPreparation";
import { request } from "./api";

export async function prepareVoice(input: PronunciationInput, signal: AbortSignal) {
  const get = async (synthetic = false) => {
    const { voice } = await request("api/pronunciation/preview", voiceResponseSchema, {
      method: "POST",
      body: JSON.stringify({ ...input, synthetic }),
      signal,
    });
    if (voice.kind === "unavailable") throw new Error(voice.warning || "声音暂不可用");
    const blob = voice.url ? await loadAudio(voice.url, signal) : null;
    if (!blob && !("speechSynthesis" in window)) throw new Error("当前设备不支持朗读");
    return { voice, blob };
  };
  try {
    return await get();
  } catch (error) {
    if (signal.aborted) throw error;
    const fallback = await get(true);
    return {
      ...fallback,
      voice: { ...fallback.voice, warning: "原音频无法播放，已改用合成语音。" },
    };
  }
}
