import { z } from "zod";

export const modeSchema = z.enum(["zh2en", "en2en", "en2zh", "zh_dictation", "pinyin2hanzi"]);
export type Mode = z.infer<typeof modeSchema>;
export const MODES = {
  zh2en: {
    label: "读汉语写英语",
    description: "看中文，写英文",
    show: "zh",
    answer: "en",
    audio: "zh",
  },
  en2en: {
    label: "读英语写英语",
    description: "只听发音，写英文",
    show: null,
    answer: "en",
    audio: "en",
  },
  en2zh: {
    label: "读英语写汉语",
    description: "看英文，写中文",
    show: "en",
    answer: "zh",
    audio: "en",
  },
  zh_dictation: {
    label: "语文听写",
    description: "只听读音，写汉字",
    show: null,
    answer: "zh",
    audio: "zh",
  },
  pinyin2hanzi: {
    label: "看拼音写词语",
    description: "看带调拼音，写汉字",
    show: "pinyin",
    answer: "zh",
    audio: null,
  },
} as const;
export const idSchema = z
  .string()
  .regex(/^[A-Za-z0-9_-]{1,80}$/)
  .refine((v) => !["__proto__", "constructor", "prototype"].includes(v), "无效 ID");
const text = (max: number) => z.string().trim().max(max);
const entryInputSchema = z.strictObject({
  id: idSchema.optional(),
  wordId: idSchema.optional(),
  kind: z.enum(["character", "word", "phrase", "sentence"]).optional(),
  reading: text(120).optional(),
  en: text(300).optional(),
  zh: text(300).optional(),
  pinyin: text(300).optional(),
  hint: text(500).optional(),
  alt: z.array(text(300)).max(30).optional(),
  modes: z.array(modeSchema).min(1).max(5).optional(),
  grade: text(40).optional(),
  unit: text(60).optional(),
});
export function normalizeEntry(value: unknown, index: number) {
  const e = entryInputSchema.parse(value);
  return {
    id: e.id ?? `e${index + 1}`,
    wordId: e.wordId,
    kind: e.kind ?? "word",
    reading: e.reading ?? "",
    en: e.en ?? "",
    zh: e.zh ?? "",
    pinyin: e.pinyin ?? "",
    hint: e.hint ?? "",
    alt: e.alt ?? [],
    modes:
      e.modes ??
      ((e.en
        ? e.zh
          ? ["zh2en", "en2en", "en2zh"]
          : ["en2en"]
        : e.pinyin
          ? ["zh_dictation", "pinyin2hanzi"]
          : ["zh_dictation"]) as Mode[]),
    grade: e.grade ?? "",
    unit: e.unit ?? "",
  };
}
export type Entry = ReturnType<typeof normalizeEntry>;
export function entryErrors(e: Entry): string[] {
  const errors: string[] = [];
  if (!e.en && !e.zh) errors.push("英文和中文不能同时为空");
  for (const mode of e.modes) {
    const m = MODES[mode];
    if (!e[m.answer] || (m.show && !e[m.show]) || (m.audio && !e[m.audio]))
      errors.push(`「${m.label}」缺少必需的词条内容`);
  }
  return errors;
}
export const entrySchema = entryInputSchema.transform((e, ctx) => {
  const normalized = normalizeEntry(e, 0);
  for (const message of entryErrors(normalized)) ctx.addIssue({ code: "custom", message });
  return normalized;
});
const entriesSchema = z
  .array(entryInputSchema)
  .min(1, "至少需要一条词")
  .max(500)
  .transform((entries, ctx) => {
    const normalized = entries.map(normalizeEntry);
    const ids = new Set<string>();
    normalized.forEach((e, i) => {
      if (ids.has(e.id)) ctx.addIssue({ code: "custom", path: [i, "id"], message: "词条 ID 重复" });
      ids.add(e.id);
      for (const message of entryErrors(e)) ctx.addIssue({ code: "custom", path: [i], message });
    });
    return normalized;
  });
const batchFields = {
  version: z.literal(1).default(1),
  title: text(80).min(1).default("未命名听写"),
  subject: z.enum(["english", "chinese", "mixed"]).default("mixed"),
  stage: text(20).default(""),
  grade: text(40).default(""),
  textbook: text(60).default(""),
  unit: text(60).default(""),
  entries: entriesSchema,
};
export const batchInputSchema = z.strictObject({
  ...batchFields,
  sourceText: z.string().max(20000).default(""),
});
export const batchSchema = z.strictObject({
  ...batchFields,
  id: idSchema,
  revision: z.number().int().positive(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export type Batch = z.infer<typeof batchSchema>;
export const batchSummarySchema = batchSchema
  .omit({ entries: true })
  .extend({ count: z.number().int().nonnegative() });
export type BatchSummary = z.infer<typeof batchSummarySchema>;
export const batchListSchema = z.object({ batches: z.array(batchSummarySchema) });
export const batchResponseSchema = z.object({ batch: batchSchema });
export const updateSchema = z.strictObject({
  title: text(80).min(1).optional(),
  subject: batchFields.subject.removeDefault().optional(),
  stage: text(20).optional(),
  grade: text(40).optional(),
  textbook: text(60).optional(),
  unit: text(60).optional(),
  entries: entriesSchema.optional(),
  revision: z.number().int().positive(),
});
export const exportSchema = z.strictObject(batchFields);
export const ttsItemSchema = z.strictObject({
  text: text(300).min(1),
  lang: z.enum(["en", "zh"]),
  rate: z
    .string()
    .regex(/^[+-](?:[0-9]|[1-9][0-9])%$/)
    .default("+0%"),
});
export const ttsRequestSchema = z.strictObject({ items: z.array(ttsItemSchema).min(1).max(200) });
export const ttsResponseSchema = z.object({
  items: z.array(
    z.object({
      text: z.string(),
      lang: z.enum(["en", "zh"]),
      url: z.string().nullable(),
      error: z.string().optional(),
    }),
  ),
});
export const ocrRequestSchema = z.strictObject({
  image: z.strictObject({
    name: text(200),
    type: z.enum(["image/png", "image/jpeg", "image/webp"]),
    data: z
      .string()
      .min(4)
      .max(28_000_000)
      .regex(/^[A-Za-z0-9+/]+={0,2}$/),
  }),
});
export const healthSchema = z.object({
  ok: z.boolean(),
  ocr: z.boolean(),
  tts: z.boolean(),
  allowRegistration: z.boolean(),
});
export const accountSchema = z.object({ id: idSchema, username: z.string() });
export type Account = z.infer<typeof accountSchema>;
export const accountResponseSchema = z.object({ account: accountSchema });
export const credentialsSchema = z.strictObject({
  username: z
    .string()
    .trim()
    .min(2)
    .max(40)
    .regex(/^[A-Za-z0-9_-]+$/, "用户名使用字母、数字、下划线或短横线"),
  password: z.string().min(8).max(128),
});
export const passwordChangeSchema = z.strictObject({
  currentPassword: z.string().min(1).max(128),
  newPassword: credentialsSchema.shape.password,
});
export const passwordVerificationSchema = z.strictObject({
  password: credentialsSchema.shape.password,
});
export const settingsSchema = z.strictObject({
  repeat: z.number().int().min(1).max(5),
  interval: z.number().min(1).max(30),
  speed: z.number().min(0.5).max(2),
  auto: z.boolean(),
  shuffle: z.boolean(),
});
export type Settings = z.infer<typeof settingsSchema>;
export const defaultSettings: Settings = {
  repeat: 2,
  interval: 4,
  speed: 1,
  auto: false,
  shuffle: false,
};
export const progressSchema = z
  .strictObject({
    version: z.literal(1),
    batchId: idSchema,
    revision: z.number().int().positive(),
    mode: modeSchema,
    ids: z.array(idSchema).min(1).max(500),
    index: z.number().int().min(0),
    settings: settingsSchema,
    results: z.record(idSchema, z.boolean()),
    wrongIds: z.array(idSchema).max(500).default([]),
    phase: z.enum(["player", "result"]),
  })
  .superRefine((p, ctx) => {
    if (
      p.index >= p.ids.length ||
      new Set(p.ids).size !== p.ids.length ||
      Object.keys(p.results).some((id) => !p.ids.includes(id))
    )
      ctx.addIssue({ code: "custom", message: "无效听写进度" });
  });
export type Progress = z.infer<typeof progressSchema>;
export const draftSchema = z.strictObject({
  version: z.literal(1),
  batchId: idSchema.optional(),
  revision: z.number().int().positive().optional(),
  title: text(80),
  grade: text(40),
  unit: text(60),
  stage: text(20),
  textbook: text(60),
  raw: z.string().max(20000),
  input: z.string().max(1_000_000),
  entries: z.array(entryInputSchema).max(500),
});
export type Draft = z.infer<typeof draftSchema>;

export const taskInputSchema = z.strictObject({
  title: text(80).min(1),
  date: z.iso.date(),
  mode: modeSchema,
  settings: settingsSchema.default(defaultSettings),
  selections: z
    .array(z.strictObject({ batchId: idSchema, entryIds: z.array(idSchema).min(1).max(500) }))
    .max(50),
  wordIds: z.array(idSchema).max(500).default([]),
});
export type TaskInput = z.infer<typeof taskInputSchema>;
export const taskItemSchema = z.object({
  wordId: idSchema,
  entry: entrySchema,
  source: z.enum(["homework", "review"]),
  batchTitle: z.string(),
});
export const taskSchema = z.object({
  id: idSchema,
  title: z.string(),
  date: z.iso.date(),
  mode: modeSchema,
  settings: settingsSchema,
  items: z.array(taskItemSchema).min(1).max(500),
  status: z.enum(["pending", "in_progress", "completed"]),
  revision: z.number().int().positive(),
  createdAt: z.iso.datetime(),
});
export type Task = z.infer<typeof taskSchema>;
export const taskSummarySchema = taskSchema
  .omit({ items: true })
  .extend({ count: z.number(), reviewCount: z.number() });
export type TaskSummary = z.infer<typeof taskSummarySchema>;
export const taskListSchema = z.object({ tasks: z.array(taskSummarySchema) });
export const taskResponseSchema = z.object({ task: taskSchema });
export const resultSchema = z.enum(["correct", "wrong", "uncertain", "unchecked"]);
export const attemptUpdateSchema = z.strictObject({
  revision: z.number().int().positive(),
  index: z.number().int().nonnegative(),
  phase: z.enum(["player", "review"]),
  results: z.record(idSchema, resultSchema),
});
export const attemptSchema = attemptUpdateSchema.extend({
  id: idSchema,
  taskId: idSchema,
  startedAt: z.iso.datetime(),
  completedAt: z.iso.datetime().nullable(),
  corrections: z.array(idSchema),
});
export type Attempt = z.infer<typeof attemptSchema>;
export type AttemptUpdate = z.infer<typeof attemptUpdateSchema>;
export const attemptResponseSchema = z.object({ attempt: attemptSchema });
export const taskPlaySchema = taskSummarySchema.omit({ count: true, reviewCount: true }).extend({
  items: z.array(
    z.object({
      wordId: idSchema,
      prompt: z.string(),
      audioText: z.string(),
      lang: z.enum(["en", "zh"]).nullable(),
      kind: z.string(),
      reading: z.string(),
    }),
  ),
});
export type TaskPlay = z.infer<typeof taskPlaySchema>;
export const taskPlayResponseSchema = z.object({
  task: taskPlaySchema,
  attempt: attemptSchema.nullable(),
});
export type TaskPlayResponse = z.infer<typeof taskPlayResponseSchema>;
export const attemptCompleteSchema = z.strictObject({
  revision: z.number().int().positive(),
  confirmRemaining: z.boolean(),
});
export const startTaskSchema = z.strictObject({ onlyHomework: z.boolean().default(false) });
export const attemptDetailSchema = z.object({ task: taskSchema, attempt: attemptSchema });
