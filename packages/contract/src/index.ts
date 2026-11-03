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
  readings: z.object({ en: text(120).default(""), zh: text(120).default("") }).optional(),
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
    readings: e.readings ?? { en: "", zh: "" },
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
  accent: z.enum(["us", "uk"]).default("us"),
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
  accent: z.enum(["us", "uk"]).default("us"),
  groupSize: z.union([z.literal(0), z.literal(5), z.literal(10)]).default(5),
  adaptiveInterval: z.boolean().default(true),
  guidance: z.boolean().default(false),
  repeat: z.number().int().min(1).max(5),
  interval: z.number().min(1).max(30),
  speed: z.number().min(0.5).max(2),
  auto: z.boolean(),
  shuffle: z.boolean(),
});
export type Settings = z.infer<typeof settingsSchema>;
export const defaultSettings: Settings = {
  accent: "us",
  groupSize: 5,
  adaptiveInterval: true,
  guidance: false,
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
  sourceDraftId: idSchema.optional(),
  reviewNotes: z.string().max(2000).optional(),
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

export const taskStatusSchema = z.enum([
  "pending",
  "in_progress",
  "submitted",
  "completed",
  "withdrawn",
  "expired",
]);
export type TaskStatus = z.infer<typeof taskStatusSchema>;

export const taskInputSchema = z.strictObject({
  title: text(80).min(1),
  date: z.iso.date(),
  mode: modeSchema,
  settings: settingsSchema.default(defaultSettings),
  selections: z
    .array(z.strictObject({ batchId: idSchema, entryIds: z.array(idSchema).min(1).max(500) }))
    .max(50),
  wordIds: z.array(idSchema).max(500).default([]),
  reviewCount: z.number().int().min(0).max(20).optional(),
  reviewPlacement: z.enum(["interleave", "end"]).optional(),
  reviewOnly: z.boolean().default(false),
  allowSelfReview: z.boolean().default(false),
  parentTaskId: idSchema.optional(),
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
  status: taskStatusSchema,
  allowSelfReview: z.boolean().default(false),
  parentTaskId: idSchema.optional(),
  revision: z.number().int().positive(),
  createdAt: z.iso.datetime(),
  audio: z.array(z.lazy(() => taskAudioSchema)).default([]),
});
export type Task = z.infer<typeof taskSchema>;
export const taskSummarySchema = taskSchema.omit({ items: true, audio: true }).extend({
  count: z.number(),
  reviewCount: z.number(),
  progressIndex: z.number().int().nonnegative().optional(),
  activeAttemptId: idSchema.optional(),
  wrongCount: z.number().int().nonnegative().optional(),
  uncorrectedCount: z.number().int().nonnegative().optional(),
  spotCheckWords: z.array(z.string()).optional(),
});
export type TaskSummary = z.infer<typeof taskSummarySchema>;
export const taskListSchema = z.object({ tasks: z.array(taskSummarySchema) });
export const taskResponseSchema = z.object({ task: taskSchema });
export const resultSchema = z.enum(["correct", "wrong", "uncertain", "unchecked"]);
export const attemptUpdateSchema = z.strictObject({
  revision: z.number().int().positive(),
  index: z.number().int().nonnegative(),
  phase: z.enum(["player", "review"]),
  results: z.record(idSchema, resultSchema),
  deviceId: z.string().max(120).optional(),
  forceTakeover: z.boolean().optional(),
});
export const attemptSchema = z.object({
  id: idSchema,
  taskId: idSchema,
  revision: z.number().int().positive(),
  index: z.number().int().nonnegative(),
  phase: z.enum(["player", "review"]),
  results: z.record(idSchema, resultSchema),
  startedAt: z.iso.datetime(),
  completedAt: z.iso.datetime().nullable(),
  interruptedAt: z.iso.datetime().nullable().default(null),
  activeDeviceId: z.string().default(""),
  heartbeatAt: z.iso.datetime().optional(),
  spotCheckWordIds: z.array(idSchema).default([]),
  corrections: z.array(idSchema),
});
export type Attempt = z.infer<typeof attemptSchema>;
export type AttemptUpdate = z.infer<typeof attemptUpdateSchema>;
export const attemptResponseSchema = z.object({ attempt: attemptSchema });
export const taskPlaySchema = taskSummarySchema
  .omit({
    count: true,
    reviewCount: true,
    progressIndex: true,
    activeAttemptId: true,
    wrongCount: true,
    uncorrectedCount: true,
    spotCheckWords: true,
  })
  .extend({
    homeworkCount: z.number().int().nonnegative(),
    audio: z.array(z.lazy(() => taskAudioSchema)).default([]),
    items: z.array(
      z.object({
        wordId: idSchema,
        audioKey: idSchema,
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
export const startTaskSchema = z.strictObject({
  onlyHomework: z.boolean().default(false),
  deviceId: z.string().max(120).default(""),
  forceTakeover: z.boolean().default(false),
});
export const taskWithdrawSchema = z.strictObject({
  revision: z.number().int().positive().optional(),
});
export const attemptReturnSchema = z.strictObject({
  revision: z.number().int().positive(),
  resetIndex: z.boolean().default(false),
});
export const attemptDetailSchema = z.object({ task: taskSchema, attempt: attemptSchema });
export const correctionSchema = z.strictObject({
  revision: z.number().int().positive(),
  wordIds: z.array(idSchema).min(1).max(500),
});
export const accountPreferencesSchema = z.strictObject({
  timezone: z
    .string()
    .refine((value) => {
      try {
        new Intl.DateTimeFormat("en", { timeZone: value });
        return true;
      } catch {
        return false;
      }
    }, "时区无效")
    .default("Asia/Shanghai"),
  masteryThreshold: z.number().int().min(1).max(10).default(3),
  reviewCount: z.number().int().min(0).max(20).default(3),
  reviewPlacement: z.enum(["interleave", "end"]).default("interleave"),
});
export type AccountPreferences = z.infer<typeof accountPreferencesSchema>;
export const preferencesResponseSchema = z.object({ preferences: accountPreferencesSchema });
export const learningProgressSchema = z.object({
  status: z.enum(["pending", "mastered"]),
  streak: z.number().int().nonnegative(),
  lastQualifiedDate: z.iso.date().nullable(),
  lastWrongDate: z.iso.date().nullable(),
  dueDate: z.iso.date().nullable(),
  manual: z.boolean(),
});
export type LearningProgress = z.infer<typeof learningProgressSchema>;
export const learningStateSchema = learningProgressSchema.extend({
  wordId: idSchema,
  mode: modeSchema,
  lastPracticedAt: z.iso.datetime(),
});
export type LearningState = z.infer<typeof learningStateSchema>;
export const learningItemSchema = z.object({ entry: entrySchema, state: learningStateSchema });
export type LearningItem = z.infer<typeof learningItemSchema>;
export const learningResponseSchema = z.object({ items: z.array(learningItemSchema) });
export const historyItemSchema = z.object({ task: taskSummarySchema, attempt: attemptSchema });
export type HistoryItem = z.infer<typeof historyItemSchema>;
export const historyResponseSchema = z.object({ items: z.array(historyItemSchema) });
export const weeklyResponseSchema = z.object({
  completed: z.number(),
  pending: z.number(),
  next: z.array(learningItemSchema),
  from: z.iso.date(),
  to: z.iso.date(),
});
export const examRequestSchema = z
  .strictObject({ from: z.iso.date(), to: z.iso.date(), mode: modeSchema })
  .refine((input) => input.from <= input.to, "起止日期顺序无效");

export const examResponseSchema = z.object({
  items: z.array(z.object({ wordId: idSchema, entry: entrySchema, status: z.string() })),
});
export const manualLearningSchema = z.strictObject({
  mode: modeSchema,
  status: z.enum(["pending", "mastered"]),
});
export const pronunciationInputSchema = z.strictObject({
  wordId: idSchema.optional(),
  synthetic: z.boolean().optional(),
  pinyin: z.string().max(300).optional(),
  text: z.string().trim().min(1).max(300),
  lang: z.enum(["en", "zh"]),
  accent: z.enum(["us", "uk"]).default("us"),
  reading: z.string().max(120).default(""),
});
export type PronunciationInput = z.infer<typeof pronunciationInputSchema>;
export const voiceSchema = z.object({
  id: z.string(),
  kind: z.enum(["human", "server", "device", "unavailable"]),
  url: z.string().nullable(),
  source: z.string(),
  sourceUrl: z.string(),
  author: z.string(),
  licenseName: z.string(),
  licenseUrl: z.string(),
  title: z.string(),
  reading: z.string(),
  accent: z.string(),
  warning: z.string(),
});
export type Voice = z.infer<typeof voiceSchema>;
export const taskAudioSchema = voiceSchema.extend({
  wordId: idSchema,
  text: z.string(),
  lang: z.enum(["en", "zh"]),
});
export type TaskAudio = z.infer<typeof taskAudioSchema>;
export const voicesResponseSchema = z.object({ voices: z.array(voiceSchema) });
export const voiceResponseSchema = z.object({ voice: voiceSchema });
export const audioManifestSchema = z.object({ audio: z.array(taskAudioSchema) });
export const audioPreparationSchema = z.strictObject({
  fallbackIds: z.array(idSchema).max(500).default([]),
});
export const localAudioEntrySchema = z.strictObject({
  id: z.string().min(1).max(120),
  text: z.string().min(1).max(300),
  lang: z.enum(["en", "zh"]),
  accent: z.enum(["us", "uk", "zh"]),
  reading: z.string().max(120),
  file: z.string().regex(/^[A-Za-z0-9_-]+\.(?:mp3|ogg|wav)$/),
  source: z.string().min(1),
  sourceUrl: z.url(),
  author: z.string().min(1),
  licenseName: z.string().min(1),
  licenseUrl: z.url(),
});
export type LocalAudioEntry = z.infer<typeof localAudioEntrySchema>;
export const tokenScopeSchema = z.enum(["wordlists:read", "drafts:write"]);
export type TokenScope = z.infer<typeof tokenScopeSchema>;
export const tokenCreateSchema = z.strictObject({
  name: z.string().trim().min(1).max(60),
  scopes: z
    .array(tokenScopeSchema)
    .min(1)
    .max(2)
    .refine((scopes) => new Set(scopes).size === scopes.length, "权限重复"),
  expiresInDays: z.number().int().min(1).max(365).default(30),
});
export const tokenInfoSchema = z.object({
  id: idSchema,
  name: z.string(),
  scopes: z.array(tokenScopeSchema),
  createdAt: z.iso.datetime(),
  expiresAt: z.iso.datetime(),
});
export type TokenInfo = z.infer<typeof tokenInfoSchema>;
export const tokenListSchema = z.object({ tokens: z.array(tokenInfoSchema) });
export const tokenCreatedSchema = z.object({ token: z.string(), info: tokenInfoSchema });
export const agentDraftInputSchema = z.strictObject({
  wordlist: exportSchema,
  notes: z.string().max(2000).default(""),
});
export const serverDraftSchema = agentDraftInputSchema.extend({
  id: idSchema,
  createdAt: z.iso.datetime(),
});
export type ServerDraft = z.infer<typeof serverDraftSchema>;
export const serverDraftResponseSchema = z.object({ draft: serverDraftSchema });
export const serverDraftListSchema = z.object({ drafts: z.array(serverDraftSchema) });
export const agentValidationInputSchema = z.strictObject({ wordlist: z.unknown() });
export const agentValidationSchema = z.object({
  valid: z.boolean(),
  issues: z.array(
    z.object({ level: z.enum(["error", "warn"]), path: z.string(), message: z.string() }),
  ),
});

export const childTokenInfoSchema = z.object({
  id: idSchema,
  createdAt: z.iso.datetime(),
  expiresAt: z.iso.datetime(),
  lastAccessedAt: z.iso.datetime().nullable().default(null),
  lastAccessAgent: z.string().default(""),
});
export type ChildTokenInfo = z.infer<typeof childTokenInfoSchema>;
export const childTokenStatusSchema = z.object({
  active: z.array(childTokenInfoSchema),
});
export const childTokenCreatedSchema = z.object({
  token: z.string(),
  info: childTokenInfoSchema,
});
export const childCorrectionItemSchema = z.object({
  attemptId: idSchema,
  attemptRevision: z.number().int().positive(),
  taskId: idSchema,
  taskTitle: z.string(),
  taskDate: z.iso.date(),
  mode: modeSchema,
  completedAt: z.iso.datetime(),
  totalCount: z.number().int().nonnegative(),
  correctCount: z.number().int().nonnegative(),
  words: z.array(
    z.object({
      wordId: idSchema,
      entry: entrySchema,
      result: z.enum(["wrong", "uncertain"]),
      corrected: z.boolean(),
    }),
  ),
});
export type ChildCorrectionItem = z.infer<typeof childCorrectionItemSchema>;
export const childBatchSummarySchema = batchSummarySchema.extend({
  lockedCount: z.number().int().nonnegative().default(0),
});
export type ChildBatchSummary = z.infer<typeof childBatchSummarySchema>;
export const childOverviewSchema = z.object({
  tasks: z.array(taskSummarySchema),
  corrections: z.array(childCorrectionItemSchema),
  batches: z.array(childBatchSummarySchema),
});
export type ChildOverview = z.infer<typeof childOverviewSchema>;
export const childListenBatchSchema = z.object({
  batch: batchSchema,
  lockedWordIds: z.array(idSchema).default([]),
});
export const auditLogItemSchema = z.object({
  id: idSchema,
  action: z.string(),
  detail: z.string(),
  actor: z.enum(["parent", "child", "system"]),
  createdAt: z.iso.datetime(),
});
export type AuditLogItem = z.infer<typeof auditLogItemSchema>;
export const auditLogListSchema = z.object({
  logs: z.array(auditLogItemSchema),
});
