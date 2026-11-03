import type { Entry } from "../../contract/src/index";

export function listeningQueue(
  entries: Entry[],
  language: "en" | "zh" | "both",
  shuffle: boolean,
  random = Math.random,
) {
  const ordered = [...entries];
  if (shuffle)
    for (let i = ordered.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1));
      [ordered[i], ordered[j]] = [ordered[j], ordered[i]];
    }
  return ordered.flatMap((entry) =>
    (["en", "zh"] as const)
      .filter((lang) => (language === "both" || language === lang) && entry[lang])
      .map((lang) => ({
        entry,
        lang,
        audioText: entry[lang],
        reading: entry.readings[lang] || entry.reading,
        audioKey: `${entry.id}|${lang}`,
      })),
  );
}
